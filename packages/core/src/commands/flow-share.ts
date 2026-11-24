import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { CommandConfig } from "../config/schema.ts";
import type { Response } from "../ipc/protocol.ts";
import { stateRoot } from "../paths.ts";

function registryDirectory(): string {
	return join(stateRoot(), "flow-registry");
}

/** Sanitise a flow name to prevent path traversal. */
function sanitizeFlowName(name: string): string {
	return basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** Validate that a registry path stays inside registryDirectory(). */
function safeRegistryPath(flowName: string): string {
	const sanitized = sanitizeFlowName(flowName);
	const target = resolve(registryDirectory(), `${sanitized}.flow.json`);
	if (!target.startsWith(resolve(registryDirectory()))) {
		throw new Error(`Invalid flow name: ${flowName}`);
	}
	return target;
}

/**
 * Flow sharing: export, import, and manage reusable flow definitions.
 *
 * Usage:
 *   boathook --session NAME flow-share export <name>                    Export a flow to a shareable JSON file
 *   boathook --session NAME flow-share import <path-or-url>             Import a flow from a file or URL
 *   boathook --session NAME flow-share list                              List installed shared flows
 *   boathook --session NAME flow-share install <github-shorthand>        Install from GitHub (e.g., user/repo/flow-name)
 *   boathook --session NAME flow-share publish <name>                    Export flow to registry directory for sharing
 */
export async function handleFlowShare(
	config: CommandConfig | null,
	args: string[],
): Promise<Response> {
	const subcommand = args[0];

	switch (subcommand) {
		case "export":
			return handleExport(config, args.slice(1));
		case "import":
			return handleImport(args.slice(1));
		case "list":
			return handleList();
		case "install":
			return handleInstall(args.slice(1));
		case "publish":
			return handlePublish(config, args.slice(1));
		default:
			return {
				ok: false,
				error:
					"Usage: boathook --session NAME flow-share <export|import|list|install|publish>\n\n" +
					"  export <name>              Export a flow from config to a .flow.json file\n" +
					"  import <path>              Import a .flow.json file into the local registry\n" +
					"  list                       List installed shared flows\n" +
					"  install <user/repo/flow>   Install a flow from a GitHub repository\n" +
					"  publish <name>             Publish a flow to the local registry for sharing",
			};
	}
}

function handleExport(config: CommandConfig | null, args: string[]): Response {
	const flowName = args[0];
	if (!flowName) {
		return {
			ok: false,
			error: "Usage: boathook --session NAME flow-share export <flow-name>",
		};
	}

	if (!config?.flows?.[flowName]) {
		const available = config?.flows
			? Object.keys(config.flows).join(", ")
			: "none";
		return {
			ok: false,
			error: `Flow '${flowName}' not found. Available: ${available}`,
		};
	}

	const flow = config.flows[flowName];
	const exportData = {
		name: flowName,
		version: "1.0.0",
		description: flow.description ?? "",
		variables: flow.variables ?? [],
		steps: flow.steps,
		metadata: {
			exportedAt: new Date().toISOString(),
			source: "boathook-cli",
		},
	};

	const outPath = `${sanitizeFlowName(flowName)}.flow.json`;
	try {
		writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to write ${outPath}: ${message}` };
	}

	return {
		ok: true,
		data: `Flow '${flowName}' exported to ${outPath}\n\nShare this file or commit it to your repository.\nOthers can import it with: boathook --session NAME flow-share import ${outPath}`,
	};
}

function handleImport(args: string[]): Response {
	const source = args[0];
	if (!source) {
		return {
			ok: false,
			error:
				"Usage: boathook --session NAME flow-share import <path-to-flow.json>",
		};
	}

	if (!existsSync(source)) {
		return {
			ok: false,
			error: `File not found: ${source}`,
		};
	}

	let raw: string;
	try {
		raw = readFileSync(source, "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to read ${source}: ${message}` };
	}

	let flowData: Record<string, unknown>;
	try {
		flowData = JSON.parse(raw);
	} catch {
		return { ok: false, error: `Invalid JSON in ${source}` };
	}

	const flowName = sanitizeFlowName(
		String(flowData.name ?? basename(source, ".flow.json")),
	);

	// Save to registry
	mkdirSync(registryDirectory(), { recursive: true });
	const registryPath = safeRegistryPath(flowName);
	try {
		writeFileSync(registryPath, JSON.stringify(flowData, null, 2), "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to write to registry: ${message}` };
	}

	return {
		ok: true,
		data: `Flow '${flowName}' imported to registry.\nPath: ${registryPath}\n\nTo use in your config, add the flow steps to your session configuration flows section.`,
	};
}

function handleList(): Response {
	mkdirSync(registryDirectory(), { recursive: true });

	const files = readdirSync(registryDirectory()).filter((f) =>
		f.endsWith(".flow.json"),
	);

	if (files.length === 0) {
		return {
			ok: true,
			data: "No shared flows installed.\n\nImport flows with: boathook --session NAME flow-share import <path>\nOr install from GitHub: boathook --session NAME flow-share install <user/repo/flow>",
		};
	}

	const lines: string[] = [];
	lines.push(`Installed flows (${files.length}):`);
	lines.push("");

	for (const file of files) {
		const path = join(registryDirectory(), file);
		try {
			const data = JSON.parse(readFileSync(path, "utf-8"));
			const name = data.name ?? basename(file, ".flow.json");
			const desc = data.description ? ` — ${data.description}` : "";
			const steps = Array.isArray(data.steps) ? data.steps.length : 0;
			const vars =
				Array.isArray(data.variables) && data.variables.length > 0
					? `\n    Variables: ${data.variables.join(", ")}`
					: "";
			lines.push(`  ${name}${desc}`);
			lines.push(`    ${steps} steps${vars}`);
			lines.push(`    Path: ${path}`);
			lines.push("");
		} catch {
			lines.push(`  ${basename(file, ".flow.json")} (unreadable)`);
			lines.push("");
		}
	}

	return { ok: true, data: lines.join("\n").trimEnd() };
}

async function handleInstall(args: string[]): Promise<Response> {
	const shorthand = args[0];
	if (!shorthand) {
		return {
			ok: false,
			error:
				"Usage: boathook --session NAME flow-share install <user/repo/flow-name>\n\nFetches a .flow.json from a GitHub repository's root or flows/ directory.",
		};
	}

	const parts = shorthand.split("/");
	if (parts.length < 2) {
		return {
			ok: false,
			error:
				"Expected format: <user/repo> or <user/repo/flow-name>\nExample: boathook --session NAME flow-share install acme/qa-flows/checkout",
		};
	}

	const [user, repo, ...flowParts] = parts;
	const flowFile =
		flowParts.length > 0
			? `${flowParts.join("/")}.flow.json`
			: "default.flow.json";

	// Try fetching from GitHub raw content
	const urls = [
		`https://raw.githubusercontent.com/${user}/${repo}/main/flows/${flowFile}`,
		`https://raw.githubusercontent.com/${user}/${repo}/main/${flowFile}`,
		`https://raw.githubusercontent.com/${user}/${repo}/master/flows/${flowFile}`,
		`https://raw.githubusercontent.com/${user}/${repo}/master/${flowFile}`,
	];

	let rawContent: string | undefined;
	let fetchedUrl: string | undefined;
	let lastError: string | undefined;

	for (const url of urls) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				rawContent = await response.text();
				fetchedUrl = url;
				break;
			}
			lastError = `HTTP ${response.status}`;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
	}

	if (!rawContent) {
		return {
			ok: false,
			error: `Could not fetch flow from ${user}/${repo}/${flowFile}.${lastError ? ` Last error: ${lastError}` : ""}\nTried:\n${urls.map((u) => `  ${u}`).join("\n")}`,
		};
	}

	let flowData: Record<string, unknown>;
	try {
		flowData = JSON.parse(rawContent);
	} catch {
		return {
			ok: false,
			error: `Invalid JSON from ${fetchedUrl}`,
		};
	}

	const flowName = sanitizeFlowName(
		String(flowData.name ?? basename(flowFile, ".flow.json")),
	);

	mkdirSync(registryDirectory(), { recursive: true });
	const registryPath = safeRegistryPath(flowName);
	try {
		writeFileSync(registryPath, JSON.stringify(flowData, null, 2), "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: `Failed to write to registry: ${message}`,
		};
	}

	return {
		ok: true,
		data: `Flow '${flowName}' installed from ${fetchedUrl}\nPath: ${registryPath}\n\nTo use, add the flow to your session configuration or reference it by name.`,
	};
}

function handlePublish(config: CommandConfig | null, args: string[]): Response {
	const flowName = args[0];
	if (!flowName) {
		return {
			ok: false,
			error: "Usage: boathook --session NAME flow-share publish <flow-name>",
		};
	}

	if (!config?.flows?.[flowName]) {
		const available = config?.flows
			? Object.keys(config.flows).join(", ")
			: "none";
		return {
			ok: false,
			error: `Flow '${flowName}' not found. Available: ${available}`,
		};
	}

	const flow = config.flows[flowName];
	const exportData = {
		name: flowName,
		version: "1.0.0",
		description: flow.description ?? "",
		variables: flow.variables ?? [],
		steps: flow.steps,
		metadata: {
			publishedAt: new Date().toISOString(),
			source: "boathook-cli",
		},
	};

	mkdirSync(registryDirectory(), { recursive: true });
	const registryPath = safeRegistryPath(flowName);
	try {
		writeFileSync(registryPath, JSON.stringify(exportData, null, 2), "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Failed to write to registry: ${message}` };
	}

	return {
		ok: true,
		data: `Flow '${flowName}' published to local registry.\nPath: ${registryPath}\n\nTo share with others:\n  1. Copy ${registryPath} to your repo\n  2. Others install with: boathook --session NAME flow-share import <path>`,
	};
}
