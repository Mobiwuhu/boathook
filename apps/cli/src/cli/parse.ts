import { CommandError } from "@boathook/plugin-sdk";
import { Parser, type z } from "incur";
import { globalOptions } from "./options.ts";

export type CommandTarget = Pick<
	z.infer<typeof globalOptions>,
	"session" | "tab" | "snapshotId" | "timeout"
>;
export type ParsedArgs = CommandTarget & {
	cmd: string;
	args: string[];
	json: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
	try {
		const { parsed, rest } = Parser.parseGlobals(argv, globalOptions);
		const { json, format, session, timeout, ...target } = parsed;
		const [cmd = "help", ...args] = rest;
		const options = {
			session,
			timeout,
			...target,
			json: format === undefined ? json === true : format === "json",
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
