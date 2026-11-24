import { Parser, type z } from "incur";
import { CommandError, isCommandError } from "./errors.ts";
import type {
	CommandContext,
	ConfigCommandResult,
	PluginCommand,
	Response,
} from "./types.ts";

export function pluginResponse(data: unknown): Response {
	return { ok: true, data: JSON.stringify(data) ?? "null" };
}

export function pluginError(error: unknown): Response {
	if (isCommandError(error)) {
		return {
			ok: false,
			error: error.message,
			code: error.code,
			exitCode: error.exitCode,
		};
	}
	return {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

/** Define one argument schema for daemon calls and help. */
export function defineCommand<
	Args extends z.ZodObject | undefined = undefined,
	Flags extends z.ZodObject | undefined = undefined,
>(
	command: Pick<PluginCommand, "name" | "summary" | "usage"> & {
		args?: Args;
		flags?: Flags;
		configure?: (
			input: Parser.parse.ReturnType<Args, Flags>,
			options: unknown,
		) => ConfigCommandResult | Promise<ConfigCommandResult>;
		run?: (
			context: CommandContext & {
				input: Parser.parse.ReturnType<Args, Flags>;
			},
		) => unknown;
	},
): PluginCommand {
	const { name, summary, usage, args, flags, configure, run } = command;
	function parse(argv: string[]) {
		try {
			return Parser.parse(argv, { args, options: flags });
		} catch {
			throw new CommandError(
				"INVALID_ARGUMENTS",
				`参数无效，请检查用法。\n${usage}`,
			);
		}
	}
	const metadata = {
		name,
		summary,
		usage,
		input: { args, flags },
	};
	if (configure && !run) {
		return {
			...metadata,
			configure: async (argv, options) => configure(parse(argv), options),
		};
	}
	if (!run || configure)
		throw new Error(
			`Plugin command ${name} requires exactly one of run or configure.`,
		);
	return {
		...metadata,
		async handler(context) {
			try {
				return pluginResponse(
					await run({ ...context, input: parse(context.args) }),
				);
			} catch (error) {
				return pluginError(error);
			}
		},
	};
}
