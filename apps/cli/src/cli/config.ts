import {
	configSummary,
	inspectConfig,
	parseConfigJson,
	requireSession,
	resolveConfig,
	running,
	runtimeConfigCommand,
	sessionPaths,
	validateConfigPlugins,
} from "@boathook/core";
import { Cli, z } from "incur";
import { selectSession } from "./options.ts";
import { writeError, writeResult } from "./output.ts";
import type { CommandTarget } from "./parse.ts";
import { requestPluginData } from "./plugins.ts";

export const configJsonOption = z
	.string()
	.describe("会话配置 JSON，- 代表标准输入");

export async function readConfigJson(value: string) {
	const text = value === "-" ? await Bun.stdin.text() : value;
	return resolveConfig(parseConfigJson(text));
}

export function createConfigProgram(json: boolean, target: CommandTarget) {
	return Cli.create("config", {
		description: "校验 JSON 或查看会话保存的配置",
	})
		.command("validate", {
			description: "校验启动 JSON 和插件选项",
			options: z.object({ configJson: configJsonOption }),
			async run(c) {
				try {
					const config = await readConfigJson(c.options.configJson);
					await validateConfigPlugins(config);
					writeResult(
						"config validate",
						{ valid: true, ...configSummary(config) },
						{ json },
					);
				} catch (error) {
					writeError("config validate", error, json);
				}
			},
		})
		.command("inspect", {
			description: "查看会话配置的位置、生效版本与插件",
			options: z.object({
				plugin: z.string().min(1).optional().describe("查看指定插件保存的选项"),
			}),
			async run(c) {
				let session: string | undefined;
				try {
					session = selectSession(undefined, target.session);
					const paths = sessionPaths(session);
					const { config } = await requireSession(paths, session);
					const active = await running(paths);
					const id = c.options.plugin;
					const data = active
						? JSON.parse(
								await requestPluginData(
									session,
									runtimeConfigCommand,
									id ? [id] : [],
									target.timeout,
								),
							)
						: { ...inspectConfig(config, id), restartRequired: false };
					const proxy = config.proxy;
					let proxyInfo: {
						enabled: boolean;
						server?: string;
						bypass?: string;
					} = { enabled: false };
					if (proxy) {
						const url = new URL(proxy.server);
						proxyInfo = {
							enabled: proxy.enabled,
							server: `${url.protocol}//${url.host}`,
							bypass: proxy.bypass,
						};
					}
					writeResult(
						"config inspect",
						{
							path: paths.sessionPath,
							state: active ? "running" : "stopped",
							...(active && { socketPath: paths.socketPath }),
							...data,
							...(!id && { proxy: proxyInfo }),
						},
						{ json, session },
					);
				} catch (error) {
					writeError("config inspect", error, json, session);
				}
			},
		});
}
