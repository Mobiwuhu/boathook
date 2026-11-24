import type { Response } from "@boathook/plugin-sdk";
import { BUILTIN_COMMANDS, type Command } from "../commands/catalog.ts";
import { MAX_TIMEOUT_MS } from "../timeout.ts";

export const pluginInfoCommand = "boathook:plugins";
export const runtimeConfigCommand = "boathook:config:inspect";
export const shutdownCommand = "boathook:shutdown";

export type Request = {
	cmd: Command | typeof shutdownCommand;
	args: string[];
	tab?: string;
	snapshotId?: string;
	timeout?: number;
	/** An unsupported in-daemon session target, validated by the dispatcher */
	session?: string;
	/** Request JSON output format */
	json?: boolean;
	/** Authentication token for socket security */
	token?: string;
	queueTimeout?: number;
};

export type BatchCommandRequest = {
	cmd: Command;
	args: string[];
	tab?: string;
	snapshotId?: string;
	timeout?: number;
	session?: string;
	json?: boolean;
};

export type BatchRequest = {
	batch: BatchCommandRequest[];
	tab?: string;
	snapshotId?: string;
	continueOnError?: boolean;
	timeout?: number;
	session?: string;
	json?: boolean;
	token?: string;
	queueTimeout?: number;
};

export type { CommandFailure, Response } from "@boathook/plugin-sdk";

export type BatchItemResponse = Response & { cmd: string };

export type BatchResponse = {
	ok: true;
	batch: BatchItemResponse[];
	stoppedEarly?: boolean;
};

export type ProtocolResponse = Response | BatchResponse;

function parseCommonFields(obj: Record<string, unknown>): {
	timeout: number | undefined;
	session: string | undefined;
	json: boolean;
	token: string | undefined;
} {
	const timeout =
		typeof obj.timeout === "number" &&
		Number.isSafeInteger(obj.timeout) &&
		obj.timeout > 0 &&
		obj.timeout <= MAX_TIMEOUT_MS
			? obj.timeout
			: undefined;

	const rawSession =
		typeof obj.session === "string" ? obj.session.trim() : undefined;
	const session = rawSession && rawSession.length > 0 ? rawSession : undefined;

	const json = obj.json === true;

	const rawToken = typeof obj.token === "string" ? obj.token.trim() : undefined;
	const token = rawToken && rawToken.length > 0 ? rawToken : undefined;

	return { timeout, session, json, token };
}

function queueTimeoutField(obj: Record<string, unknown>) {
	const ms = obj.queueTimeout;
	return typeof ms === "number" && Number.isSafeInteger(ms) && ms > 0
		? { queueTimeout: Math.min(ms, MAX_TIMEOUT_MS) }
		: {};
}

function parseCommandRequest(
	obj: Record<string, unknown>,
	extraCommands?: ReadonlySet<string>,
): Request {
	if (typeof obj.cmd !== "string") {
		throw new Error("Missing cmd field");
	}

	if (!Array.isArray(obj.args)) {
		throw new Error("Missing args field");
	}
	if (!obj.args.every((arg) => typeof arg === "string"))
		throw new Error("Command args must be strings");

	const cmd = obj.cmd as string;
	if (
		cmd !== shutdownCommand &&
		!BUILTIN_COMMANDS.has(cmd) &&
		!extraCommands?.has(cmd)
	) {
		throw new Error(`Unknown command: ${cmd}`);
	}

	const common = parseCommonFields(obj);

	return {
		cmd: cmd as Request["cmd"],
		args: obj.args as string[],
		...(typeof obj.tab === "string" && { tab: obj.tab }),
		...(typeof obj.snapshotId === "string" && { snapshotId: obj.snapshotId }),
		timeout: common.timeout,
		session: common.session,
		json: common.json,
		token: common.token,
		...queueTimeoutField(obj),
	};
}

export function parseRequest(
	raw: string,
	extraCommands?: ReadonlySet<string>,
): Request | BatchRequest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Invalid JSON");
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Missing cmd field");
	}

	const obj = parsed as Record<string, unknown>;

	if (Array.isArray(obj.batch)) {
		const common = parseCommonFields(obj);
		const batch = obj.batch.map((entry) => {
			if (typeof entry !== "object" || entry === null) {
				throw new Error("Invalid batch entry");
			}
			const parsedEntry = parseCommandRequest(
				entry as Record<string, unknown>,
				extraCommands,
			);
			if (parsedEntry.cmd === shutdownCommand)
				throw new Error("Shutdown must be requested outside a batch.");
			return {
				cmd: parsedEntry.cmd,
				args: parsedEntry.args,
				...(parsedEntry.tab && { tab: parsedEntry.tab }),
				...(parsedEntry.snapshotId && { snapshotId: parsedEntry.snapshotId }),
				timeout: parsedEntry.timeout,
				session: parsedEntry.session,
				// Preserve absence so the batch-level json flag can apply as
				// a fallback when the entry doesn't specify one
				json:
					(entry as Record<string, unknown>).json === undefined
						? undefined
						: parsedEntry.json,
			};
		});

		return {
			batch,
			...(typeof obj.tab === "string" && { tab: obj.tab }),
			...(typeof obj.snapshotId === "string" && { snapshotId: obj.snapshotId }),
			continueOnError: obj.continueOnError === true,
			timeout: common.timeout,
			session: common.session,
			json: common.json,
			token: common.token,
			...queueTimeoutField(obj),
		};
	}

	return parseCommandRequest(obj, extraCommands);
}

export function isBatchRequest(
	request: Request | BatchRequest,
): request is BatchRequest {
	return "batch" in request;
}

export function isBatchResponse(
	response: ProtocolResponse,
): response is BatchResponse {
	return "batch" in response;
}

export function serialiseResponse(response: ProtocolResponse): string {
	return `${JSON.stringify(response)}\n`;
}
