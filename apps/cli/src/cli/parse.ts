import { CommandError } from "@boathook/plugin-sdk";
import { Parser, type z } from "incur";
import { globalOptionSpecs, globalOptions } from "./options.ts";

export type CommandTarget = Pick<
	z.infer<typeof globalOptions>,
	"session" | "tab" | "snapshotId" | "timeout"
>;
export type ParsedArgs = CommandTarget & {
	cmd: string;
	args: string[];
	json: boolean;
};

function globalArgsEnd(argv: string[]): number {
	let index = 0;
	while (index < argv.length) {
		const token = argv[index];
		const flag = token.startsWith("--no-")
			? `--${token.slice(5)}`
			: token.split("=", 1)[0];
		const option = globalOptionSpecs.find(
			({ name, flag: long }) => flag === long || flag === `--${name}`,
		);
		if (!option) break;
		index += option.takesValue && token === flag ? 2 : 1;
	}
	return index;
}

function selectsJson({
	format,
	json,
}: {
	format?: string;
	json?: boolean | string;
}): boolean {
	if (format === "json" || format === "text") return format === "json";
	return json === true || json === "true";
}

export function jsonForInvalidGlobalArgs(argv: string[]): boolean {
	const end = globalArgsEnd(argv);
	// Omit a final option with a missing value so earlier output flags still apply.
	const complete = argv.slice(0, end > argv.length ? argv.length - 1 : end);
	const { parsed } = Parser.parseGlobals(complete, globalOptions, undefined, {
		validate: false,
	});
	return selectsJson(parsed);
}

export function parseArgs(argv: string[]): ParsedArgs {
	try {
		const end = globalArgsEnd(argv);
		const { parsed } = Parser.parseGlobals(argv.slice(0, end), globalOptions);
		const { json, format, ...target } = parsed;
		const [cmd = "help", ...args] = argv.slice(end);
		const options = {
			...target,
			json: selectsJson({ json, format }),
		};
		if (/^(?:https?:\/\/|file:\/\/|about:)/i.test(cmd))
			return { cmd: "goto", args: [cmd, ...args], ...options };
		return { cmd, args, ...options };
	} catch (error) {
		throw new CommandError(
			"INVALID_ARGUMENTS",
			error instanceof Error ? error.message : String(error),
		);
	}
}
