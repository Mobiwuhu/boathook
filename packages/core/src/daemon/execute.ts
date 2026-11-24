import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:net";
import type {
	CommandContext,
	PluginSessionContext,
} from "@boathook/plugin-sdk";
import { isCommandError, pluginError } from "@boathook/plugin-sdk";
import type { BrowserContext, BrowserContextOptions, Page } from "playwright";
import { clearRefs, markStale, withRefState } from "../browser/refs.ts";
import type { StealthOpts } from "../browser/stealth.ts";
import {
	ManagedTabs,
	type TabRegistry,
	type TabState,
} from "../browser/tabs.ts";
import { attachCDPConsoleCapture } from "../cdp-console.ts";
import { handleA11y } from "../commands/a11y.ts";
import { handleApiAssert as handleApiAssertCmd } from "../commands/api-assert.ts";
import { handleAssert } from "../commands/assert.ts";
import { handleAssertAi } from "../commands/assert-ai.ts";
import { handleAttr } from "../commands/attr.ts";
import { handleAuthState } from "../commands/auth-state.ts";
import { handleBack } from "../commands/back.ts";
import { handleBenchmark } from "../commands/benchmark.ts";
import { KNOWN_FLAGS } from "../commands/catalog.ts";
import { handleClick } from "../commands/click.ts";
import { handleCompliance } from "../commands/compliance.ts";
import { handleConsole } from "../commands/console.ts";
import { handleCookies } from "../commands/cookies.ts";
import { handleCrawl } from "../commands/crawl.ts";
import { handleDesignAudit } from "../commands/design-audit.ts";
import { handleDev } from "../commands/dev.ts";
import { handleDevices } from "../commands/devices.ts";
import {
	attachDialogListener,
	createDialogState,
	handleDialog,
} from "../commands/dialog.ts";
import { handleDiff } from "../commands/diff.ts";
import { handleDo } from "../commands/do.ts";
import { handleDocCapture } from "../commands/doc-capture.ts";
import { handleDownload } from "../commands/download.ts";
import { handleElementCount } from "../commands/element-count.ts";
import { handleEval } from "../commands/eval.ts";
import { handleExtract } from "../commands/extract.ts";
import { handleFill } from "../commands/fill.ts";
import { handleFlow } from "../commands/flow.ts";
import { handleFlowShare } from "../commands/flow-share.ts";
import { handleForm } from "../commands/form.ts";
import { handleForward } from "../commands/forward.ts";
import { handleFrame } from "../commands/frame.ts";
import { handleGesture } from "../commands/gesture.ts";
import { handleGoto } from "../commands/goto.ts";
import { handleHealthcheck } from "../commands/healthcheck.ts";
import { handleHover } from "../commands/hover.ts";
import { handleHtml } from "../commands/html.ts";
import { handleI18n } from "../commands/i18n.ts";
import {
	createInterceptState,
	handleIntercept,
} from "../commands/intercept.ts";
import { handleLogin } from "../commands/login.ts";
import { handleMonitor } from "../commands/monitor.ts";
import { handleNetwork } from "../commands/network.ts";
import { handleOffline } from "../commands/offline.ts";
import { handlePageEval } from "../commands/page-eval.ts";
import { handlePdf } from "../commands/pdf.ts";
import { handlePerf } from "../commands/perf.ts";
import { handlePress } from "../commands/press.ts";
import { handleRecord } from "../commands/record.ts";
import { handleReload } from "../commands/reload.ts";
import { handleReplay } from "../commands/replay.ts";
import { handleReport } from "../commands/report.ts";
import { handleResponsive } from "../commands/responsive.ts";
import { handleScreenshot } from "../commands/screenshot.ts";
import { handleScreenshots } from "../commands/screenshots.ts";
import { handleScroll } from "../commands/scroll.ts";
import { handleSecurity } from "../commands/security.ts";
import { handleSecurityScan } from "../commands/security-scan.ts";
import { handleSelect } from "../commands/select.ts";
import { handleSeo } from "../commands/seo.ts";
import { handleSnapshot } from "../commands/snapshot.ts";
import { handleStorage } from "../commands/storage.ts";
import { handleSubscribe } from "../commands/subscribe.ts";
import { handleTab } from "../commands/tab.ts";
import { handleTestMatrix } from "../commands/test-matrix.ts";
import { handleText } from "../commands/text.ts";
import { handleThrottle } from "../commands/throttle.ts";
import { handleTitle } from "../commands/title.ts";
import { createTraceState, handleTrace } from "../commands/trace.ts";
import { handleUpload } from "../commands/upload.ts";
import { handleUrl } from "../commands/url.ts";
import { createVideoState, handleVideo } from "../commands/video.ts";
import { handleViewport } from "../commands/viewport.ts";
import { handleVrt } from "../commands/vrt.ts";
import { handleWait } from "../commands/wait.ts";
import { handleWatch } from "../commands/watch.ts";
import { handleWipe } from "../commands/wipe.ts";
import type { CommandConfig } from "../config/schema.ts";
import { writeRecord } from "../files.ts";
import { checkUnknownFlags, unknownFlagsError } from "../flags.ts";
import { CustomReporterRegistry } from "../flows/custom-reporter.ts";
import type { FlowSource } from "../flows/loader.ts";
import type {
	BatchRequest,
	ProtocolResponse,
	Request,
	Response,
} from "../ipc/protocol.ts";
import {
	isBatchRequest,
	parseRequest,
	serialiseResponse,
	shutdownCommand,
} from "../ipc/protocol.ts";
import { createLogger } from "../logger.ts";
import {
	createEmptyRegistry,
	getPluginSessionState,
	type PluginRegistry,
	runAfterHooks,
	runBeforeHooks,
	runCleanupHooks,
} from "../plugins/loader.ts";
import type { NavigationPlan } from "../session/navigation.ts";
import {
	cleanupFiles,
	createIdleTimer,
	type IdleTimer,
	type LifecycleConfig,
} from "../session/process.ts";
import { resolveTimeout } from "../timeout.ts";
import { CommandScheduler, dispatchRequest, notStarted } from "./dispatch.ts";
import { listenOnSocket } from "./server.ts";

/** Constant-time token comparison over fixed-length hashes. */
function tokensMatch(provided: string | undefined, expected: string): boolean {
	if (!provided) return false;
	return timingSafeEqual(
		createHash("sha256").update(provided).digest(),
		createHash("sha256").update(expected).digest(),
	);
}

export type ServerDeps = {
	page: Page;
	context: BrowserContext;
	config: CommandConfig | null;
	stealthOpts?: StealthOpts;
	token?: string;
	/** Resolved proxy config for propagation to isolated contexts. */
	proxyConfig?: BrowserContextOptions["proxy"];
	/** Provenance map for flows (inline vs file-based). */
	flowSources?: Map<string, FlowSource>;
	/** Validation errors encountered when loading flow files. */
	flowLoadErrors?: string[];
	reloadFlows?: () => void;
};

function attachPageListeners(
	page: Page,
	tabState: TabState,
	onNavigation?: () => void,
): void {
	page.on("framenavigated", (frame) => {
		if (frame === page.mainFrame()) {
			markStale(tabState.identity?.refs);
			if (tabState.identity) tabState.identity.snapshotId = undefined;
			onNavigation?.();
		}
	});

	// Patchright omits Runtime.enable on its own session. Enable it in a
	// separate CDP session to capture user-triggered console messages.
	attachCDPConsoleCapture(page, tabState.consoleBuffer).catch(() => {
		page.on("console", (msg) => {
			tabState.consoleBuffer.push({
				level: msg.type(),
				text: msg.text(),
				location: msg.location(),
				timestamp: Date.now(),
			});
		});
	});

	page.on("response", (response) => {
		tabState.networkBuffer.push({
			status: response.status(),
			method: response.request().method(),
			url: response.url(),
			timestamp: Date.now(),
		});
	});
}

/**
 * Start a daemon socket server with injected dependencies.
 * This is the testable core — no browser launch.
 */
export type ServerOptions = {
	/** Called after shutdown completes (explicit or idle shutdown). Defaults to process.exit(0). */
	onExit?: () => void;
	/** Enable persisted session-state restore/save for long-lived daemon runs. */
	statePath?: string;
	navigation?: NavigationPlan;
	registry?: PluginRegistry;
	sessionCommands?: ReadonlyMap<
		string,
		import("../plugins/registry.ts").SessionPluginCommand
	>;
	readStatus?: () => Promise<Response>;
	pluginContext?: (id: string) => PluginSessionContext | undefined;
	prepareContext?: (context: BrowserContext) => Promise<void>;
	preparePage?: (page: Page) => Promise<void>;
};

export async function startServer(
	deps: ServerDeps,
	lifecycleConfig: LifecycleConfig,
	onShutdown: () => Promise<void>,
	options?: ServerOptions,
): Promise<{
	server: Server;
	idleTimer: IdleTimer;
	shutdown: () => Promise<void>;
}> {
	let server: Server;
	let idleTimer: IdleTimer;

	const {
		context,
		config,
		stealthOpts,
		token,
		proxyConfig,
		flowSources,
		flowLoadErrors,
	} = deps;
	const exitFn = options?.onExit ?? (() => process.exit(0));
	const statePath = options?.statePath;
	const logger = createLogger();
	const slowCommandMs = Number.parseInt(
		process.env.BOATHOOK_SLOW_COMMAND_MS ?? "750",
		10,
	);
	const maxRssMb = Number.parseInt(process.env.BOATHOOK_MAX_RSS_MB ?? "0", 10);
	let activeCommands = 0;
	let canPersist = false;
	let stopping = false;
	const scheduler = new CommandScheduler(() => {
		if (!stopping) idleTimer.reset();
	});
	let persistTimer: ReturnType<typeof setTimeout> | undefined;
	let persistInFlight: Promise<void> | undefined;

	// Per-context trace state so each BrowserContext has isolated tracing.
	// WeakMap so closed contexts (e.g. isolated sessions) can be collected.
	const traceStates = new WeakMap<
		BrowserContext,
		ReturnType<typeof createTraceState>
	>();
	function getTraceState(ctx: BrowserContext) {
		let state = traceStates.get(ctx);
		if (!state) {
			state = createTraceState();
			traceStates.set(ctx, state);
		}
		return state;
	}

	const videoState = createVideoState();

	// Cache the in-flight promise (not the resolved page) so concurrent
	// callers share one page instead of racing to create and leak extras.
	const scratchPages = new Map<BrowserContext, Promise<Page>>();
	async function getScratchPage(targetContext: BrowserContext): Promise<Page> {
		const pending = scratchPages.get(targetContext);
		if (pending) {
			try {
				const existing = await pending;
				if (typeof existing.isClosed !== "function" || !existing.isClosed()) {
					return existing;
				}
			} catch {
				// Creation failed — fall through and retry below
			}
		}
		const creating = (async () => {
			const scratchPage = await managedTabs.newScratchPage();
			scratchPage.on("close", () => {
				if (scratchPages.get(targetContext) === creating) {
					scratchPages.delete(targetContext);
				}
			});
			return scratchPage;
		})();
		scratchPages.set(targetContext, creating);
		try {
			return await creating;
		} catch (err) {
			if (scratchPages.get(targetContext) === creating) {
				scratchPages.delete(targetContext);
			}
			throw err;
		}
	}

	// Tab registry for default session
	const tabs: TabRegistry = {
		tabs: [],
		activeTabIndex: 0,
	};
	const dialogState = createDialogState();
	const interceptState = createInterceptState();
	const pluginState = new Map<string, Record<string, unknown>>();

	const pluginRegistry = options?.registry ?? createEmptyRegistry();
	const pluginCommandNames = new Set([
		...pluginRegistry.commands.keys(),
		...(options?.sessionCommands?.keys() ?? []),
	]);
	const customReporters = new CustomReporterRegistry();
	for (const { reporter } of pluginRegistry.reporters.values()) {
		customReporters.register(reporter);
	}
	await options?.prepareContext?.(context);
	const managedTabs = new ManagedTabs(context, tabs, {
		attach(tab) {
			attachPageListeners(tab.page, tab, scheduleSessionStatePersist);
			attachDialogListener(tab.page, dialogState);
		},
		prepare: options?.preparePage,
		changed: scheduleSessionStatePersist,
		error: (error) =>
			logger.warn("Managed tab operation failed", { error: String(error) }),
	});
	await managedTabs.restore(deps.page, options?.navigation);
	canPersist = true;
	await flushSessionStatePersist();

	function buildSessionStateSnapshot() {
		return {
			version: 1,
			activeTabIndex: tabs.activeTabIndex,
			tabs: tabs.tabs.map((tab) => ({
				url: tab.page.url(),
				id: tab.identity?.id,
			})),
		} as const;
	}

	async function flushSessionStatePersist(): Promise<void> {
		if (!canPersist || !statePath) return;
		const snapshot = buildSessionStateSnapshot();
		const writing = (persistInFlight ?? Promise.resolve())
			.then(() => writeRecord(statePath, snapshot))
			.catch((error: unknown) => {
				logger.warn("Failed to persist session state", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				if (persistInFlight === writing) persistInFlight = undefined;
			});
		persistInFlight = writing;
		await writing;
	}

	function scheduleSessionStatePersist(): void {
		if (!canPersist || stopping) return;
		if (persistTimer) return;
		persistTimer = setTimeout(() => {
			persistTimer = undefined;
			void flushSessionStatePersist();
		}, 125);
	}

	function clearTabReferences(): void {
		for (const tab of tabs.tabs) {
			if (!tab.identity) continue;
			clearRefs(tab.identity.refs);
			tab.identity.snapshotId = undefined;
		}
	}

	const wipeSession = () =>
		handleWipe({ context, tabRegistry: tabs, clearRefs: clearTabReferences });

	function runMemoryPressureMitigation(allowRefClear: boolean) {
		if (!Number.isFinite(maxRssMb) || maxRssMb <= 0) return;
		const currentRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
		if (currentRssMb < maxRssMb) return;
		logger.warn("Memory pressure detected, applying mitigation", {
			currentRssMb,
			limitRssMb: maxRssMb,
		});
		for (const tab of tabs.tabs) {
			tab.consoleBuffer.clear();
			tab.networkBuffer.clear();
		}
		if (allowRefClear) {
			clearTabReferences();
		} else {
			logger.debug("Skipping ref clear during active command processing", {
				activeCommands,
			});
		}
		if (typeof global.gc === "function") {
			global.gc();
		}
	}

	async function stopServer() {
		stopping = true;
		idleTimer.clear();
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		server.close();
		await persistInFlight;
		await flushSessionStatePersist();
		await runCleanupHooks(pluginRegistry);
		await onShutdown();
		cleanupFiles(lifecycleConfig);
	}

	let shutdownPromise: Promise<void> | undefined;
	function shutdown() {
		shutdownPromise ??= stopServer();
		return shutdownPromise;
	}
	let exitPromise: Promise<void> | undefined;
	function shutdownOnce() {
		exitPromise ??= shutdown()
			.catch(() => cleanupFiles(lifecycleConfig))
			.finally(exitFn);
		return exitPromise;
	}

	idleTimer = createIdleTimer(lifecycleConfig, () => {
		// A long-running command (watch, subscribe, flow with a large
		// timeout) must not be killed by the idle timer — defer instead.
		if (activeCommands > 0 || scheduler.busy) {
			idleTimer.reset();
			return;
		}
		shutdownOnce();
	});

	// Commands exempt from timeout
	const TIMEOUT_EXEMPT = new Set([
		shutdownCommand,
		"benchmark",
		"status",
		"trace",
		"video",
		"screenshots",
		"report",
		"replay",
		"flow-share",
		"test-matrix",
		"diff",
		"record",
		"watch",
		"subscribe",
		"monitor",
	]);

	const COMMANDS_KEEPING_SNAPSHOT = new Set([
		"snapshot",
		"text",
		"url",
		"title",
		"html",
		"attr",
		"element-count",
		"console",
		"network",
		"cookies",
		"storage",
		"a11y",
		"perf",
		"security",
	]);
	function commandTimeout(request: Request): number | undefined {
		if (
			TIMEOUT_EXEMPT.has(request.cmd) ||
			pluginRegistry.commands.get(request.cmd)?.command.timeoutExempt
		)
			return undefined;
		return resolveTimeout(request.timeout, config?.timeout);
	}

	type ConnectionResult = { responseStr: string; shouldShutdown: boolean };
	function reply(
		responseStr: string,
		shouldShutdown = false,
	): ConnectionResult {
		return { responseStr, shouldShutdown };
	}

	async function handleConnection(
		parsedRequest: Request | BatchRequest,
	): Promise<ConnectionResult> {
		idleTimer.reset();
		activeCommands++;
		runMemoryPressureMitigation(false);

		try {
			const traceId = randomUUID();
			const startedAt = Date.now();
			const startCpu = process.cpuUsage();
			const requestLabel = isBatchRequest(parsedRequest)
				? "batch"
				: parsedRequest.cmd;
			logger.debug("Command received", {
				traceId,
				cmd: requestLabel,
			});

			const logCommandCompletion = (response: ProtocolResponse) => {
				const durationMs = Date.now() - startedAt;
				if (durationMs >= slowCommandMs) {
					const cpuDelta = process.cpuUsage(startCpu);
					const mem = process.memoryUsage();
					logger.warn("Slow command profiled", {
						traceId,
						cmd: requestLabel,
						durationMs,
						cpuUserMicros: cpuDelta.user,
						cpuSystemMicros: cpuDelta.system,
						rssMb: Math.round(mem.rss / 1024 / 1024),
						heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
					});
				}
				logger.info("Command completed", {
					traceId,
					cmd: requestLabel,
					ok: response.ok,
					durationMs,
				});
			};

			// Use constant-time comparison for the session token.
			if (token && !tokensMatch(parsedRequest.token, token)) {
				return reply(
					serialiseResponse({
						ok: false,
						error: "Authentication failed: invalid or missing token.",
					}),
				);
			}

			async function executeRequest(request: Request): Promise<Response> {
				if (request.cmd === shutdownCommand)
					return { ok: true, data: "Daemon stopped." };

				if (request.cmd === "status") {
					if (request.args.length > 0)
						return {
							ok: false,
							code: "INVALID_ARGUMENTS",
							error: "Session status takes no daemon arguments.",
						};
					if (options?.readStatus) return options.readStatus();
					return { ok: false, error: "Session status is unavailable." };
				}

				const sessionContext = context;
				const knownFlags =
					KNOWN_FLAGS[request.cmd] ??
					pluginRegistry.commands.get(request.cmd)?.command.flags;
				if (knownFlags) {
					const unknown = checkUnknownFlags(request.args, knownFlags);
					if (unknown.length > 0) {
						return {
							ok: false,
							code: "INVALID_ARGUMENTS",
							error: unknownFlagsError(request.cmd, unknown),
							exitCode: 2,
						};
					}
				}
				const sessionCommand = options?.sessionCommands?.get(request.cmd);
				if (sessionCommand) return sessionCommand(request.args, sessionContext);
				if (
					request.cmd === "flow" &&
					["list", "init"].includes(request.args[0] ?? "")
				) {
					const response = await handleFlow(
						config,
						undefined,
						request.args,
						undefined,
						flowSources,
						flowLoadErrors,
						customReporters,
					);
					if (response.ok && request.args[0] === "init") deps.reloadFlows?.();
					return response;
				}
				function runTabCommand(): Promise<Response> {
					return handleTab(
						tabs,
						request.args,
						{
							clearRefs: () => {},
							createTab: () => managedTabs.newTab(),
						},
						request.json,
					);
				}
				const selectedTab = request.tab
					? tabs.tabs.find(({ identity }) => identity?.id === request.tab)
					: tabs.tabs[tabs.activeTabIndex];
				if (
					request.cmd === "tab" &&
					!request.tab &&
					!request.snapshotId &&
					tabs.tabs.length === 0
				)
					return runTabCommand();
				if (!selectedTab)
					return {
						ok: false,
						error: "找不到标签页，请用 tab list 查看。",
						code: "TAB_GONE",
						exitCode: 2,
					};
				const activeTabState: TabState = selectedTab;
				const { page, identity } = activeTabState;
				if (request.snapshotId && request.snapshotId !== identity?.snapshotId) {
					return {
						ok: false,
						error: "标签页的快照已变化，请重新运行 snapshot。",
						code: "STALE_REF",
						exitCode: 2,
					};
				}
				if (request.cmd !== "tab") await managedTabs.ready(page);

				function contextForPlugin(id: string): CommandContext {
					return {
						page,
						context: sessionContext,
						config,
						args: request.args,
						request: {
							session: request.session,
							json: request.json,
							timeout: request.timeout,
						},
						...(options?.pluginContext?.(id) ?? {
							sessionState: getPluginSessionState(pluginState, id),
						}),
					};
				}

				async function executeCommand(): Promise<Response> {
					switch (request.cmd) {
						case "goto":
							return handleGoto(page, request.args, {
								autoSnapshot: request.args.includes("--auto-snapshot"),
							});
						case "text":
							return handleText(page);
						case "snapshot": {
							const snapshot = identity && {
								tabId: identity.id,
								snapshotId: `s-${crypto.randomUUID()}`,
							};
							const response = await handleSnapshot(page, request.args, {
								json: request.json,
								identity: snapshot,
							});
							if (identity)
								identity.snapshotId = response.ok
									? snapshot?.snapshotId
									: undefined;
							return response;
						}
						case "click":
							return handleClick(page, request.args, {
								autoSnapshot: request.args.includes("--auto-snapshot"),
							});
						case "hover":
							return handleHover(page, request.args);
						case "fill":
							return handleFill(page, request.args);
						case "select":
							return handleSelect(page, request.args);
						case "scroll":
							return handleScroll(page, request.args);
						case "press":
							return handlePress(page, request.args, {
								autoSnapshot: request.args.includes("--auto-snapshot"),
							});
						case "screenshot":
							return handleScreenshot(page, request.args, {
								retention:
									config?.artifacts?.retention?.screenshots ??
									config?.artifacts?.retention?.default,
							});
						case "console":
							return handleConsole(activeTabState.consoleBuffer, request.args, {
								json: request.json,
							});
						case "network":
							return handleNetwork(activeTabState.networkBuffer, request.args, {
								json: request.json,
							});
						case "auth-state":
							return handleAuthState(sessionContext, page, request.args);
						case "login":
							return handleLogin(config, page, request.args);
						case "tab":
							return runTabCommand();
						case "flow":
							return handleFlow(
								config,
								page,
								request.args,
								{
									consoleBuffer: activeTabState.consoleBuffer,
									networkBuffer: activeTabState.networkBuffer,
									performWipe: wipeSession,
								},
								flowSources,
								flowLoadErrors,
								customReporters,
							);
						case "assert":
							return handleAssert(config, page, request.args);
						case "healthcheck":
							return handleHealthcheck(
								config,
								page,
								request.args,
								{
									consoleBuffer: activeTabState.consoleBuffer,
									networkBuffer: activeTabState.networkBuffer,
									newScratchPage: () =>
										managedTabs?.newScratchPage() ?? sessionContext.newPage(),
								},
								sessionContext,
							);
						case "wipe":
							return wipeSession();
						case "viewport":
							return handleViewport(page, request.args);
						case "eval":
							return handleEval(page, request.args);
						case "page-eval":
							return handlePageEval(page, request.args);
						case "wait":
							return handleWait(
								page,
								request.args,
								resolveTimeout(request.timeout, config?.timeout),
							);
						case "url":
							return handleUrl(page);
						case "back":
							return handleBack(page);
						case "forward":
							return handleForward(page);
						case "reload":
							return handleReload(page, request.args);
						case "attr":
							return handleAttr(page, request.args);
						case "upload":
							return handleUpload(page, request.args);
						case "a11y":
							return handleA11y(page, request.args, undefined, {
								json: request.json,
							});
						case "benchmark":
							return handleBenchmark(
								{
									context: sessionContext,
									scratchPage: await getScratchPage(sessionContext),
								},
								request.args,
								{
									json: request.json,
								},
							);
						case "dialog":
							return handleDialog(dialogState, request.args);
						case "download":
							return handleDownload(page, request.args, request.timeout);
						case "frame":
							return handleFrame(page, request.args, activeTabState);
						case "intercept":
							return handleIntercept(page, request.args, interceptState);
						case "cookies":
							return handleCookies(sessionContext, request.args, {
								json: request.json,
							});
						case "storage":
							return handleStorage(page, request.args, {
								json: request.json,
							});
						case "html":
							return handleHtml(page, request.args);
						case "title":
							return handleTitle(page);
						case "pdf":
							return handlePdf(page, request.args);
						case "element-count":
							return handleElementCount(page, request.args);
						case "trace":
							return handleTrace(
								sessionContext,
								getTraceState(sessionContext),
								request.args,
								{
									retention:
										config?.artifacts?.retention?.traces ??
										config?.artifacts?.retention?.default,
								},
							);
						case "video":
							return handleVideo(
								sessionContext,
								videoState,
								activeTabState,
								request.args,
								{
									attachListeners: (p) =>
										attachPageListeners(p, activeTabState),
									stealthOpts: stealthOpts
										? { userAgent: stealthOpts.userAgent }
										: undefined,
									proxyConfig,
									retention:
										config?.artifacts?.retention?.videos ??
										config?.artifacts?.retention?.default,
								},
							);
						case "screenshots":
							return handleScreenshots(request.args);
						case "report":
							return handleReport(request.args);
						case "form":
							return handleForm(page, request.args);
						case "test-matrix":
							return handleTestMatrix(config, request.args, sessionContext, {
								stealthOpts,
								proxy: proxyConfig,
								customReporters,
							});
						case "assert-ai":
							return handleAssertAi(page, request.args);
						case "replay":
							return handleReplay(request.args);
						case "diff":
							return handleDiff(
								config,
								page,
								request.args,
								{
									consoleBuffer: activeTabState.consoleBuffer,
									networkBuffer: activeTabState.networkBuffer,
									scratchPage: await getScratchPage(sessionContext),
								},
								sessionContext,
							);
						case "flow-share":
							return handleFlowShare(config, request.args);
						case "perf":
							return handlePerf(page, request.args, {
								json: request.json,
							});
						case "security":
							return handleSecurity(
								page,
								request.args,
								{
									context: sessionContext,
									networkBuffer: activeTabState.networkBuffer,
								},
								{ json: request.json },
							);
						case "responsive":
							return handleResponsive(page, request.args, {
								json: request.json,
							});
						case "extract":
							return handleExtract(page, request.args, {
								json: request.json,
							});
						case "crawl":
							return handleCrawl(page, request.args, {
								json: request.json,
							});
						case "record":
							return handleRecord(page, request.args);
						case "throttle":
							return handleThrottle(page, request.args);
						case "offline":
							return handleOffline(page, request.args);
						case "do":
							return handleDo(page, request.args);
						case "vrt":
							return handleVrt(page, request.args, {
								json: request.json,
							});
						case "watch":
							return handleWatch(page, request.args);
						case "seo":
							return handleSeo(page, request.args, {
								json: request.json,
							});
						case "subscribe":
							return handleSubscribe(page, request.args);
						case "dev":
							return handleDev(page, request.args, {
								config,
							});
						case "compliance":
							return handleCompliance(
								page,
								request.args,
								{
									context: sessionContext,
									networkBuffer: activeTabState.networkBuffer,
								},
								{ json: request.json },
							);
						case "security-scan":
							return handleSecurityScan(page, request.args, {
								json: request.json,
							});
						case "i18n":
							return handleI18n(page, request.args, {
								json: request.json,
							});
						case "api-assert":
							return handleApiAssertCmd(page, request.args, {
								json: request.json,
							});
						case "design-audit":
							return handleDesignAudit(page, request.args, {
								json: request.json,
							});
						case "doc-capture":
							return handleDocCapture(page, request.args, {
								json: request.json,
							});
						case "gesture":
							return handleGesture(page, request.args);
						case "devices":
							return handleDevices(page, request.args);
						case "monitor":
							return handleMonitor(page, request.args);
						default: {
							// Dispatch to plugin commands
							const pluginCmd = pluginRegistry.commands.get(request.cmd);
							if (pluginCmd?.command.handler) {
								try {
									return await pluginCmd.command.handler(
										contextForPlugin(pluginCmd.plugin),
									);
								} catch (err) {
									if (isCommandError(err)) return pluginError(err);
									const message =
										err instanceof Error ? err.message : String(err);
									return {
										ok: false,
										error: `Plugin '${pluginCmd.plugin}' error: ${message}`,
									};
								}
							}
							return {
								ok: false,
								error: `Command '${request.cmd}' is not yet implemented.`,
							};
						}
					}
				}

				if (pluginRegistry.hooks.beforeCommand.length > 0) {
					const hookResponse = await runBeforeHooks(
						pluginRegistry,
						request.cmd,
						contextForPlugin,
					);
					if (hookResponse) {
						return hookResponse;
					}
				}

				try {
					const response = await withRefState(identity?.refs, executeCommand);
					if (pluginRegistry.hooks.afterCommand.length > 0)
						await runAfterHooks(
							pluginRegistry,
							request.cmd,
							contextForPlugin,
							response,
						);
					return response;
				} finally {
					scheduleSessionStatePersist();
					if (!COMMANDS_KEEPING_SNAPSHOT.has(request.cmd)) {
						if (identity && request.cmd !== "tab")
							identity.snapshotId = undefined;
					}
				}
			}

			const response = await dispatchRequest(parsedRequest, (request) => {
				return scheduler.execute(
					() => executeRequest(request),
					commandTimeout(request),
				);
			});
			logCommandCompletion(response);
			return reply(
				serialiseResponse(response),
				response.ok &&
					!isBatchRequest(parsedRequest) &&
					parsedRequest.cmd === shutdownCommand,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply(serialiseResponse({ ok: false, error: message }));
		} finally {
			activeCommands = Math.max(0, activeCommands - 1);
			if (activeCommands === 0 && !scheduler.busy) {
				runMemoryPressureMitigation(true);
			}
		}
	}

	try {
		server = await listenOnSocket(
			lifecycleConfig.socketPath,
			async (line, connection) => {
				try {
					const request = parseRequest(line, pluginCommandNames);
					async function runRequest() {
						if (!connection.isOpen()) return;
						if (shutdownPromise) {
							await connection.send(serialiseResponse(notStarted()));
							return;
						}
						const result = await handleConnection(request);
						if (result.shouldShutdown) {
							connection.end(result.responseStr);
							await shutdownOnce();
							return;
						}
						await connection.send(result.responseStr);
					}
					if (!(await scheduler.enqueue(runRequest, request.queueTimeout)))
						await connection.send(serialiseResponse(notStarted()));
				} catch (error) {
					await connection.send(
						serialiseResponse({
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				}
			},
		);
	} catch (error) {
		idleTimer.clear();
		throw error;
	}
	return { server, idleTimer, shutdown };
}
