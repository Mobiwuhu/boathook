import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RingBuffer } from "@boathook/plugin-sdk/utilities";
import type { BrowserContext, Page } from "playwright";
import { artifactDirectory } from "../artifacts.ts";
import type {
	AssertCondition,
	CommandConfig,
	HealthcheckPage,
} from "../config/schema.ts";
import {
	formatHealthcheckJson,
	formatHealthcheckJUnit,
	formatHealthcheckMarkdown,
	parseJUnitProperties,
} from "../flows/reporters.ts";
import { interpolateVars, parseVars } from "../flows/variables.ts";
import type { Response } from "../ipc/protocol.ts";
import {
	formatHealthcheckWebhookPayload,
	parseWebhookFlag,
	sendWebhook,
} from "../webhook.ts";
import { evaluateAssertCondition } from "./assert.ts";
import { type ConsoleEntry, formatConsoleEntries } from "./console.ts";
import type { NetworkEntry } from "./network.ts";

export type HealthcheckDeps = {
	consoleBuffer: RingBuffer<ConsoleEntry>;
	networkBuffer: RingBuffer<NetworkEntry>;
	newScratchPage?: () => Promise<Page>;
};

const VALID_REPORTERS = ["junit", "json", "markdown"];

export function parseHealthcheckArgs(args: string[]): {
	vars: Record<string, string>;
	noScreenshots: boolean;
	parallel: boolean;
	concurrency: number;
	reporter?: string;
	junitProperties?: Record<string, string>;
	webhookUrl?: string;
	error?: string;
} {
	const vars = parseVars(args);
	const noScreenshots = args.includes("--no-screenshots");
	const parallel = args.includes("--parallel");
	let concurrency = 5;
	let reporter: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--reporter") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) {
				return {
					vars,
					noScreenshots,
					parallel,
					concurrency,
					error: `Missing value for --reporter. Valid reporters: ${VALID_REPORTERS.join(", ")}`,
				};
			}
			reporter = value;
			if (!VALID_REPORTERS.includes(reporter)) {
				return {
					vars,
					noScreenshots,
					parallel,
					concurrency,
					error: `Invalid reporter '${reporter}'. Valid reporters: ${VALID_REPORTERS.join(", ")}`,
				};
			}
		}
		if (args[i] === "--concurrency") {
			const next = args[i + 1];
			if (next && /^\d+$/.test(next)) {
				concurrency = Number(next);
			}
		}
	}

	const junitResult = parseJUnitProperties(args);
	if (junitResult.error) {
		return {
			vars,
			noScreenshots,
			parallel,
			concurrency,
			error: junitResult.error,
		};
	}
	if (junitResult.suiteProperties && reporter !== "junit") {
		return {
			vars,
			noScreenshots,
			parallel,
			concurrency,
			error: "--junit-property requires --reporter junit.",
		};
	}

	const webhookResult = parseWebhookFlag(args);
	if (webhookResult.error) {
		return {
			vars,
			noScreenshots,
			parallel,
			concurrency,
			error: webhookResult.error,
		};
	}

	return {
		vars,
		noScreenshots,
		parallel,
		concurrency,
		reporter,
		junitProperties: junitResult.suiteProperties,
		webhookUrl: webhookResult.url,
	};
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function generateHealthcheckScreenshotPath(pageName: string): string {
	const dir = artifactDirectory("screenshots");
	mkdirSync(dir, { recursive: true });

	const now = new Date();
	const pad = (n: number, len = 2) => String(n).padStart(len, "0");
	const timestamp = [
		now.getFullYear(),
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		"-",
		pad(now.getHours()),
		pad(now.getMinutes()),
		pad(now.getSeconds()),
		"-",
		pad(now.getMilliseconds(), 3),
	].join("");

	const slug = slugify(pageName);
	return join(dir, `healthcheck-${slug}-${timestamp}.png`);
}

type PageResult = {
	name: string;
	url: string;
	passed: boolean;
	screenshotPath?: string;
	consoleErrors: ConsoleEntry[];
	consoleWarnings: ConsoleEntry[];
	assertionResults: { label: string; passed: boolean; reason?: string }[];
	error?: string;
};

export async function handleHealthcheck(
	config: CommandConfig | null,
	page: Page,
	args: string[],
	deps: HealthcheckDeps | null,
	context?: BrowserContext,
): Promise<Response> {
	if (!config) {
		return {
			ok: false,
			error:
				"No session configuration loaded. Start the session with JSON containing healthcheck pages.",
		};
	}

	const pages = config.healthcheck?.pages;
	if (!pages?.length) {
		return {
			ok: false,
			error: "No healthcheck pages defined in the session configuration.",
		};
	}

	const parsed = parseHealthcheckArgs(args);
	if (parsed.error) {
		return { ok: false, error: parsed.error };
	}
	const {
		vars,
		noScreenshots,
		parallel,
		concurrency,
		reporter,
		junitProperties,
		webhookUrl,
	} = parsed;
	const startTime = Date.now();
	const results: PageResult[] = [];
	const allScreenshots: string[] = [];

	/**
	 * Check a single page — used by both sequential and parallel modes.
	 */
	async function checkPage(
		checkPageInstance: Page,
		pageConfig: HealthcheckPage,
	): Promise<PageResult> {
		const url = interpolateVars(pageConfig.url, vars);
		const name = pageConfig.name ?? url.replace(/^https?:\/\/[^/]+/, "");
		const shouldScreenshot = !noScreenshots && pageConfig.screenshot !== false;

		const result: PageResult = {
			name,
			url,
			passed: true,
			consoleErrors: [],
			consoleWarnings: [],
			assertionResults: [],
		};

		// Navigate
		try {
			await checkPageInstance.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: 30_000,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.passed = false;
			result.error = `Navigation failed: ${message}`;
			return result;
		}

		// Screenshot
		if (shouldScreenshot) {
			try {
				const screenshotPath = generateHealthcheckScreenshotPath(name);
				await checkPageInstance.screenshot({
					path: screenshotPath,
					fullPage: true,
				});
				result.screenshotPath = screenshotPath;
			} catch {
				// Screenshot failure doesn't fail the page
			}
		}

		// Run assertions
		if (pageConfig.assertions) {
			for (const condition of pageConfig.assertions) {
				const assertResult = await evaluateAssertCondition(
					checkPageInstance,
					condition,
				);
				const label = formatAssertLabel(condition);
				result.assertionResults.push({
					label,
					passed: assertResult.passed,
					reason: assertResult.passed ? undefined : assertResult.reason,
				});
				if (!assertResult.passed) {
					result.passed = false;
				}
			}
		}

		return result;
	}

	if (parallel && context) {
		// Parallel mode: check pages concurrently using separate pages
		const chunks: (typeof pages)[] = [];
		for (let i = 0; i < pages.length; i += concurrency) {
			chunks.push(pages.slice(i, i + concurrency));
		}

		for (const chunk of chunks) {
			const parallelPages: Array<{ page: Page; config: HealthcheckPage }> = [];
			try {
				// Create a new page for each item in the chunk
				for (const config of chunk) {
					const page = await (deps?.newScratchPage?.() ?? context.newPage());
					parallelPages.push({ page, config });
				}

				const chunkResults = await Promise.all(
					parallelPages.map(({ page, config }) => checkPage(page, config)),
				);

				for (const result of chunkResults) {
					results.push(result);
					if (result.screenshotPath) {
						allScreenshots.push(result.screenshotPath);
					}
				}
			} finally {
				// Close the temporary pages
				for (const { page } of parallelPages) {
					try {
						await page.close();
					} catch {
						// Ignore close errors
					}
				}
			}
		}
	} else {
		// Sequential mode (original behavior)
		for (const pageConfig of pages) {
			// Drain console buffer before navigation
			if (deps) {
				deps.consoleBuffer.drain();
			}

			const result = await checkPage(page, pageConfig);

			// Check console (only works in sequential mode with shared buffer)
			if (deps) {
				const consoleLevel = pageConfig.console ?? "error";
				await new Promise((resolve) => setTimeout(resolve, 200));
				const entries = deps.consoleBuffer.drain(
					(entry) => entry.level === consoleLevel,
				);
				if (entries.length > 0) {
					if (pageConfig.console !== undefined) {
						// Explicitly configured: fail the page
						if (pageConfig.console === "error") {
							result.consoleErrors = entries;
						} else {
							result.consoleWarnings = entries;
						}
						result.passed = false;
					} else {
						// Not configured: report as warnings, don't fail
						result.consoleWarnings = entries;
					}
				}
			}

			results.push(result);
			if (result.screenshotPath) {
				allScreenshots.push(result.screenshotPath);
			}
		}
	}

	const passedCount = results.filter((r) => r.passed).length;
	const totalCount = results.length;
	const allPassed = passedCount === totalCount;
	const durationMs = Date.now() - startTime;

	// Fire webhook notification (non-blocking)
	if (webhookUrl) {
		const payload = formatHealthcheckWebhookPayload(results, durationMs);
		sendWebhook(webhookUrl, payload);
	}

	if (reporter === "junit") {
		const junit = formatHealthcheckJUnit(results, durationMs, {
			suiteProperties: junitProperties,
		});
		return allPassed ? { ok: true, data: junit } : { ok: false, error: junit };
	}
	if (reporter === "json") {
		const json = formatHealthcheckJson(results, durationMs);
		return allPassed ? { ok: true, data: json } : { ok: false, error: json };
	}
	if (reporter === "markdown") {
		const md = formatHealthcheckMarkdown(results, durationMs);
		return allPassed ? { ok: true, data: md } : { ok: false, error: md };
	}

	const report = formatHealthcheckReport(results, allScreenshots);

	if (allPassed) {
		return { ok: true, data: report };
	}
	return { ok: false, error: report };
}

function formatAssertLabel(condition: AssertCondition): string {
	if ("visible" in condition) return `visible "${condition.visible}"`;
	if ("notVisible" in condition) return `notVisible "${condition.notVisible}"`;
	if ("textContains" in condition)
		return `textContains "${condition.textContains}"`;
	if ("textNotContains" in condition)
		return `textNotContains "${condition.textNotContains}"`;
	if ("urlContains" in condition)
		return `urlContains "${condition.urlContains}"`;
	if ("urlPattern" in condition) return `urlPattern "${condition.urlPattern}"`;
	if ("elementText" in condition)
		return `elementText "${condition.elementText.selector}"`;
	if ("elementCount" in condition)
		return `elementCount "${condition.elementCount.selector}"`;
	return "unknown";
}

function formatHealthcheckReport(
	results: PageResult[],
	screenshots: string[],
): string {
	const passedCount = results.filter((r) => r.passed).length;
	const totalCount = results.length;
	const lines: string[] = [];

	lines.push(`Healthcheck: ${passedCount}/${totalCount} pages passed`);
	lines.push("");

	for (const result of results) {
		const mark = result.passed ? "✓" : "✗";
		lines.push(`  ${mark} ${result.name} (${result.url})`);

		if (result.error) {
			lines.push(`    ${result.error}`);
		}

		if (result.screenshotPath) {
			lines.push(`    Screenshot: ${result.screenshotPath}`);
		}

		if (result.assertionResults.length > 0) {
			const assertPassed = result.assertionResults.filter(
				(a) => a.passed,
			).length;
			lines.push(
				`    Assertions: ${assertPassed}/${result.assertionResults.length} passed`,
			);
			for (const ar of result.assertionResults) {
				if (!ar.passed && ar.reason) {
					lines.push(`      ✗ ${ar.label}: ${ar.reason}`);
				}
			}
		}

		if (result.consoleErrors.length > 0) {
			lines.push("    Console errors:");
			const formatted = formatConsoleEntries(result.consoleErrors);
			for (const line of formatted.split("\n")) {
				lines.push(`      ${line}`);
			}
		} else if (result.consoleWarnings.length > 0) {
			lines.push("    Console warnings:");
			const formatted = formatConsoleEntries(result.consoleWarnings);
			for (const line of formatted.split("\n")) {
				lines.push(`      ${line}`);
			}
		} else if (!result.error) {
			lines.push("    Console: clean");
		}
	}

	if (screenshots.length > 0) {
		lines.push("");
		lines.push("Screenshots:");
		for (const result of results) {
			if (result.screenshotPath) {
				lines.push(`  ${result.name}: ${result.screenshotPath}`);
			}
		}
	}

	return lines.join("\n");
}
