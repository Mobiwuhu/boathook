import {
	DEFAULT_SESSION_IDLE_SECONDS,
	listSessions,
	removeSession,
	reseedSession,
	sessionStatus,
	startSession,
	stopSession,
} from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { Cli, z } from "incur";
import { ciOptions, initCI } from "./ci-init.ts";
import {
	configJsonOption,
	createConfigProgram,
	readConfigJson,
} from "./config.ts";
import { doctor } from "./doctor.ts";
import { selectSession } from "./options.ts";
import { writeError, writeResult } from "./output.ts";
import type { CommandTarget } from "./parse.ts";
import { runProjectScript, scriptArguments, scriptOptions } from "./script.ts";
import { createTemplateProgram } from "./template.ts";
import { upgrade, upgradeOptions } from "./upgrade.ts";

async function launchOptions(options: {
	url?: string;
	headed?: boolean;
	headless?: boolean;
	idleTimeout?: number;
	template?: string;
	configJson?: string;
}) {
	if (options.headed && options.headless) {
		throw new CommandError(
			"INVALID_OPTIONS",
			"请只选择 --headed 或 --headless。",
		);
	}
	return {
		url: options.url,
		headed: options.headless ? false : options.headed,
		idleTimeout: options.idleTimeout,
		template: options.template,
		config:
			options.configJson === undefined
				? undefined
				: await readConfigJson(options.configJson),
	};
}

export function createProgram(
	json: boolean,
	scriptArgs: string[],
	target: CommandTarget = {},
) {
	const requiredName = z.object({ name: z.string().describe("会话名") });
	const optionalName = requiredName.partial();
	const sessionOptions = z.object({
		configJson: configJsonOption
			.optional()
			.describe("会话配置 JSON，- 代表标准输入"),
		headed: z.boolean().optional().describe("打开 Chrome 窗口"),
		headless: z.boolean().optional().describe("使用无界面 Chrome"),
		idleTimeout: z
			.number()
			.int()
			.min(1)
			.max(2_147_483)
			.optional()
			.describe(`空闲关闭秒数，新会话默认 ${DEFAULT_SESSION_IDLE_SECONDS}`),
	});
	const lsOptions = z.object({ running: z.boolean().optional() });
	async function printList(command: string, running: boolean) {
		const sessions = await listSessions(running);
		writeResult(command, sessions, {
			json,
			text:
				sessions.map(({ name, state }) => `${name}\t${state}`).join("\n") ||
				"暂无会话。",
		});
	}
	async function report<T extends { name: string; state: string }>(
		command: string,
		name: string | undefined,
		action: () => Promise<T>,
	) {
		try {
			const data = await action();
			writeResult(command, data, {
				json,
				session: data.name,
				text: `${data.name}\t${data.state}`,
			});
		} catch (error) {
			writeError(command, error, json, name);
		}
	}
	function confirmed(yes: boolean | undefined): void {
		if (!yes)
			throw new CommandError(
				"CONFIRM_REQUIRED",
				"请加上 --yes 确认更改此会话的 profile。",
			);
	}
	return Cli.create("boathook", {
		description:
			"管理具名 Chrome 会话。用 boathook help COMMAND 查 boathook 页面命令。",
	})
		.command("start", {
			description: "启动或恢复浏览器会话",
			args: requiredName,
			options: sessionOptions.extend({
				url: z.string().url().optional().describe("首次打开的网页"),
				template: z.string().optional().describe("用于首次派生的登录模板"),
			}),
			run: (c) =>
				report("start", c.args.name, async () =>
					startSession(
						selectSession(c.args.name, target.session),
						await launchOptions(c.options),
					),
				),
		})
		.command("status", {
			description: "查看浏览器会话状态",
			args: optionalName,
			run: (c) =>
				report("status", c.args.name ?? target.session, () =>
					sessionStatus(selectSession(c.args.name, target.session)),
				),
		})
		.command("stop", {
			description: "关闭浏览器并保存会话状态",
			args: optionalName,
			run: (c) =>
				report("stop", c.args.name ?? target.session, () =>
					stopSession(selectSession(c.args.name, target.session)),
				),
		})
		.command("restart", {
			description: "用原 profile 重开会话",
			args: optionalName,
			options: sessionOptions,
			run: (c) =>
				report("restart", c.args.name ?? target.session, async () =>
					startSession(
						selectSession(c.args.name, target.session),
						await launchOptions(c.options),
						true,
					),
				),
		})
		.command("ls", {
			description: "列出具名浏览器会话",
			options: lsOptions,
			run: (c) => printList("ls", c.options.running === true),
		})
		.command("run", {
			description: "在当前标签页运行项目 TS 或 JS 脚本",
			args: scriptArguments,
			options: scriptOptions,
			async run(c) {
				let session: string | undefined;
				try {
					session = selectSession(undefined, target.session);
					await runProjectScript({
						session,
						file: c.args.file,
						args: scriptArgs,
						json,
						timeout: target.timeout,
						tab: target.tab,
						snapshotId: target.snapshotId,
						...c.options,
					});
				} catch (error) {
					writeError("run", error, json, session);
				}
			},
		})
		.command("doctor", {
			description: "检查 Chrome 能否启动并运行页面命令",
			async run() {
				try {
					writeResult("doctor", await doctor(), { json });
				} catch (error) {
					writeError("doctor", error, json);
				}
			},
		})
		.command("upgrade", {
			description: "检查或升级整套 boathook 发行版",
			options: upgradeOptions,
			async run({ options }) {
				try {
					const result = await upgrade(options);
					const status = {
						current: "当前版本已是最新",
						available: "有可用更新",
						upgraded: "已升级",
					};
					writeResult("upgrade", result, {
						json,
						text:
							result.state === "current"
								? `${status.current} ${result.fromVersion}`
								: `${status[result.state]} ${result.fromVersion} → ${result.toVersion}`,
					});
				} catch (error) {
					writeError("upgrade", error, json);
				}
			},
		})
		.command("ci-init", {
			description: "为当前项目生成 GitHub Actions 浏览器检查工作流",
			options: ciOptions,
			async run({ options }) {
				try {
					const result = await initCI(options);
					writeResult("ci-init", result, { json, text: result.text });
				} catch (error) {
					writeError("ci-init", error, json);
				}
			},
		})
		.command(createTemplateProgram(json))
		.command(createConfigProgram(json, target))
		.command(
			Cli.create("session", {
				description: "管理具名会话",
			})
				.command("list", {
					description: "列出具名浏览器会话",
					options: lsOptions,
					run: (c) => printList("session list", c.options.running === true),
				})
				.command("reseed", {
					description: "从模板重新派生已停止会话的 profile",
					args: requiredName,
					options: z.object({
						yes: z.boolean().optional(),
						template: z.string(),
					}),
					run: (c) =>
						report("session reseed", c.args.name, async () => {
							confirmed(c.options.yes);
							return reseedSession(
								selectSession(c.args.name, target.session),
								c.options.template,
							);
						}),
				})
				.command("rm", {
					description: "删除已停止的会话和它的 profile",
					args: requiredName,
					options: z.object({ yes: z.boolean().optional() }),
					run: (c) =>
						report("session rm", c.args.name, async () => {
							confirmed(c.options.yes);
							const name = selectSession(c.args.name, target.session);
							await removeSession(name);
							return { name, state: "removed" };
						}),
				}),
		);
}
