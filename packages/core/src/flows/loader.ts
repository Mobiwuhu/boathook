import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "incur";
import { type FlowConfig, flowSchema } from "../config/schema.ts";
import { stateRoot } from "../paths.ts";

export type FlowSource =
	| { type: "inline" }
	| { type: "file"; path: string; directory: "local" | "global" };

export type FlowDirectory = {
	path: string;
	type: "local" | "global";
};

const VALID_FLOW_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isValidFlowName(name: string): boolean {
	return VALID_FLOW_NAME_RE.test(name);
}

/**
 * Discover flow directories in precedence order (local first, then global).
 */
export function discoverFlowDirectories(
	projectDir?: string,
	globalFlowsDir = join(stateRoot(), "flows"),
): FlowDirectory[] {
	const dirs: FlowDirectory[] = [];

	if (projectDir) {
		const localFlowsDir = join(projectDir, "flows");
		if (existsSync(localFlowsDir)) {
			dirs.push({ path: localFlowsDir, type: "local" });
		}
	}

	if (globalFlowsDir !== dirs[0]?.path && existsSync(globalFlowsDir)) {
		dirs.push({ path: globalFlowsDir, type: "global" });
	}

	return dirs;
}

/**
 * Load and validate a single flow JSON file.
 */
export function loadFlowFile(filePath: string): {
	flow: FlowConfig | null;
	error: string | null;
} {
	const name = basename(filePath);

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return { flow: null, error: `Flow file not found: ${name}` };
		}
		return { flow: null, error: `Failed to read flow file: ${name}` };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const detail = err instanceof SyntaxError ? err.message : "invalid JSON";
		return {
			flow: null,
			error: `Failed to parse flow file ${name}: ${detail}`,
		};
	}

	const result = flowSchema.safeParse(parsed);
	return result.success
		? { flow: result.data, error: null }
		: {
				flow: null,
				error: `Invalid flow file ${name}\n${z.prettifyError(result.error)}`,
			};
}

/**
 * Load all flow files from the given directories.
 * Earlier directories take precedence over later ones.
 */
export function loadFlowsFromDirectories(dirs: FlowDirectory[]): {
	flows: Record<string, FlowConfig>;
	errors: string[];
	sources: Map<string, FlowSource>;
} {
	const flows: Record<string, FlowConfig> = {};
	const errors: string[] = [];
	const sources = new Map<string, FlowSource>();

	for (const dir of dirs) {
		let files: string[];
		try {
			files = readdirSync(dir.path).filter((f) => f.endsWith(".json"));
		} catch {
			errors.push(`Failed to read flows directory: ${dir.path}`);
			continue;
		}

		for (const file of files) {
			const flowName = basename(file, ".json");

			if (!isValidFlowName(flowName)) {
				errors.push(
					`Skipping flow file ${file}: invalid flow name '${flowName}'.`,
				);
				continue;
			}

			// Higher-precedence directory wins
			if (Object.hasOwn(flows, flowName)) {
				continue;
			}

			const filePath = join(dir.path, file);
			const { flow, error } = loadFlowFile(filePath);

			if (error) {
				errors.push(error);
				continue;
			}

			if (flow) {
				flows[flowName] = flow;
				sources.set(flowName, {
					type: "file",
					path: filePath,
					directory: dir.type,
				});
			}
		}
	}

	return { flows, errors, sources };
}

/**
 * Merge inline flows (from config) with file-based flows.
 * Inline flows take precedence.
 */
export function mergeFlows(
	inlineFlows: Record<string, FlowConfig> | undefined,
	fileFlows: Record<string, FlowConfig>,
	fileSources: Map<string, FlowSource>,
): { merged: Record<string, FlowConfig>; sources: Map<string, FlowSource> } {
	const merged: Record<string, FlowConfig> = {};
	const sources = new Map<string, FlowSource>();

	// File flows first (lower precedence)
	for (const [name, flow] of Object.entries(fileFlows)) {
		merged[name] = flow;
		const source = fileSources.get(name);
		if (source) {
			sources.set(name, source);
		}
	}

	// Inline flows override
	if (inlineFlows) {
		for (const [name, flow] of Object.entries(inlineFlows)) {
			merged[name] = flow;
			sources.set(name, { type: "inline" });
		}
	}

	return { merged, sources };
}
