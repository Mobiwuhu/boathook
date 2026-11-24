import { RingBuffer } from "@boathook/plugin-sdk/utilities";
import type { BrowserContext, BrowserContextOptions } from "playwright";
import { applyStealthScripts, type StealthOpts } from "../browser/stealth.ts";
import type { CommandConfig } from "../config/schema.ts";
import type { CustomReporterRegistry } from "../flows/custom-reporter.ts";
import {
	formatFlowReporter,
	getFlowReporterNames,
	isKnownFlowReporter,
	parseJUnitProperties,
} from "../flows/reporters.ts";
import { runFlow, type StepResult } from "../flows/runner.ts";
import { parseVars } from "../flows/variables.ts";
import type { Response } from "../ipc/protocol.ts";
import type { ConsoleEntry } from "./console.ts";
import { configuredLoginError, handleLogin } from "./login.ts";
import type { NetworkEntry } from "./network.ts";

type TestMatrixOptions = {
	stealthOpts?: StealthOpts;
	proxy?: BrowserContextOptions["proxy"];
	customReporters?: CustomReporterRegistry;
};

type RoleResult = {
	role: string;
	results: StepResult[];
	screenshots: string[];
	error?: string;
};

/**
 * Multi-role parallel testing: runs the same flow simultaneously across
 * sessions with different auth (roles/environments) and diffs the results.
 *
 * Usage:
 *   boathook --session NAME test-matrix --roles admin,viewer,guest --flow checkout
 *   boathook --session NAME test-matrix --roles admin,viewer --flow dashboard --env staging
 *   boathook --session NAME test-matrix --roles admin,viewer --flow dashboard --reporter junit
 *   boathook --session NAME test-matrix --roles admin,viewer --flow dashboard --reporter junit --junit-property environment=ci
 */
export async function handleTestMatrix(
	config: CommandConfig | null,
	args: string[],
	context: BrowserContext,
	{ stealthOpts, proxy, customReporters }: TestMatrixOptions = {},
): Promise<Response> {
	if (!config) {
		return {
			ok: false,
			error:
				"No session configuration loaded. Start the session with JSON containing flow and environment definitions.",
		};
	}

	// Parse args
	let rolesStr: string | undefined;
	let flowName: string | undefined;
	let envName: string | undefined;
	let reporter: string | undefined;
	const vars = parseVars(args);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--roles") {
			rolesStr = args[i + 1];
			i++;
		} else if (arg === "--flow") {
			flowName = args[i + 1];
			i++;
		} else if (arg === "--env") {
			envName = args[i + 1];
			i++;
		} else if (arg === "--reporter") {
			const next = args[i + 1];
			const reporterNames = getFlowReporterNames(customReporters);
			if (!next || next.startsWith("--")) {
				return {
					ok: false,
					error: `Missing value for --reporter. Valid reporters: ${reporterNames}`,
				};
			}
			if (!isKnownFlowReporter(next, customReporters)) {
				return {
					ok: false,
					error: `Invalid reporter '${next}'. Valid reporters: ${reporterNames}`,
				};
			}
			reporter = next;
			i++;
		}
	}

	const junitResult = parseJUnitProperties(args);
	if (junitResult.error) {
		return { ok: false, error: junitResult.error };
	}
	if (junitResult.suiteProperties && reporter !== "junit") {
		return {
			ok: false,
			error: "--junit-property requires --reporter junit.",
		};
	}

	if (!rolesStr || !flowName) {
		return {
			ok: false,
			error:
				"Usage: boathook --session NAME test-matrix --roles <role1,role2,...> --flow <flow-name> [--env <env>] [--reporter <format>] [--junit-property key=value ...]\n\nRoles must correspond to environment names in the session configuration.",
		};
	}

	const roles = rolesStr
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean);
	if (roles.length < 2) {
		return {
			ok: false,
			error: "At least 2 roles are required for matrix testing.",
		};
	}

	// Validate flow exists
	const flows = config.flows ?? {};
	const flow = Object.hasOwn(flows, flowName) ? flows[flowName] : undefined;
	if (!flow) {
		const keys = Object.keys(flows);
		const available = keys.length > 0 ? keys.join(", ") : "(none)";
		return {
			ok: false,
			error: `Unknown flow: '${flowName}'. Available: ${available}.`,
		};
	}

	// Validate that each role has an environment config
	const environments = config.environments ?? {};
	const roleEnvironments: Array<{ role: string; envKey: string }> = [];
	for (const role of roles) {
		const prefixed = envName ? `${envName}-${role}` : role;
		const envKey = Object.hasOwn(environments, prefixed) ? prefixed : role;
		if (!Object.hasOwn(environments, envKey)) {
			const available = Object.keys(environments).join(", ");
			return {
				ok: false,
				error: `No environment config for role '${role}' (tried '${prefixed}' and '${role}'). Available environments: ${available}.`,
			};
		}
		roleEnvironments.push({ role, envKey });
	}

	const error = configuredLoginError();
	if (error) return { ok: false, error };
	const startTime = Date.now();

	// Run each role in a separate isolated browser context in parallel
	const browser = context.browser();
	if (!browser) {
		return { ok: false, error: "Browser not available for matrix testing." };
	}

	const promises = roleEnvironments.map(
		async ({ role, envKey }): Promise<RoleResult> => {
			let isolatedContext: BrowserContext | undefined;
			try {
				// Create isolated context for this role
				isolatedContext = await browser.newContext({
					viewport: { width: 1440, height: 900 },
					userAgent: stealthOpts?.userAgent,
					proxy,
				});
				if (stealthOpts) {
					await applyStealthScripts(isolatedContext, stealthOpts);
				}

				const rolePage = await isolatedContext.newPage();

				// Log in with this role's environment
				const loginResult = await handleLogin(config, rolePage, [
					"--env",
					envKey,
				]);
				if (!loginResult.ok) {
					return {
						role,
						results: [],
						screenshots: [],
						error: `Login failed for role '${role}': ${loginResult.error}`,
					};
				}

				// Create buffers and attach listeners for this role's session
				const consoleBuffer = new RingBuffer<ConsoleEntry>(500);
				const networkBuffer = new RingBuffer<NetworkEntry>(500);

				rolePage.on("console", (msg) => {
					const loc = msg.location();
					consoleBuffer.push({
						level: msg.type(),
						text: msg.text(),
						location: {
							url: loc.url,
							lineNumber: loc.lineNumber,
							columnNumber: loc.columnNumber,
						},
						timestamp: Date.now(),
					});
				});

				rolePage.on("response", (response) => {
					const status = response.status();
					if (status >= 400) {
						networkBuffer.push({
							status,
							method: response.request().method(),
							url: response.url(),
							timestamp: Date.now(),
						});
					}
				});

				// Run the flow
				const { results, screenshots } = await runFlow(
					`${flowName}-${role}`,
					flow,
					vars,
					{
						page: rolePage,
						config,
						consoleBuffer,
						networkBuffer,
					},
					{ continueOnError: true },
				);

				return { role, results, screenshots };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					role,
					results: [],
					screenshots: [],
					error: message,
				};
			} finally {
				if (isolatedContext) {
					try {
						await isolatedContext.close();
					} catch {
						// Ignore close errors
					}
				}
			}
		},
	);

	const roleResults = await Promise.all(promises);

	const durationMs = Date.now() - startTime;

	// Reporter output
	if (reporter) {
		const allResults: StepResult[] = [];
		for (const rr of roleResults) {
			if (rr.error) {
				allResults.push({
					stepNum: 1,
					description: `[${rr.role}] Setup`,
					passed: false,
					error: rr.error,
				});
				continue;
			}
			for (const r of rr.results) {
				allResults.push({
					...r,
					description: `[${rr.role}] ${r.description}`,
				});
			}
		}
		const matrixName = `test-matrix-${flowName}`;
		const matrixPassed = allResults.every((r) => r.passed);
		const output = formatFlowReporter(
			matrixName,
			allResults,
			durationMs,
			reporter,
			customReporters,
			junitResult,
		);
		return matrixPassed
			? { ok: true, data: output }
			: { ok: false, error: output };
	}

	// Format comparison report
	const lines: string[] = [];
	lines.push(
		`Test Matrix: ${flowName} × ${roles.length} roles (${Math.round(durationMs / 1000)}s)`,
	);
	lines.push("");

	let allPassed = true;

	for (const rr of roleResults) {
		if (rr.error) {
			lines.push(`  ✗ ${rr.role}: ERROR — ${rr.error}`);
			allPassed = false;
			continue;
		}

		const passed = rr.results.filter((r) => r.passed).length;
		const total = rr.results.length;
		const status = passed === total ? "✓" : "✗";
		if (passed !== total) allPassed = false;

		lines.push(`  ${status} ${rr.role}: ${passed}/${total} steps passed`);
		for (const r of rr.results) {
			if (!r.passed) {
				lines.push(`      ✗ Step ${r.stepNum}: ${r.description} — ${r.error}`);
			}
		}
	}

	// Diff section: compare results across roles
	lines.push("");
	lines.push("Differences:");

	const referenceRole = roleResults[0];
	let hasDiffs = false;

	if (referenceRole && !referenceRole.error) {
		for (let i = 1; i < roleResults.length; i++) {
			const other = roleResults[i];
			if (!other || other.error) continue;

			const maxSteps = Math.max(
				referenceRole.results.length,
				other.results.length,
			);
			for (let s = 0; s < maxSteps; s++) {
				const refStep = referenceRole.results[s];
				const otherStep = other.results[s];

				if (!refStep || !otherStep) {
					hasDiffs = true;
					lines.push(
						`  Step ${s + 1}: ${referenceRole.role} ${refStep ? (refStep.passed ? "PASS" : "FAIL") : "N/A"} vs ${other.role} ${otherStep ? (otherStep.passed ? "PASS" : "FAIL") : "N/A"}`,
					);
				} else if (refStep.passed !== otherStep.passed) {
					hasDiffs = true;
					lines.push(
						`  Step ${s + 1} (${refStep.description}): ${referenceRole.role} ${refStep.passed ? "PASS" : "FAIL"} vs ${other.role} ${otherStep.passed ? "PASS" : "FAIL"}`,
					);
				}
			}
		}
	}

	if (!hasDiffs) {
		lines.push("  All roles produced identical results.");
	}

	if (allPassed) {
		return { ok: true, data: lines.join("\n") };
	}
	return { ok: false, error: lines.join("\n") };
}
