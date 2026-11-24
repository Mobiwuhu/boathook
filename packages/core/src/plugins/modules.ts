import type { BoathookPlugin } from "@boathook/plugin-sdk";
import { CommandError } from "@boathook/plugin-sdk";
import { validatePlugin } from "./loader.ts";
import { commandWords, pluginIdentifier, pluginIdSchema } from "./manifest.ts";

export function validateProductPlugin(
	plugin: BoathookPlugin,
	id = plugin.name,
): void {
	if (!pluginIdSchema.safeParse(plugin.name).success || plugin.name !== id) {
		throw new CommandError(
			"INVALID_PLUGIN",
			`插件 ${id} 的导出名称不一致或已被保留。`,
		);
	}
	if (plugin.apiVersion !== 1) {
		throw new CommandError(
			"PLUGIN_API_UNSUPPORTED",
			`插件 ${id} 必须声明 apiVersion: 1。`,
		);
	}
	const names = new Set<string>();
	for (const command of plugin.commands ?? []) {
		if (command.configure && !plugin.hooks?.updateOptions)
			throw new CommandError(
				"INVALID_PLUGIN",
				`插件 ${id} 的配置命令需要 updateOptions 钩子。`,
			);
		const words = commandWords(command);
		const key = words.join(":");
		if (
			words[0] === "help" ||
			words.some((word) => !pluginIdentifier.test(word)) ||
			names.has(key)
		) {
			throw new CommandError(
				"INVALID_PLUGIN",
				`插件 ${id} 的命令 ${command.name} 无效或重复。`,
			);
		}
		names.add(key);
	}
}

export async function importProductPlugin(
	entry: string,
	id?: string,
): Promise<BoathookPlugin> {
	const mod = await import(entry).catch(() => {
		throw new CommandError(
			"PLUGIN_IMPORT_FAILED",
			`无法加载插件入口 ${entry}，请检查文件和包依赖。`,
		);
	});
	const plugin = validatePlugin(mod.default ?? mod, entry);
	if (typeof plugin === "string")
		throw new CommandError("INVALID_PLUGIN", `插件入口无效。 ${plugin}`);
	validateProductPlugin(plugin, id);
	return plugin;
}

export function parsePluginOptions(
	plugin: BoathookPlugin,
	options: unknown,
): unknown {
	if (!plugin.optionsSchema) return options;
	const result = plugin.optionsSchema.safeParse(options ?? {});
	if (!result.success) {
		const fields = result.error.issues
			.map(({ path }) => path.join("."))
			.filter(Boolean);
		const detail = fields.length
			? `（${[...new Set(fields)].join("、")}）`
			: "";
		throw new CommandError(
			"INVALID_PLUGIN_OPTIONS",
			`请检查插件 ${plugin.name} 的 options${detail}。`,
		);
	}
	return result.data;
}

export function validateRuntimeOptions(
	plugin: BoathookPlugin,
	options: unknown,
): unknown {
	const parsed = parsePluginOptions(plugin, options);
	plugin.validateRuntime?.(parsed);
	return parsed;
}
