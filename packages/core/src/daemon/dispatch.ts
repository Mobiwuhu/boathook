import { pluginError } from "@boathook/plugin-sdk";
import {
	type BatchItemResponse,
	type BatchRequest,
	type CommandFailure,
	isBatchRequest,
	type ProtocolResponse,
	type Request,
	type Response,
} from "../ipc/protocol.ts";
import { CommandTimeout, withTimeout } from "../timeout.ts";

export function notStarted(): CommandFailure {
	return {
		ok: false,
		code: "COMMAND_NOT_STARTED",
		error: "等待会话空闲超时，命令尚未执行。",
		exitCode: 3,
	};
}

export class CommandScheduler {
	private queue = Promise.resolve();
	private active?: Promise<void>;

	constructor(private readonly onSettled: () => void) {}

	get busy(): boolean {
		return this.active !== undefined;
	}

	enqueue(run: () => Promise<void>, timeout?: number): Promise<boolean> {
		const result = Promise.withResolvers<boolean>();
		const deadline =
			timeout === undefined ? undefined : performance.now() + timeout;
		const timer =
			timeout === undefined
				? undefined
				: setTimeout(() => result.resolve(false), timeout);
		this.queue = this.queue.then(async () => {
			if (timer) clearTimeout(timer);
			if (deadline !== undefined && performance.now() >= deadline) {
				result.resolve(false);
				return;
			}
			try {
				await run();
				result.resolve(true);
			} catch (error) {
				result.reject(error);
			}
			// A client can receive a timeout while the operation still owns the session.
			await this.active;
		});
		return result.promise;
	}

	async execute(
		run: () => Promise<Response>,
		timeout?: number,
	): Promise<Response> {
		const operation = run();
		const release = () => {
			this.active = undefined;
			this.onSettled();
		};
		this.active = operation.then(release, release);
		if (timeout === undefined) return operation;
		try {
			return await withTimeout(() => operation, timeout);
		} catch (error) {
			if (!(error instanceof CommandTimeout)) throw error;
			return {
				ok: false,
				code: "COMMAND_OUTCOME_UNKNOWN",
				error: `命令已开始，等待结果超过 ${timeout} 毫秒。请先检查会话状态再决定是否重试。`,
				exitCode: 3,
			};
		}
	}
}

type Execute = (request: Request) => Promise<Response>;

export async function dispatchRequest(
	request: Request | BatchRequest,
	execute: Execute,
): Promise<ProtocolResponse> {
	function invalidTarget(): CommandFailure {
		return {
			ok: false,
			code: "INVALID_SESSION_TARGET",
			error: "请用 CLI 的 --session 选择受管会话，并用 --tab 选择标签。",
			exitCode: 2,
		};
	}
	async function executeOne(entry: Request): Promise<Response> {
		if (entry.session !== undefined) return invalidTarget();
		try {
			return await execute(entry);
		} catch (error) {
			return pluginError(error);
		}
	}

	if (!isBatchRequest(request)) return executeOne(request);
	if (request.session !== undefined) return invalidTarget();
	const results: BatchItemResponse[] = [];
	for (const entry of request.batch) {
		const response = await executeOne({
			...entry,
			tab: entry.tab ?? request.tab,
			snapshotId: entry.snapshotId ?? request.snapshotId,
			timeout: entry.timeout ?? request.timeout,
			session: entry.session ?? request.session,
			json: entry.json ?? request.json,
			token: request.token,
		});
		results.push({ cmd: entry.cmd, ...response });
		if (
			!response.ok &&
			(!request.continueOnError || response.code === "COMMAND_OUTCOME_UNKNOWN")
		)
			return { ok: true, batch: results, stoppedEarly: true };
	}
	return { ok: true, batch: results };
}
