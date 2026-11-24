import { existsSync } from "node:fs";
import { CommandError } from "@boathook/plugin-sdk";
import { readToken } from "../ipc/auth.ts";
import { sendPayload } from "../ipc/client.ts";
import { MAX_TIMEOUT_MS, resolveTimeout } from "../timeout.ts";
import { type SessionPaths, sessionPaths } from "./paths.ts";
import { readProcess, readSession } from "./store.ts";

export async function running(paths: SessionPaths) {
	const processInfo = await readProcess(paths.processPath);
	if (
		processInfo?.socketPath !== paths.socketPath ||
		!existsSync(paths.socketPath)
	)
		return null;
	const token = readToken(paths.tokenPath);
	if (!token) return null;
	try {
		process.kill(processInfo.pid, 0);
		return { ...processInfo, token };
	} catch {
		return null;
	}
}

export async function requireSession(paths: SessionPaths, name: string) {
	const record = await readSession(paths.sessionPath);
	if (record?.name !== name) {
		throw new CommandError(
			"SESSION_NOT_FOUND",
			`找不到会话 ${name}。请先使用 boathook start ${name} 启动它。`,
		);
	}
	return record;
}

export async function sessionRequest(
	name: string,
	payload: Record<string, unknown> & {
		timeout?: number;
		batch?: ReadonlyArray<{ timeout?: number }>;
	},
) {
	const paths = sessionPaths(name);
	const { config } = await requireSession(paths, name);
	const budget = resolveTimeout(payload.timeout, config.commands.timeout);
	const execution = payload.batch
		? payload.batch.reduce(
				(total, item) => total + resolveTimeout(item.timeout, budget),
				0,
			)
		: budget;
	const waitMs = Math.min(budget + execution + 1_000, MAX_TIMEOUT_MS);
	const active = await running(paths);
	if (!active) {
		throw new CommandError(
			"SESSION_STOPPED",
			`会话 ${name} 已停止。请使用 boathook start ${name} 重开。`,
		);
	}
	try {
		return await sendPayload(
			paths.socketPath,
			{
				...payload,
				token: active.token,
				queueTimeout: budget,
			},
			waitMs,
		);
	} catch (error) {
		if (error instanceof Error && error.message === "DAEMON_TIMEOUT") {
			throw new CommandError(
				"COMMAND_OUTCOME_UNKNOWN",
				"会话未在等待时间内返回结果。请先检查状态或页面再决定是否重试。",
				3,
			);
		}
		throw new CommandError(
			"SESSION_DISCONNECTED",
			`会话 ${name} 的连接已断开。请先查看 status。`,
			1,
		);
	}
}
