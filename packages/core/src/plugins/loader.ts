import type {
	BoathookPlugin,
	CommandContext,
	CustomReporter,
	PluginCommand,
	PluginConfig,
	PluginEnvironment,
	PluginHooks,
} from "@boathook/plugin-sdk";
import { isCommandError } from "@boathook/plugin-sdk";
import { FLOW_REPORTERS } from "../flows/reporters.ts";
import type { Response } from "../ipc/protocol.ts";

export type PluginRegistry = {
	plugins: Map<string, BoathookPlugin>;
	commands: Map<string, { plugin: string; command: PluginCommand }>;
	reporters: Map<string, { plugin: string; reporter: CustomReporter }>;
	hooks: {
		beforeCommand: Array<{
			plugin: string;
			hook: NonNullable<PluginHooks["beforeCommand"]>;
		}>;
		afterCommand: Array<{
			plugin: string;
			hook: NonNullable<PluginHooks["afterCommand"]>;
		}>;
		cleanup: Array<{
			plugin: string;
			hook: NonNullable<PluginHooks["cleanup"]>;
		}>;
	};
};

export function createEmptyRegistry(): PluginRegistry {
	return {
		plugins: new Map(),
		commands: new Map(),
		reporters: new Map(),
		hooks: {
			beforeCommand: [],
			afterCommand: [],
			cleanup: [],
		},
	};
}

/** Runtime shape validation for a plugin object. */
export function validatePlugin(
	value: unknown,
	sourcePath: string,
): BoathookPlugin | string {
	if (typeof value !== "object" || value === null) {
		return `Plugin at '${sourcePath}' does not export an object.`;
	}

	const obj = value as Record<string, unknown>;

	if (typeof obj.name !== "string" || obj.name.length === 0) {
		return `Plugin at '${sourcePath}' is missing a 'name' string.`;
	}

	if (typeof obj.version !== "string" || obj.version.length === 0) {
		return `Plugin '${obj.name}' at '${sourcePath}' is missing a 'version' string.`;
	}

	if (obj.commands !== undefined) {
		if (!Array.isArray(obj.commands)) {
			return `Plugin '${obj.name}': 'commands' must be an array.`;
		}
		for (let i = 0; i < obj.commands.length; i++) {
			const err = validatePluginCommand(obj.commands[i], obj.name as string, i);
			if (err) return err;
		}
	}

	if (obj.reporters !== undefined) {
		if (!Array.isArray(obj.reporters)) {
			return `Plugin '${obj.name}': 'reporters' must be an array.`;
		}
		for (let i = 0; i < obj.reporters.length; i++) {
			const err = validateCustomReporter(
				obj.reporters[i],
				obj.name as string,
				i,
			);
			if (err) return err;
		}
	}

	if (obj.hooks !== undefined) {
		if (typeof obj.hooks !== "object" || obj.hooks === null) {
			return `Plugin '${obj.name}': 'hooks' must be an object.`;
		}
		const hooks = obj.hooks as Record<string, unknown>;
		for (const key of [
			"init",
			"prepareContext",
			"preparePage",
			"updateOptions",
			"beforeCommand",
			"afterCommand",
			"cleanup",
		]) {
			if (hooks[key] !== undefined && typeof hooks[key] !== "function") {
				return `Plugin '${obj.name}': hooks.${key} must be a function.`;
			}
		}
	}

	return value as BoathookPlugin;
}

function validatePluginCommand(
	cmd: unknown,
	pluginName: string,
	index: number,
): string | null {
	if (typeof cmd !== "object" || cmd === null) {
		return `Plugin '${pluginName}': command at index ${index} must be an object.`;
	}

	const obj = cmd as Record<string, unknown>;

	if (typeof obj.name !== "string" || obj.name.length === 0) {
		return `Plugin '${pluginName}': command at index ${index} is missing a 'name' string.`;
	}

	if (typeof obj.summary !== "string") {
		return `Plugin '${pluginName}': command '${obj.name}' is missing a 'summary' string.`;
	}

	if (typeof obj.usage !== "string") {
		return `Plugin '${pluginName}': command '${obj.name}' is missing a 'usage' string.`;
	}

	if (
		typeof obj.handler !== "function" &&
		typeof obj.configure !== "function"
	) {
		return `Plugin '${pluginName}': command '${obj.name}' is missing a 'handler' function.`;
	}
	if (obj.handler !== undefined && obj.configure !== undefined) {
		return `Plugin '${pluginName}': command '${obj.name}' requires exactly one handler.`;
	}

	if (obj.flags !== undefined) {
		if (
			!Array.isArray(obj.flags) ||
			!obj.flags.every((f: unknown) => typeof f === "string")
		) {
			return `Plugin '${pluginName}': command '${obj.name}' 'flags' must be a string array.`;
		}
	}

	return null;
}

function validateCustomReporter(
	reporter: unknown,
	pluginName: string,
	index: number,
): string | null {
	if (typeof reporter !== "object" || reporter === null) {
		return `Plugin '${pluginName}': reporter at index ${index} must be an object.`;
	}

	const obj = reporter as Record<string, unknown>;

	if (typeof obj.name !== "string" || obj.name.length === 0) {
		return `Plugin '${pluginName}': reporter at index ${index} is missing a 'name' string.`;
	}

	if (typeof obj.render !== "function") {
		return `Plugin '${pluginName}': reporter '${obj.name}' is missing a 'render' function.`;
	}

	return null;
}

/**
 * Load all plugins from the given paths.
 * Returns a populated registry and a list of non-fatal errors.
 */
export async function loadPlugins(
	pluginPaths: string[],
	config: PluginConfig | null,
	builtinCommands: ReadonlySet<string>,
	options?: {
		deferInit?: boolean;
		transform?: (plugin: BoathookPlugin, path: string) => BoathookPlugin;
		environmentFor?: (plugin: string) => PluginEnvironment;
	},
): Promise<{ registry: PluginRegistry; errors: string[] }> {
	const registry = createEmptyRegistry();
	const errors: string[] = [];

	for (const path of pluginPaths) {
		try {
			const mod = await import(path);
			const raw = mod.default ?? mod;

			const result = validatePlugin(raw, path);
			if (typeof result === "string") {
				errors.push(result);
				continue;
			}

			const plugin = options?.transform?.(result, path) ?? result;

			// Check for duplicate plugin name
			if (registry.plugins.has(plugin.name)) {
				errors.push(
					`Plugin '${plugin.name}' at '${path}' skipped: a plugin with the same name is already loaded.`,
				);
				continue;
			}

			// Register commands
			if (plugin.commands) {
				for (const command of plugin.commands) {
					if (builtinCommands.has(command.name)) {
						errors.push(
							`Plugin '${plugin.name}': command '${command.name}' conflicts with a built-in command — skipped.`,
						);
						continue;
					}

					const existing = registry.commands.get(command.name);
					if (existing) {
						errors.push(
							`Plugin '${plugin.name}': command '${command.name}' conflicts with plugin '${existing.plugin}' — skipped.`,
						);
						continue;
					}

					registry.commands.set(command.name, {
						plugin: plugin.name,
						command,
					});
				}
			}

			// Register custom reporters
			if (plugin.reporters) {
				for (const reporter of plugin.reporters) {
					if (
						FLOW_REPORTERS.includes(
							reporter.name as (typeof FLOW_REPORTERS)[number],
						)
					) {
						errors.push(
							`Plugin '${plugin.name}': reporter '${reporter.name}' conflicts with a built-in reporter — skipped.`,
						);
						continue;
					}

					const existing = registry.reporters.get(reporter.name);
					if (existing) {
						errors.push(
							`Plugin '${plugin.name}': reporter '${reporter.name}' conflicts with plugin '${existing.plugin}' — skipped.`,
						);
						continue;
					}

					registry.reporters.set(reporter.name, {
						plugin: plugin.name,
						reporter,
					});
				}
			}

			// Register hooks
			if (plugin.hooks) {
				if (plugin.hooks.beforeCommand) {
					registry.hooks.beforeCommand.push({
						plugin: plugin.name,
						hook: plugin.hooks.beforeCommand,
					});
				}
				if (plugin.hooks.afterCommand) {
					registry.hooks.afterCommand.push({
						plugin: plugin.name,
						hook: plugin.hooks.afterCommand,
					});
				}
				const cleanup = plugin.hooks.cleanup;
				if (cleanup) {
					registry.hooks.cleanup.push({
						plugin: plugin.name,
						hook: () => cleanup(options?.environmentFor?.(plugin.name)),
					});
				}
			}

			registry.plugins.set(plugin.name, plugin);
		} catch (err) {
			if (isCommandError(err)) throw err;
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to load plugin at '${path}': ${message}`);
		}
	}

	if (!options?.deferInit)
		errors.push(
			...(await initializePlugins(registry, config, options?.environmentFor)),
		);
	return { registry, errors };
}

/**
 * Run beforeCommand hooks. Returns a short-circuit Response if any hook
 * returns one, otherwise undefined.
 */
export async function runBeforeHooks(
	registry: PluginRegistry,
	cmd: string,
	contextFor: (plugin: string) => CommandContext,
): Promise<Response | undefined> {
	for (const { plugin, hook } of registry.hooks.beforeCommand) {
		try {
			const result = await hook(cmd, contextFor(plugin));
			if (result) return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				error: `Plugin '${plugin}' beforeCommand hook failed: ${message}`,
			};
		}
	}
	return undefined;
}

/** Run afterCommand hooks and isolate failures to a single hook. */
export async function runAfterHooks(
	registry: PluginRegistry,
	cmd: string,
	contextFor: (plugin: string) => CommandContext,
	response: Response,
): Promise<void> {
	for (const { plugin, hook } of registry.hooks.afterCommand) {
		try {
			await hook(cmd, contextFor(plugin), response);
		} catch {
			// afterCommand hook errors are silently ignored to avoid
			// corrupting the already-produced response
		}
	}
}

/** Run cleanup hooks on daemon shutdown. */
export async function runCleanupHooks(registry: PluginRegistry): Promise<void> {
	for (const { hook } of registry.hooks.cleanup) {
		try {
			await hook();
		} catch {
			// Cleanup errors are silently ignored during shutdown
		}
	}
}

/**
 * Get or create per-plugin session state for a given plugin name.
 */
export function getPluginSessionState(
	pluginState: Map<string, Record<string, unknown>>,
	pluginName: string,
): Record<string, unknown> {
	let state = pluginState.get(pluginName);
	if (!state) {
		state = {};
		pluginState.set(pluginName, state);
	}
	return state;
}

export async function initializePlugins(
	registry: PluginRegistry,
	config: PluginConfig | null,
	environmentFor?: (id: string) => PluginEnvironment,
): Promise<string[]> {
	const errors: string[] = [];
	for (const plugin of registry.plugins.values()) {
		if (!plugin.hooks?.init) continue;
		try {
			await plugin.hooks.init(config, environmentFor?.(plugin.name));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`Plugin '${plugin.name}': init hook failed: ${message}`);
		}
	}
	return errors;
}
