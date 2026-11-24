import {
	type BoathookPlugin,
	CommandError,
	isCommandError,
	type PluginCapabilities,
	type PluginCommand,
	type PluginConfig,
	type PluginSessionContext,
	pluginError,
	pluginResponse,
	type Response,
} from "@boathook/plugin-sdk";
import { z } from "incur";
import type { BrowserContext, Page } from "playwright";
import type { NetworkRuleStore } from "../browser/network-rules.ts";
import { BUILTIN_COMMANDS } from "../commands/catalog.ts";
import { scriptCommand } from "../commands/run.ts";
import {
	inspectConfig,
	revisionConfig,
	type SessionConfig,
} from "../config/session.ts";
import { pluginInfoCommand, runtimeConfigCommand } from "../ipc/protocol.ts";
import { initializePlugins, loadPlugins } from "./loader.ts";
import {
	commandWords,
	describePlugin,
	type PluginManifest,
} from "./manifest.ts";
import {
	parsePluginOptions,
	validateProductPlugin,
	validateRuntimeOptions,
} from "./modules.ts";

const savedOptions = z.json().optional();

export type SessionPluginCommand = (
	args: string[],
	context: BrowserContext,
) => Promise<Response>;

export async function createSessionPlugins(
	initialConfig: SessionConfig,
	commandConfig: PluginConfig,
	persistConfig: (config: SessionConfig) => Promise<void>,
) {
	let applied = initialConfig;
	let url: string | undefined;
	let rollbackFailed: string | undefined;
	const specs = new Map(
		initialConfig.plugins.map((spec) => [spec.entry, spec]),
	);
	const contexts = new Map<
		string,
		PluginSessionContext & { capabilities: PluginCapabilities }
	>();
	function contextFor(id: string) {
		const context = contexts.get(id);
		if (!context) throw new Error(`找不到插件 ${id} 的会话上下文。`);
		return context;
	}
	const environmentFor = (id: string) => ({ ...contextFor(id), url });
	const info: Array<PluginManifest & { source?: string; entry: string }> = [];
	const sessionCommands = new Map<string, SessionPluginCommand>();

	async function saveOptions(
		plugin: BoathookPlugin,
		context: BrowserContext,
		value: unknown,
	): Promise<void> {
		const candidate = savedOptions.safeParse(value);
		if (!candidate.success)
			throw new CommandError(
				"INVALID_PLUGIN_OPTIONS",
				`插件 ${plugin.name} 需要返回可保存为 JSON 的配置。`,
			);
		const options = validateRuntimeOptions(
			plugin,
			structuredClone(candidate.data),
		);
		const { revision: _revision, ...config } = applied;
		const next = revisionConfig({
			...config,
			plugins: config.plugins.map((spec) =>
				spec.id === plugin.name ? { ...spec, options: candidate.data } : spec,
			),
		});
		const update = plugin.hooks?.updateOptions;
		if (!update)
			throw new Error(`插件 ${plugin.name} 缺少 updateOptions 钩子。`);
		let undo: () => Promise<void>;
		try {
			undo = await update(context, options, {
				...environmentFor(plugin.name),
				options,
			});
		} catch (error) {
			if (isCommandError(error) && error.code === "CONFIG_ROLLBACK_FAILED")
				rollbackFailed = plugin.name;
			throw error;
		}
		try {
			await persistConfig(next);
		} catch (error) {
			try {
				await undo();
			} catch {
				rollbackFailed = plugin.name;
				throw new CommandError(
					"CONFIG_ROLLBACK_FAILED",
					`插件 ${plugin.name} 的配置恢复未完成，请重启会话。`,
					1,
				);
			}
			throw error;
		}
		applied = next;
		contextFor(plugin.name).options = options;
	}

	function wrapCommand(
		plugin: BoathookPlugin,
		command: PluginCommand,
	): PluginCommand {
		const { configure, ...definition } = command;
		const name = [plugin.name, ...commandWords(command)].join(":");
		if (!configure) return { ...definition, name };
		sessionCommands.set(name, async (args, context) => {
			try {
				if (rollbackFailed)
					throw new CommandError(
						"RESTART_REQUIRED",
						"上一次配置回滚未完成，请重启会话。",
					);
				const spec = applied.plugins.find(({ id }) => id === plugin.name);
				const current = parsePluginOptions(
					plugin,
					structuredClone(spec?.options),
				);
				const result = await configure(args, current);
				const response = pluginResponse(result.data);
				await saveOptions(plugin, context, result.options);
				return response;
			} catch (error) {
				return pluginError(error);
			}
		});
		return { ...definition, name };
	}

	const { registry, errors } = await loadPlugins(
		[...specs.keys()],
		commandConfig,
		BUILTIN_COMMANDS,
		{
			deferInit: true,
			environmentFor,
			transform(plugin, entry) {
				const spec = specs.get(entry);
				if (!spec) throw new Error("找不到插件配置。");
				validateProductPlugin(plugin, spec.id);
				contexts.set(spec.id, {
					options: validateRuntimeOptions(plugin, spec.options),
					sessionState: {},
					capabilities: {},
				});
				info.push({ ...describePlugin(plugin), source: spec.source, entry });
				return {
					...plugin,
					commands: plugin.commands?.map((command) =>
						wrapCommand(plugin, command),
					),
				};
			},
		},
	);
	if (errors.length > 0)
		throw new CommandError("INVALID_PLUGIN", errors.join("\n"));
	registry.commands.set(scriptCommand.name, {
		plugin: "boathook",
		command: scriptCommand,
	});

	sessionCommands.set(pluginInfoCommand, async () => pluginResponse(info));
	sessionCommands.set(runtimeConfigCommand, async ([id]) => {
		try {
			return pluginResponse({
				...inspectConfig(applied, id),
				restartRequired: rollbackFailed !== undefined,
				...(rollbackFailed && { rollbackFailed: [rollbackFailed] }),
			});
		} catch (error) {
			return pluginError(error);
		}
	});
	return {
		async initialize(entryUrl?: string) {
			url = entryUrl;
			const errors = await initializePlugins(
				registry,
				commandConfig,
				environmentFor,
			);
			if (errors.length)
				throw new CommandError("PLUGIN_INIT_FAILED", errors.join("\n"), 1);
		},
		registry,
		sessionCommands,
		pluginContext: (id: string) => contexts.get(id),
		async prepareContext(context: BrowserContext, rules?: NetworkRuleStore) {
			for (const [id, plugin] of registry.plugins) {
				contextFor(id).capabilities.networkRules = rules?.forPlugin(id);
				const environment = environmentFor(id);
				await plugin.hooks?.prepareContext?.(
					context,
					environment.options,
					environment,
				);
			}
		},
		async preparePage(page: Page) {
			for (const [id, plugin] of registry.plugins) {
				const environment = environmentFor(id);
				await plugin.hooks?.preparePage?.(
					page,
					environment.options,
					environment,
				);
			}
		},
	};
}
