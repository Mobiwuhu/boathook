import { resolve } from "node:path";

type PathArguments = {
	position?: number;
	firstPositional?: number;
	files?: readonly string[];
	values?: readonly string[];
};

const pathArguments: ReadonlyMap<string, PathArguments> = new Map([
	[
		"screenshot",
		{
			firstPositional: 0,
			files: ["--diff"],
			values: ["--selector", "--threshold"],
		},
	],
	["auth-state save", { position: 1 }],
	["auth-state load", { position: 1 }],
	["pdf", { position: 0 }],
	["run", { position: 0 }],
	["watch", { position: 0 }],
	["flow-share import", { position: 1 }],
	["trace stop", { files: ["--out"] }],
	["trace view", { firstPositional: 1, values: ["--port"] }],
	["video stop", { files: ["--out"] }],
	["record start", { files: ["--output"], values: ["--name"] }],
	["report", { files: ["--out", "--screenshots"], values: ["--title"] }],
	["responsive", { files: ["--out"], values: ["--breakpoints", "--url"] }],
	["replay", { files: ["--out"] }],
	[
		"crawl",
		{
			files: ["--output"],
			values: [
				"--depth",
				"--extract",
				"--paginate",
				"--max-pages",
				"--rate-limit",
				"--include",
				"--exclude",
			],
		},
	],
	[
		"download wait",
		{
			files: ["--save-to"],
			values: ["--expect-type", "--expect-min-size", "--expect-max-size"],
		},
	],
	["design-audit", { files: ["--tokens"], values: ["--extract"] }],
	[
		"doc-capture",
		{ files: ["--flow", "--output", "--markdown"], values: ["--var"] },
	],
	["monitor", { files: ["--config"], values: ["--last", "--site"] }],
]);

export function resolveCommandPaths(
	command: string,
	args: string[],
	cwd: string,
): string[] {
	if (command === "upload")
		return args.map((arg, index) => (index === 0 ? arg : resolve(cwd, arg)));
	const rules =
		pathArguments.get(`${command} ${args[0]}`) ?? pathArguments.get(command);
	if (!rules) return args;
	const result = [...args];
	let foundPath = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === undefined) continue;
		const isFileFlag = rules.files?.includes(arg);
		if (isFileFlag || rules.values?.includes(arg)) {
			const value = args[index + 1];
			if (value && !value.startsWith("--")) {
				index++;
				if (isFileFlag) result[index] = resolve(cwd, value);
			}
			continue;
		}
		if (
			index === rules.position ||
			(!foundPath &&
				rules.firstPositional !== undefined &&
				index >= rules.firstPositional &&
				!arg.startsWith("--"))
		) {
			if (arg) result[index] = resolve(cwd, arg);
			foundPath = true;
		}
	}
	return result;
}

export function resolveBatchPaths(batch: unknown[], cwd: string): unknown[] {
	return batch.map((entry: unknown) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			!("cmd" in entry) ||
			typeof entry.cmd !== "string" ||
			!("args" in entry) ||
			!Array.isArray(entry.args) ||
			!entry.args.every((arg): arg is string => typeof arg === "string")
		)
			return entry;
		return { ...entry, args: resolveCommandPaths(entry.cmd, entry.args, cwd) };
	});
}
