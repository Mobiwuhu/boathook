import { isCommandError } from "@boathook/plugin-sdk";

export function parseCommandData(value: string, json: boolean): unknown {
	if (json) {
		try {
			return JSON.parse(value);
		} catch {
			return { text: value };
		}
	}
	return { text: value };
}

export function writeResult(
	command: string,
	data: unknown,
	options: { json?: boolean; session?: string; text?: string },
): void {
	const output = options.json
		? JSON.stringify({ ok: true, command, session: options.session, data })
		: (options.text ?? JSON.stringify(data));
	process.stdout.write(`${output}\n`);
}

export function writeError(
	command: string,
	error: unknown,
	json?: boolean,
	session?: string,
	options?: { data?: unknown; fieldErrors?: unknown; text?: string },
): void {
	const code = isCommandError(error) ? error.code : "COMMAND_FAILED";
	const message = error instanceof Error ? error.message : String(error);
	process.exitCode = isCommandError(error) ? error.exitCode : 1;
	if (json) {
		process.stdout.write(
			`${JSON.stringify({
				ok: false,
				command,
				session,
				data: options?.data,
				error: { code, message, fieldErrors: options?.fieldErrors },
			})}\n`,
		);
	} else {
		process.stderr.write(options?.text ?? `${code}: ${message}\n`);
	}
}
