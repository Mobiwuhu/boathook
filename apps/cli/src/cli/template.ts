import {
	beginLogin,
	checkLogin,
	forgetLogin,
	getLogin,
	getTemplate,
	type LoginCheck,
	listTemplates,
	readTabSnapshot,
	removeSession,
	removeTemplate,
	requireLogin,
	requireSession,
	type SessionConfig,
	saveProfileTemplate,
	sessionPaths,
	sessionStatus,
	startSession,
	stopSession,
	validateConfigPlugins,
	withProfileProbe,
	withStoppedSession,
} from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { Cli, z } from "incur";
import { configJsonOption, readConfigJson } from "./config.ts";
import { writeError, writeResult } from "./output.ts";

function verifyProfile(check: LoginCheck, url: string, config: SessionConfig) {
	return (profile: string) =>
		withProfileProbe(profile, config, url, (session) =>
			requireLogin(session, check),
		);
}

export function createTemplateProgram(json: boolean) {
	const nameArgs = z.object({ name: z.string().describe("模板名") });
	const replace = z.boolean().optional().describe("保存为已有模板的新版本");
	async function perform(command: string, action: () => Promise<unknown>) {
		try {
			writeResult(`template ${command}`, await action(), { json });
		} catch (error) {
			writeError(`template ${command}`, error, json);
		}
	}
	return Cli.create("template", {
		description: "创建和复用浏览器登录模板",
	})
		.command("login", {
			description: "启动可继续操作的临时登录会话",
			args: nameArgs,
			options: z.object({
				url: z.string().url(),
				replace,
				configJson: configJsonOption.optional(),
			}),
			run: (c) =>
				perform("login", async () => {
					const config =
						c.options.configJson === undefined
							? undefined
							: await readConfigJson(c.options.configJson);
					const login = await beginLogin(
						c.args.name,
						c.options.url,
						c.options.replace === true,
						config?.login,
					);
					try {
						await startSession(login.loginSession, { url: login.url, config });
					} catch (error) {
						if (login.created)
							await forgetLogin(c.args.name, login.loginSession);
						throw error;
					}
					if (
						(await getLogin(c.args.name))?.loginSession !== login.loginSession
					) {
						await stopSession(login.loginSession);
						throw new CommandError("LOGIN_CANCELLED", "登录任务已结束。");
					}
					return {
						name: c.args.name,
						loginSession: login.loginSession,
						state: login.check
							? await checkLogin(login.loginSession, login.check)
							: "in_progress",
					};
				}),
		})
		.command("status", {
			description: "查看模板或临时登录任务",
			args: nameArgs,
			run: (c) =>
				perform("status", async () => {
					const login = await getLogin(c.args.name);
					if (login) {
						const current = await sessionStatus(login.loginSession).catch(
							() => null,
						);
						let state: string = current?.state ?? "starting";
						if (current?.state === "running")
							state = login.check
								? await checkLogin(login.loginSession, login.check)
								: "in_progress";
						return {
							name: c.args.name,
							loginSession: login.loginSession,
							state,
						};
					}
					const template = await getTemplate(c.args.name);
					if (!template)
						throw new CommandError(
							"TEMPLATE_NOT_FOUND",
							"找不到模板或登录任务。",
						);
					return template;
				}),
		})
		.command("save", {
			description: "从会话或 Chrome profile 副本保存模板",
			args: nameArgs,
			options: z.object({
				fromSession: z.string().min(1).optional().describe("要保存的会话"),
				from: z
					.string()
					.min(1)
					.optional()
					.describe("包含 Default/ 的 Chrome 用户数据目录副本"),
				url: z.string().url().optional().describe("模板的默认打开页面"),
				configJson: configJsonOption.optional(),
				replace,
			}),
			run: (c) =>
				perform("save", async () => {
					const name = c.args.name;
					const { from, fromSession, replace = false } = c.options;
					const config =
						c.options.configJson === undefined
							? undefined
							: await readConfigJson(c.options.configJson);
					if (from && !fromSession) {
						const url = c.options.url ?? config?.url;
						const check = config?.login;
						if (config && check) await validateConfigPlugins(config);
						return saveProfileTemplate(
							name,
							{ directory: from },
							url,
							replace,
							config && check
								? verifyProfile(check, url ?? "about:blank", config)
								: undefined,
						);
					}
					if (!fromSession || from) {
						throw new CommandError(
							"INVALID_OPTIONS",
							"请用 --from DIR 或 --from-session NAME 指定一个来源。",
						);
					}
					if (!replace && (await getTemplate(name))) {
						throw new CommandError(
							"TEMPLATE_EXISTS",
							"模板已存在。续登时请显式传入 --replace。",
						);
					}
					const { config: sessionConfig } = await requireSession(
						sessionPaths(fromSession),
						fromSession,
					);
					const check = config?.login ?? sessionConfig.login;
					if (check && (await sessionStatus(fromSession)).state === "running")
						await requireLogin(fromSession, check);
					const template = await withStoppedSession(
						fromSession,
						async (paths, record) => {
							const session = readTabSnapshot(paths.statePath);
							const url =
								c.options.url ??
								session?.tabs[session.activeTabIndex]?.url ??
								record.url;
							return saveProfileTemplate(
								name,
								paths.profilePath,
								url,
								replace,
								check && url
									? verifyProfile(check, url, config ?? record.config)
									: undefined,
							);
						},
					);
					await forgetLogin(name, fromSession);
					return template;
				}),
		})
		.command("ls", {
			description: "列出已保存的登录模板",
			run: () => perform("ls", listTemplates),
		})
		.command("rm", {
			description: "删除指定登录模板",
			args: nameArgs,
			options: z.object({ yes: z.boolean().optional() }),
			run: (c) =>
				perform("rm", async () => {
					if (!c.options.yes)
						throw new CommandError(
							"CONFIRM_REQUIRED",
							"请用 template rm NAME --yes 确认删除模板。",
						);
					await removeTemplate(c.args.name);
					return { name: c.args.name, removed: true };
				}),
		})
		.command("cancel", {
			description: "停止临时登录会话",
			args: nameArgs,
			run: (c) =>
				perform("cancel", async () => {
					const login = await getLogin(c.args.name);
					if (!login)
						throw new CommandError(
							"LOGIN_NOT_FOUND",
							"找不到待结束的登录任务。",
						);
					await stopSession(login.loginSession)
						.then(() => removeSession(login.loginSession))
						.catch((error) => {
							if (
								!(error instanceof CommandError) ||
								error.code !== "SESSION_NOT_FOUND"
							)
								throw error;
						});
					await forgetLogin(c.args.name, login.loginSession);
					return { name: c.args.name, state: "cancelled" };
				}),
		});
}
