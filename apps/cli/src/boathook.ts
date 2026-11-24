import {
	BUILTIN_COMMANDS,
	isBatchResponse,
	sessionRequest,
} from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { readBatchPayload, writeBatch } from "./cli/batch.ts";
import { commandHelp, describeCommands, helpFor } from "./cli/discovery.ts";
import { globalFlags, selectSession } from "./cli/options.ts";
import { parseCommandData, writeError, writeResult } from "./cli/output.ts";
import { jsonForInvalidGlobalArgs, parseArgs } from "./cli/parse.ts";
import { resolveCommandPaths } from "./cli/paths.ts";
import { runPluginCommand } from "./cli/plugins.ts";
import { createProgram } from "./cli/program.ts";
import { generateCompletions } from "./completions.ts";
import { formatVersion } from "./version.ts";

async function run(argv: string[]): Promise<void> {
	if (argv[0] === "--boathook-daemon") {
		const { runSessionDaemon } = await import("@boathook/core/daemon");
		await runSessionDaemon();
		return;
	}
	const separator = argv.indexOf("--");
	const prefix = separator === -1 ? argv : argv.slice(0, separator);
	const rawArgs = separator === -1 ? [] : argv.slice(separator + 1);
	let command = "boathook";
	let session: string | undefined;
	let json: boolean | undefined;
	try {
		const parsed = parseArgs(prefix);
		const { cmd, args, session: selected, tab, snapshotId, timeout } = parsed;
		command = cmd;
		json = parsed.json;
		session = selected;
		if (cmd === "--version" || cmd === "version") {
			const version = formatVersion();
			writeResult("version", { version }, { json, text: version });
			return;
		}
		if (cmd === "plugin") {
			session ??=
				args[0] === "install" ? undefined : process.env.BOATHOOK_SESSION;
			command = [cmd, ...args.slice(0, 1)].join(" ");
			await runPluginCommand({
				session,
				args: separator === -1 ? args : [...args, "--", ...rawArgs],
				json,
				timeout,
				tab,
				snapshotId,
				onCommand: (name) => {
					command = name;
				},
			});
			return;
		}
		const program = createProgram(json, rawArgs, parsed);
		if (
			["--llms", "--llms-full", "help", "--help", "-h", "completions"].includes(
				cmd,
			) ||
			args.some((arg) => arg === "--help" || arg === "-h")
		) {
			const commands = await describeCommands(
				program,
				cmd === "--llms" || cmd === "--llms-full" || cmd === "completions"
					? parsed
					: undefined,
			);
			if (cmd === "completions") {
				const script = generateCompletions(args[0] ?? "bash", commands);
				if (!script)
					throw new CommandError("INVALID_SHELL", "请使用 bash、zsh 或 fish。");
				writeResult(cmd, { script }, { json, text: script.trimEnd() });
				return;
			}
			const { name, matches } = helpFor(commands, cmd, args);
			if (!matches.length)
				throw new CommandError("COMMAND_NOT_FOUND", `找不到命令 ${name}。`);
			const text =
				name || cmd === "--llms-full"
					? matches.map(commandHelp).join("\n\n")
					: [
							"boathook [global options] <command>",
							`Global options before the command: ${globalFlags.join(" ")}`,
							...matches.map((item) => `  ${item.name}  ${item.description}`),
						].join("\n");
			writeResult(
				cmd,
				{ commands: matches, globals: globalFlags },
				{ json, text },
			);
			return;
		}
		const daemonCommand =
			cmd === "batch" || (BUILTIN_COMMANDS.has(cmd) && cmd !== "status");
		if (!daemonCommand) {
			if (
				["config", "session", "template"].includes(cmd) &&
				args[0] &&
				!args[0].startsWith("-")
			)
				command = `${cmd} ${args[0]}`;
			// Incur reserves these flags when serving its native commands.
			const outputFlag = args.find(
				(arg) => arg === "--json" || arg === "--format",
			);
			if (outputFlag)
				throw new CommandError(
					"INVALID_ARGUMENTS",
					`请把 ${outputFlag} 放在命令前面。`,
				);
			let output = "";
			let exitCode = 0;
			await program.serve(["--format", "json", cmd, ...args], {
				stdout: (chunk) => {
					output += chunk;
				},
				exit: (code) => {
					exitCode = code;
				},
			});
			if (exitCode !== 0) {
				let failure: {
					code?: string;
					message?: string;
					fieldErrors?: unknown;
				} = {};
				try {
					failure = JSON.parse(output);
				} catch {
					/* Use captured diagnostic text. */
				}
				const code = failure.code ?? "INVALID_ARGUMENTS";
				writeError(
					command,
					new CommandError(
						code,
						failure.message ?? output.trim(),
						code === "VALIDATION_ERROR" ? 2 : exitCode,
					),
					json,
					session,
					{ fieldErrors: failure.fieldErrors },
				);
			}
			return;
		}
		session = selectSession(undefined, session);
		const payload =
			cmd === "batch"
				? await readBatchPayload(args)
				: {
						cmd,
						args: resolveCommandPaths(
							cmd,
							separator === -1 ? args : [...args, "--", ...rawArgs],
							process.cwd(),
						),
					};
		const response = await sessionRequest(session, {
			...payload,
			...(tab !== undefined && { tab }),
			...(snapshotId !== undefined && { snapshotId }),
			...(timeout !== undefined && { timeout }),
			json,
		});
		if (!response.ok)
			throw new CommandError(
				response.code ?? "COMMAND_FAILED",
				response.error,
				response.exitCode ?? 1,
			);
		if (isBatchResponse(response)) writeBatch(response, json, session);
		else
			writeResult(cmd, parseCommandData(response.data, json), {
				json,
				session,
				text: response.data,
			});
	} catch (error) {
		writeError(
			command,
			error,
			json ?? jsonForInvalidGlobalArgs(prefix),
			session,
		);
	}
}

if (import.meta.main) await run(process.argv.slice(2));
