import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isCommandError, pluginResponse } from "@boathook/plugin-sdk";
import { z } from "incur";
import { closeProfileBrowser } from "../browser/close.ts";
import { launchChrome } from "../browser/launch.ts";
import type { CommandConfig } from "../config/schema.ts";
import { requireLoginCheckFile } from "../config/session.ts";
import { writeRecord } from "../files.ts";
import {
	discoverFlowDirectories,
	type FlowSource,
	loadFlowsFromDirectories,
	mergeFlows,
} from "../flows/loader.ts";
import { cleanupToken, generateToken } from "../ipc/auth.ts";
import { createLogger } from "../logger.ts";
import { runCleanupHooks } from "../plugins/loader.ts";
import { createSessionPlugins } from "../plugins/registry.ts";
import { chromeExecutable } from "../runtime.ts";
import {
	type NavigationPlan,
	navigationSchema,
} from "../session/navigation.ts";
import { prepareSessionDirectories, sessionPaths } from "../session/paths.ts";
import {
	checkStalePid,
	cleanupFiles,
	writePidFile,
} from "../session/process.ts";
import type { StartupResult } from "../session/startup.ts";
import { sessionSchema } from "../session/store.ts";
import { sessionStatus } from "../session/supervisor.ts";
import { startServer } from "./execute.ts";

const launchSchema = z.object({
	id: z.uuid(),
	record: sessionSchema,
});

function signalStartup(result: StartupResult): void {
	if (!process.send) throw new Error("缺少会话启动通道。");
	process.send(result);
}

function signalStartupFailure(error: unknown, code: string): void {
	if (!process.connected) return;
	const failure = isCommandError(error) ? error : undefined;
	signalStartup({
		ok: false,
		code: failure?.code ?? code,
		exitCode: failure?.exitCode ?? 1,
		error: error instanceof Error ? error.message : String(error),
	});
	process.disconnect?.();
}

function awaitNavigation(): Promise<NavigationPlan> {
	return new Promise((resolve, reject) => {
		const disconnected = () => reject(new Error("会话启动已取消。"));
		process.once("disconnect", disconnected);
		process.once("message", (message) => {
			process.off("disconnect", disconnected);
			const result = navigationSchema.safeParse(message);
			if (result.success) resolve(result.data);
			else reject(new Error("会话导航参数无效。"));
		});
		signalStartup({ ok: true });
	});
}

export async function runSessionDaemon(): Promise<void> {
	const { id, record } = launchSchema.parse(JSON.parse(await Bun.stdin.text()));
	const paths = sessionPaths(record.name);
	prepareSessionDirectories(paths);
	const logger = createLogger();
	const { projectDir, commands, proxy } = record.config;
	const config: CommandConfig = { ...commands, projectDir };
	const flowSources = new Map<string, FlowSource>();
	const flowLoadErrors: string[] = [];
	function reloadFlows() {
		const files = loadFlowsFromDirectories(discoverFlowDirectories(projectDir));
		const { merged, sources } = mergeFlows(
			commands.flows,
			files.flows,
			files.sources,
		);
		config.flows = merged;
		flowSources.clear();
		for (const [name, source] of sources) flowSources.set(name, source);
		flowLoadErrors.splice(0, flowLoadErrors.length, ...files.errors);
		for (const error of files.errors) logger.warn("Flow warning", { error });
	}
	reloadFlows();
	const proxyConfig = proxy?.enabled ? proxy : undefined;
	const loaded = await (async () => {
		await requireLoginCheckFile(record.config.login);
		return createSessionPlugins(record.config, config, (config) =>
			writeRecord(paths.sessionPath, { ...record, config }),
		);
	})().catch((error: unknown) => {
		signalStartupFailure(error, "INVALID_PLUGIN");
		throw error;
	});
	const navigation = await awaitNavigation();
	const lifecycle = { ...paths, idleTimeoutMs: record.idleTimeout * 1000 };
	if (checkStalePid(lifecycle)) throw new Error("此会话的 daemon 已在运行。");
	writePidFile(lifecycle);
	let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
	let daemon: Awaited<ReturnType<typeof startServer>> | undefined;
	let closing = false;
	try {
		await rm(paths.socketPath, { force: true });
		await loaded.initialize(navigation.pluginUrl);
		const launched = await launchChrome({
			profilePath: paths.profilePath,
			headless: !record.headed,
			executablePath: chromeExecutable(),
			extensionDirectory: join(paths.run, "network-extension"),
			proxy: proxyConfig,
		});
		browser = launched;
		const { context, page, networkRules, stealth } = launched;
		daemon = await startServer(
			{
				page,
				context,
				config,
				stealthOpts: stealth,
				token: generateToken(paths.tokenPath),
				proxyConfig,
				flowSources,
				flowLoadErrors,
				reloadFlows,
			},
			lifecycle,
			async () => {
				closing = true;
				cleanupToken(paths.tokenPath);
				await closeProfileBrowser(context, paths.profilePath).catch(() => {});
				await rm(paths.processPath, { force: true });
			},
			{
				statePath: paths.statePath,
				navigation,
				registry: loaded.registry,
				sessionCommands: loaded.sessionCommands,
				readStatus: async () =>
					pluginResponse(await sessionStatus(record.name)),
				pluginContext: loaded.pluginContext,
				prepareContext: (context) =>
					loaded.prepareContext(context, networkRules),
				preparePage: loaded.preparePage,
			},
		);
		const shutdown = daemon.shutdown;
		context.browser()?.on("disconnected", () => {
			if (closing) return;
			logger.error("Browser disconnected — daemon exiting.");
			cleanupFiles(lifecycle);
			cleanupToken(paths.tokenPath);
			process.exit(1);
		});
		const terminate = async () => {
			if (closing) return;
			closing = true;
			try {
				await shutdown();
			} finally {
				cleanupFiles(lifecycle);
				cleanupToken(paths.tokenPath);
				process.exit(0);
			}
		};
		process.once("SIGTERM", terminate);
		process.once("SIGINT", terminate);

		await writeRecord(paths.sessionPath, record);
		await writeRecord(paths.processPath, {
			id,
			pid: process.pid,
			socketPath: paths.socketPath,
		});
	} catch (error) {
		if (daemon) {
			await daemon.shutdown().catch(() => {});
		} else {
			await runCleanupHooks(loaded.registry);
			if (browser)
				await closeProfileBrowser(browser.context, paths.profilePath).catch(
					() => {},
				);
		}
		cleanupFiles(lifecycle);
		cleanupToken(paths.tokenPath);
		signalStartupFailure(error, "START_FAILED");
		throw error;
	}
}
