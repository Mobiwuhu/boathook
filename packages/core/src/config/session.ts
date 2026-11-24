import { resolve } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import { installedPlugins } from "../plugins/catalog.ts";
import { pluginIdSchema } from "../plugins/manifest.ts";
import {
	importProductPlugin,
	validateRuntimeOptions,
} from "../plugins/modules.ts";
import { commandSettingsSchema } from "./schema.ts";

const pluginSchema = z.strictObject({
	id: pluginIdSchema,
	entry: z.string().min(1).optional(),
	enabled: z.boolean().default(true),
	options: z.json().optional(),
});
const proxySchema = z.strictObject({
	server: z.string().url(),
	enabled: z.boolean().default(true),
	bypass: z.string().optional(),
	username: z.string().optional(),
	password: z.string().optional(),
});
export const loginSchema = z.strictObject({
	check: z.string().min(1),
	input: z.json().optional(),
});
export type LoginCheck = z.infer<typeof loginSchema>;

export const configInputSchema = z.strictObject({
	...commandSettingsSchema.shape,
	url: z.string().url().optional(),
	browser: z.strictObject({ proxy: proxySchema.optional() }).optional(),
	login: loginSchema.optional(),
	plugins: z.array(pluginSchema).default([]),
});

const configSchema = z.strictObject({
	projectDir: z.string(),
	url: z.string().optional(),
	proxy: proxySchema.optional(),
	login: loginSchema.optional(),
	commands: commandSettingsSchema,
	plugins: z.array(
		pluginSchema.omit({ enabled: true }).required({ entry: true }).extend({
			source: z.string().optional(),
		}),
	),
});
export const sessionConfigSchema = configSchema.extend({
	revision: z.string(),
});
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type ConfigInput = z.infer<typeof configInputSchema>;
export type PluginSpec = SessionConfig["plugins"][number];

export function revisionConfig(
	value: z.infer<typeof configSchema>,
): SessionConfig {
	return {
		...value,
		revision: new Bun.CryptoHasher("sha256")
			.update(
				JSON.stringify(value, (_key, entry) => {
					if (!entry || typeof entry !== "object" || Array.isArray(entry))
						return entry;
					return Object.fromEntries(
						Object.keys(entry)
							.sort()
							.map((key) => [key, entry[key]]),
					);
				}),
			)
			.digest("hex"),
	};
}

export function parseConfigJson(text: string): ConfigInput {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CommandError("INVALID_CONFIG", "请输入有效的配置 JSON。");
	}
	const result = configInputSchema.safeParse(parsed);
	if (!result.success)
		throw new CommandError(
			"INVALID_CONFIG",
			`配置字段无效。\n${z.prettifyError(result.error)}`,
		);
	if (
		new Set(result.data.plugins.map(({ id }) => id)).size !==
		result.data.plugins.length
	)
		throw new CommandError("INVALID_CONFIG", "配置中的插件 ID 必须唯一。");
	return result.data;
}

export async function resolveConfig(
	input: ConfigInput,
	projectDir = process.cwd(),
): Promise<SessionConfig> {
	const { plugins: declared, url, browser, login, ...commands } = input;
	const plugins: PluginSpec[] = [];
	const enabled = declared.filter(({ enabled }) => enabled);
	const installed = enabled.some(({ entry }) => !entry)
		? await installedPlugins()
		: undefined;
	for (const { id, entry, options } of enabled) {
		if (!entry) {
			const plugin = installed?.get(id);
			if (!plugin)
				throw new CommandError(
					"PLUGIN_NOT_INSTALLED",
					`请安装插件 ${id} 或在 JSON 中指定 entry。`,
				);
			plugins.push({ id, options, entry: plugin.entry, source: plugin.source });
			continue;
		}
		try {
			plugins.push({
				id,
				options,
				entry: Bun.resolveSync(entry, projectDir),
				source: entry,
			});
		} catch {
			throw new CommandError(
				"PLUGIN_ENTRY_NOT_FOUND",
				`找不到插件 ${id} 的入口 ${entry}。`,
			);
		}
	}
	if (new Set(plugins.map(({ entry }) => entry)).size !== plugins.length)
		throw new CommandError("INVALID_CONFIG", "同一个插件入口只能声明一次。");
	return revisionConfig({
		projectDir,
		...(url !== undefined && { url }),
		...(browser?.proxy && { proxy: browser.proxy }),
		...(login && {
			login: { ...login, check: resolve(projectDir, login.check) },
		}),
		commands,
		plugins,
	});
}

export async function requireLoginCheckFile(login?: LoginCheck): Promise<void> {
	if (login && !(await Bun.file(login.check).exists()))
		throw new CommandError(
			"LOGIN_CHECK_NOT_FOUND",
			"找不到 login.check 脚本，请检查路径。",
		);
}

export async function validateConfigPlugins(
	config: SessionConfig,
): Promise<void> {
	await requireLoginCheckFile(config.login);
	await Promise.all(
		config.plugins.map(async ({ entry, id, options }) => {
			validateRuntimeOptions(await importProductPlugin(entry, id), options);
		}),
	);
}

export function configSummary(config: SessionConfig) {
	return {
		revision: config.revision,
		plugins: config.plugins.map(({ id, entry, source }) => ({
			id,
			entry,
			source,
		})),
	};
}

export function inspectConfig(config: SessionConfig, id?: string) {
	if (!id) return configSummary(config);
	const plugin = config.plugins.find((spec) => spec.id === id);
	if (!plugin)
		throw new CommandError("PLUGIN_NOT_ENABLED", `此会话未启用插件 ${id}。`);
	return { revision: config.revision, plugin };
}
