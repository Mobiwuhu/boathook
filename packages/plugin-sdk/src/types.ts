/// <reference types="chrome-types" />

import type { z } from "incur";
import type { BrowserContext, Page } from "patchright-core";

export type CommandFailure = {
	ok: false;
	error: string;
	code?: string;
	exitCode?: number;
};

export type Response = { ok: true; data: string } | CommandFailure;

export type NetworkRule = Omit<chrome.declarativeNetRequest.Rule, "id">;
export type NetworkRules = {
	replace(rules: readonly NetworkRule[]): Promise<void>;
};

export type StepResult = {
	stepNum: number;
	description: string;
	passed: boolean;
	error?: string;
	screenshotPath?: string;
};

export type ReporterRenderContext = {
	flowName: string;
	results: StepResult[];
	durationMs: number;
};

export type CustomReporter = {
	name: string;
	render: (ctx: ReporterRenderContext) => string;
};

export type PluginConfig = Readonly<Record<string, unknown>>;

export type PluginSessionContext = {
	/** Options saved for this plugin in the session. */
	options?: unknown;
	capabilities?: PluginCapabilities;
	/** State shared by this plugin's commands and hooks within one session. */
	sessionState: Record<string, unknown>;
};

/** Context bag passed to every plugin command handler. */
export type CommandContext = PluginSessionContext & {
	/** The active Playwright page in the current session/tab. */
	page: Page;
	/** The browser context for the current session. */
	context: BrowserContext;
	/** Read-only view of the configuration available to the session. */
	config: PluginConfig | null;
	/** Command arguments (excluding the command name itself). */
	args: string[];
	/** Request-level metadata. */
	request: { session?: string; json?: boolean; timeout?: number };
};

/** A single command contributed by a plugin. */
export type PluginCommand = {
	/** Command name — must not collide with built-in commands or other plugins. */
	name: string;
	/** One-line summary shown in `boathook plugin help`. */
	summary: string;
	/** Full usage text shown in `boathook plugin help <command>`. */
	usage: string;
	/** Known flags for this command — enables flag validation. */
	flags?: string[];
	/** If true, this command is exempt from the global timeout. */
	timeoutExempt?: boolean;
	/** Handler for a browser action or query. */
	handler?: (ctx: CommandContext) => Promise<Response>;
	/** Argument and flag declarations for boathook help and parsing. */
	input?: { args?: z.ZodObject; flags?: z.ZodObject };
	/** Compute the next saved options. The host applies and persists the result. */
	configure?: (
		argv: string[],
		options: unknown,
	) => Promise<ConfigCommandResult>;
};

export type ConfigCommandResult = { data: unknown; options: unknown };
export type PluginCapabilities = { networkRules?: NetworkRules };
export type PluginEnvironment = Partial<PluginSessionContext> & {
	url?: string;
};

/** Lifecycle hooks a plugin can register. */
export type PluginHooks = {
	/** Called once when the plugin is loaded at daemon startup. */
	init?: (
		config: PluginConfig | null,
		environment?: PluginEnvironment,
	) => Promise<void>;
	/** Prepare browser-wide rules before the first navigation. */
	prepareContext?: (
		context: BrowserContext,
		options: unknown,
		environment: PluginEnvironment,
	) => Promise<void>;
	/** Prepare a managed tab before opening or restoring its URL. */
	preparePage?: (
		page: Page,
		options: unknown,
		environment?: PluginEnvironment,
	) => Promise<void>;
	/** Apply new options and return an undo operation. Signal CONFIG_ROLLBACK_FAILED if recovery fails. */
	updateOptions?: (
		context: BrowserContext,
		options: unknown,
		environment: PluginEnvironment,
	) => Promise<() => Promise<void>>;
	/** Called before any command executes. Return a Response to short-circuit. */
	beforeCommand?: (
		cmd: string,
		ctx: CommandContext,
		// biome-ignore lint/suspicious/noConfusingVoidType: handlers may return nothing
	) => Promise<Response | void>;
	/** Called after any command executes. Can observe but not mutate the response. */
	afterCommand?: (
		cmd: string,
		ctx: CommandContext,
		response: Response,
	) => Promise<void>;
	/** Called on daemon shutdown. */
	cleanup?: (environment?: PluginEnvironment) => Promise<void>;
};

/** The plugin definition — default-export this from your plugin file. */
export type BoathookPlugin = {
	/** Unique plugin name. */
	name: string;
	/** Semver version string. */
	version: string;
	/** boathook plugin API version. */
	apiVersion: 1;
	/** Validate and normalize the options supplied to this plugin. */
	optionsSchema?: z.ZodType;
	/** Check whether these options are supported before changing a session. */
	validateRuntime?: (options: unknown) => void;
	/** Commands contributed by this plugin. */
	commands?: PluginCommand[];
	/** Custom flow reporters contributed by this plugin. */
	reporters?: CustomReporter[];
	/** Lifecycle hooks. */
	hooks?: PluginHooks;
};
