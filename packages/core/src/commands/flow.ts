import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RingBuffer } from "@boathook/plugin-sdk/utilities";
import type { Page } from "playwright";
import type { CommandConfig } from "../config/schema.ts";
import type { CustomReporterRegistry } from "../flows/custom-reporter.ts";
import type { FlowSource } from "../flows/loader.ts";
import { isValidFlowName } from "../flows/loader.ts";
import {
	formatFlowReporter,
	getFlowReporterNames,
	isKnownFlowReporter,
	parseJUnitProperties,
} from "../flows/reporters.ts";
import {
	dryRunFlow,
	formatFlowReport,
	runFlow,
	type StepResult,
} from "../flows/runner.ts";
import {
	formatFlowTemplateList,
	getFlowTemplate,
	getFlowTemplateNames,
} from "../flows/templates.ts";
import { parseVars } from "../flows/variables.ts";
import type { Response } from "../ipc/protocol.ts";
import {
	formatFlowWebhookPayload,
	parseWebhookFlag,
	sendWebhook,
} from "../webhook.ts";
import type { ConsoleEntry } from "./console.ts";
import type { NetworkEntry } from "./network.ts";

export type FlowDeps = {
	consoleBuffer: RingBuffer<ConsoleEntry>;
	networkBuffer: RingBuffer<NetworkEntry>;
	performWipe?: () => Promise<Response>;
};

const FLOW_INIT_USAGE = `Usage: boathook --session NAME flow init <template> [name] [--force]

Available templates:
${formatFlowTemplateList()}`;

const FLOW_USAGE = `Usage: boathook --session NAME flow <name> [--var key=value ...] [--continue-on-error] [--reporter <format>] [--junit-property key=value ...] [--dry-run] [--stream] [--webhook <url>]
boathook --session NAME flow list
boathook --session NAME flow init <template> [name] [--force]`;

const RESERVED_FLOW_SUBCOMMANDS = new Set(["init", "list"]);

function initFlowFromTemplate(args: string[], projectDir?: string): Response {
	const templateName = args[0];
	if (!templateName) {
		return { ok: false, error: FLOW_INIT_USAGE };
	}

	const template = getFlowTemplate(templateName);
	if (!template) {
		return {
			ok: false,
			error: `Unknown flow template '${templateName}'. Available: ${getFlowTemplateNames().join(", ")}.`,
		};
	}

	let flowName: string | undefined;
	let force = false;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (!flowName) {
			flowName = arg;
			continue;
		}
		return { ok: false, error: FLOW_INIT_USAGE };
	}

	const resolvedFlowName = flowName ?? templateName;
	if (RESERVED_FLOW_SUBCOMMANDS.has(resolvedFlowName)) {
		return {
			ok: false,
			error: `Invalid flow name '${resolvedFlowName}'. 'init' and 'list' are reserved for flow subcommands.`,
		};
	}
	if (!isValidFlowName(resolvedFlowName)) {
		return {
			ok: false,
			error: `Invalid flow name '${resolvedFlowName}'. Use letters, numbers, dots, underscores, or hyphens.`,
		};
	}

	if (!projectDir) {
		return {
			ok: false,
			error: "Start the session from the project directory to create a flow.",
		};
	}

	const configDir = projectDir;
	const flowsDir = join(configDir, "flows");
	const outputPath = join(flowsDir, `${resolvedFlowName}.json`);
	const displayPath =
		relative(configDir, outputPath) || `${resolvedFlowName}.json`;

	if (existsSync(outputPath) && !force) {
		return {
			ok: false,
			error: `${displayPath} already exists. Use --force to overwrite the generated flow.`,
		};
	}

	try {
		mkdirSync(flowsDir, { recursive: true });
		writeFileSync(
			outputPath,
			`${JSON.stringify(template.flow, null, 2)}\n`,
			"utf-8",
		);
	} catch (error) {
		return {
			ok: false,
			error: `Failed to write flow template: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	return {
		ok: true,
		data: `Created ${displayPath} from template ${templateName}.`,
	};
}

export async function handleFlow(
	config: CommandConfig | null,
	page: Page | undefined,
	args: string[],
	deps?: FlowDeps,
	flowSources?: Map<string, FlowSource>,
	flowLoadErrors?: string[],
	customReporters?: CustomReporterRegistry,
): Promise<Response> {
	const subcommand = args[0];
	if (!subcommand) {
		return {
			ok: false,
			error: FLOW_USAGE,
		};
	}

	if (subcommand === "init") {
		return initFlowFromTemplate(args.slice(1), config?.projectDir);
	}

	const flows = config?.flows ?? {};
	// flow list
	if (subcommand === "list") {
		const hasFlows = Object.keys(flows).length > 0;

		if (!hasFlows && (!flowLoadErrors || flowLoadErrors.length === 0)) {
			return {
				ok: true,
				data: "No flows defined. Pass flows in --config-json or create files in a flows/ directory.",
			};
		}

		const lines: string[] = [];
		if (hasFlows) {
			for (const [name, flow] of Object.entries(flows)) {
				const desc = flow.description ? ` — ${flow.description}` : "";
				let sourceTag = "";
				if (flowSources) {
					const source = flowSources.get(name);
					if (source?.type === "file") {
						sourceTag = `  [file: ${source.path}]`;
					} else if (source?.type === "inline") {
						sourceTag = "  [inline]";
					}
				}
				lines.push(`${name}${desc}${sourceTag}`);
				if (flow.variables && flow.variables.length > 0) {
					lines.push(`  Variables: ${flow.variables.join(", ")}`);
				}
				lines.push("");
			}
		}

		if (flowLoadErrors && flowLoadErrors.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(
				`Warnings: ${flowLoadErrors.length} flow file(s) failed to load:`,
			);
			for (const err of flowLoadErrors) {
				lines.push(`  - ${err}`);
			}
		}

		return { ok: true, data: lines.join("\n").trim() };
	}

	// flow <name>
	const flowName = subcommand;
	const flow = Object.hasOwn(flows, flowName) ? flows[flowName] : undefined;
	if (!flow) {
		const keys = Object.keys(flows);
		const available = keys.length > 0 ? keys.join(", ") : "(none)";
		return {
			ok: false,
			error: `Unknown flow: '${flowName}'. Available: ${available}.`,
		};
	}

	const vars = parseVars(args.slice(1));
	const continueOnError = args.includes("--continue-on-error");
	const dryRun = args.includes("--dry-run");
	const stream = args.includes("--stream");

	// Parse reporter flag
	let reporter: string | undefined;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--reporter") {
			const reporterNames = getFlowReporterNames(customReporters);
			const reporterValue = args[i + 1];
			if (!reporterValue || reporterValue.startsWith("--")) {
				return {
					ok: false,
					error: `Missing value for --reporter. Valid reporters: ${reporterNames}`,
				};
			}
			if (!isKnownFlowReporter(reporterValue, customReporters)) {
				return {
					ok: false,
					error: `Invalid reporter '${reporterValue}'. Valid reporters: ${reporterNames}`,
				};
			}
			reporter = reporterValue;
			break;
		}
	}

	const junitResult = parseJUnitProperties(args.slice(1));
	if (junitResult.error) {
		return { ok: false, error: junitResult.error };
	}
	if (junitResult.suiteProperties && reporter !== "junit") {
		return {
			ok: false,
			error: "--junit-property requires --reporter junit.",
		};
	}

	// Parse webhook flag
	const webhookResult = parseWebhookFlag(args.slice(1));
	if (webhookResult.error) {
		return { ok: false, error: webhookResult.error };
	}
	const webhookUrl = webhookResult.url;

	// Validate required variables
	if (flow.variables && flow.variables.length > 0) {
		const missing = flow.variables.filter((v) => !(v in vars));
		if (missing.length > 0) {
			const usage = flow.variables.map((v) => `--var ${v}=<value>`).join(" ");
			return {
				ok: false,
				error: `Missing variables for flow '${flowName}': ${missing.join(", ")}\nUsage: boathook --session NAME flow ${flowName} ${usage}`,
			};
		}
	}

	// Dry run mode — preview steps without executing
	if (dryRun) {
		const preview = dryRunFlow(flow, vars);
		return { ok: true, data: preview };
	}
	if (!page)
		return {
			ok: false,
			code: "TAB_GONE",
			error: "请选择可用标签页。",
			exitCode: 2,
		};

	if (!deps) {
		return {
			ok: false,
			error:
				"Internal error: flow command requires console and network buffers.",
		};
	}

	const startTime = Date.now();

	// Streaming mode — collect NDJSON lines as steps complete
	const streamLines: string[] = [];
	const onStep = stream
		? (result: StepResult) => {
				streamLines.push(JSON.stringify(result));
			}
		: undefined;

	const { results, screenshots } = await runFlow(
		flowName,
		flow,
		vars,
		{
			page,
			config,
			consoleBuffer: deps.consoleBuffer,
			networkBuffer: deps.networkBuffer,
			performWipe: deps.performWipe,
		},
		{ continueOnError, onStep },
	);
	const durationMs = Date.now() - startTime;

	const allPassed = results.every((r) => r.passed);

	// Fire webhook notification (non-blocking)
	if (webhookUrl) {
		const payload = formatFlowWebhookPayload(flowName, results, durationMs);
		sendWebhook(webhookUrl, payload);
	}

	// Streaming output returns NDJSON
	if (stream) {
		const output = streamLines.join("\n");
		return allPassed
			? { ok: true, data: output }
			: { ok: false, error: output };
	}

	if (reporter) {
		const output = formatFlowReporter(
			flowName,
			results,
			durationMs,
			reporter,
			customReporters,
			junitResult,
		);
		return allPassed
			? { ok: true, data: output }
			: { ok: false, error: output };
	}

	const report = formatFlowReport(
		flowName,
		results,
		flow.steps.length,
		screenshots,
	);

	if (allPassed) {
		return { ok: true, data: report };
	}
	return { ok: false, error: report };
}
