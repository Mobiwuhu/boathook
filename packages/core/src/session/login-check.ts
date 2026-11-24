import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import type { LoginCheck } from "../config/session.ts";
import { sessionRequest } from "./request.ts";

const checkResult = z.object({
	state: z.enum([
		"ready",
		"in_progress",
		"needs_user_auth",
		"expired",
		"failed",
	]),
});

export async function checkLogin(session: string, check: LoginCheck) {
	const response = await sessionRequest(session, {
		cmd: "run",
		args: [
			check.check,
			check.input === undefined ? "" : JSON.stringify(check.input),
		],
	});
	if (!response.ok || !("data" in response))
		throw new CommandError(
			"LOGIN_CHECK_FAILED",
			"登录检查脚本执行失败，请检查 login.check。",
			1,
		);
	const parsed = checkResult.safeParse(JSON.parse(response.data));
	if (!parsed.success)
		throw new CommandError(
			"LOGIN_CHECK_FAILED",
			"login.check 应返回带有效 state 的对象。",
			1,
		);
	return parsed.data.state;
}

export async function requireLogin(
	session: string,
	check: LoginCheck,
): Promise<void> {
	const state = await checkLogin(session, check);
	if (state !== "ready")
		throw new CommandError(
			"NEEDS_LOGIN",
			`会话 ${session} 的登录检查为 ${state}，请完成站点登录后重试。`,
			4,
		);
}
