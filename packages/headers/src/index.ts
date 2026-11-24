import { validateHeaderName, validateHeaderValue } from "node:http";
import type { BrowserContext, CDPSession, Page } from "@boathook/plugin-sdk";
import {
	type BoathookPlugin,
	CommandError,
	defineCommand,
	type PluginCapabilities,
} from "@boathook/plugin-sdk";
import { compileSafePattern, RingBuffer } from "@boathook/plugin-sdk/utilities";
import { z } from "incur";
import { version } from "../package.json";
import { compileHeaderRules } from "./rules.ts";

const scopeSchema = z.strictObject({
	hosts: z.array(z.string()).default([]),
	hostRegex: z.array(z.string()).default([]),
});
const optionsSchema = z
	.strictObject({
		scope: z.union([z.literal("all"), scopeSchema]).default("all"),
		set: z.record(z.string(), z.string()).default({}),
	})
	.transform(normalizeOptions);
type Options = z.infer<typeof optionsSchema>;
type Transport = "http" | "ws";
type Evidence = {
	version: number;
	transport: Transport;
	host: string;
	matched: boolean;
};
const states = new WeakMap<
	BrowserContext,
	{
		options: Options;
		version: number;
		evidence: RingBuffer<Evidence>;
		matches: (host: string) => boolean;
	}
>();
const prepared = new WeakMap<Page, Promise<void>>();

function hostname(input: string): string {
	try {
		const url = new URL(input.includes("://") ? input : `http://${input}`);
		if (url.username || url.password || !url.hostname) throw new Error();
		return url.hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		throw new CommandError("INVALID_HOST", "请提供有效的目标域名。");
	}
}

function normalizeOptions(options: {
	scope: "all" | z.infer<typeof scopeSchema>;
	set: Record<string, string>;
}) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(options.set)) {
		try {
			validateHeaderName(name);
			validateHeaderValue(name, value);
			headers.set(name, value);
		} catch {
			throw new CommandError("INVALID_HEADER", "请检查请求头名称和值的格式。");
		}
	}
	const { scope } = options;
	if (scope === "all") return { set: Object.fromEntries(headers), scope };
	if (!scope.hosts.length && !scope.hostRegex.length) {
		throw new CommandError(
			"EMPTY_HEADER_SCOPE",
			"请保留一个过滤条件，或执行 scope all 恢复全局。",
		);
	}
	for (const pattern of scope.hostRegex) {
		try {
			compileSafePattern(pattern);
		} catch {
			throw new CommandError(
				"INVALID_HOST_REGEX",
				`无法编译域名正则 ${pattern}，请修正后重试。`,
			);
		}
	}
	return {
		set: Object.fromEntries(headers),
		scope: {
			hosts: [...new Set(scope.hosts.map(hostname))],
			hostRegex: [...new Set(scope.hostRegex)],
		},
	};
}

function stateFor(context: BrowserContext) {
	const state = states.get(context);
	if (!state) throw new Error("会话的请求头配置尚未准备好。");
	return state;
}

function describe(options: Options, version?: number) {
	return { scope: options.scope, names: Object.keys(options.set), version };
}

function scopeMatcher(scope: Options["scope"]): (host: string) => boolean {
	if (scope === "all") return () => true;
	const hosts = new Set(scope.hosts);
	const patterns = scope.hostRegex.map(compileSafePattern);
	return (host) =>
		hosts.has(host) || patterns.some((pattern) => pattern.test(host));
}

async function apply(
	context: BrowserContext,
	options: Options,
	capabilities?: PluginCapabilities,
): Promise<(host: string) => boolean> {
	const { scope, set } = options;
	const matches = scopeMatcher(scope);
	if (capabilities?.networkRules) {
		await capabilities.networkRules.replace(compileHeaderRules(set, scope));
		return matches;
	}
	if (options.scope !== "all") {
		throw new CommandError(
			"HEADER_SCOPE_UNSUPPORTED",
			"当前浏览器未加载网络扩展。请使用随发行包提供的 Chrome，或执行 scope all。",
		);
	}
	await context.setExtraHTTPHeaders(set);
	return matches;
}

function record(
	context: BrowserContext,
	transport: Transport,
	url: string,
	version: number,
	matched: boolean,
): void {
	const state = stateFor(context);
	if (state.version !== version) return;
	const host = hostname(url);
	if (!state.matches(host)) return;
	state.evidence.push({ version, transport, host, matched });
}

function matchesHeaders(
	options: Options,
	headers: Record<string, unknown>,
): boolean {
	const actual = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return Object.entries(options.set).every(
		([key, value]) => actual[key] === value,
	);
}

function watchHttp(context: BrowserContext, cdp: CDPSession): void {
	type Hop = { url: string; version: number; preflight: boolean };
	type Comparison = { version: number; matched: boolean };
	type Pending = { active?: Hop; sent: Hop[]; comparisons: Comparison[] };
	const requests = new Map<string, Pending>();
	function requestFor(id: string): Pending {
		const existing = requests.get(id);
		if (existing) return existing;
		if (requests.size >= 500) {
			const oldest = requests.keys().next().value;
			if (oldest !== undefined) requests.delete(oldest);
		}
		const pending: Pending = { sent: [], comparisons: [] };
		requests.set(id, pending);
		return pending;
	}
	// Redirect hops reuse the CDP request ID. Pair only hops with real wire headers.
	function recordCompleted(pending: Pending) {
		while (pending.sent.length && pending.comparisons.length) {
			const hop = pending.sent.shift();
			const comparison = pending.comparisons.shift();
			if (
				hop &&
				comparison &&
				!hop.preflight &&
				hop.version === comparison.version &&
				/^https?:/.test(hop.url)
			) {
				record(context, "http", hop.url, hop.version, comparison.matched);
			}
		}
	}
	function finishHop(pending: Pending, sent: boolean): void {
		if (sent && pending.active) pending.sent.push(pending.active);
		pending.active = undefined;
		recordCompleted(pending);
	}
	cdp.on(
		"Network.requestWillBeSent",
		({ requestId, request, redirectResponse, redirectHasExtraInfo, type }) => {
			const pending = requestFor(requestId);
			if (redirectResponse) finishHop(pending, redirectHasExtraInfo);
			pending.active = {
				url: request.url,
				version: stateFor(context).version,
				preflight: type === "Preflight",
			};
		},
	);
	cdp.on("Network.requestWillBeSentExtraInfo", ({ requestId, headers }) => {
		const pending = requestFor(requestId);
		const { version, options } = stateFor(context);
		pending.comparisons.push({
			version,
			matched: matchesHeaders(options, headers),
		});
		recordCompleted(pending);
		if (!pending.active && !pending.sent.length && !pending.comparisons.length)
			requests.delete(requestId);
	});
	cdp.on("Network.responseReceived", ({ requestId, hasExtraInfo }) => {
		const pending = requests.get(requestId);
		if (!pending) return;
		finishHop(pending, hasExtraInfo);
		if (!pending.sent.length && !pending.comparisons.length)
			requests.delete(requestId);
	});
	cdp.on("Network.loadingFailed", ({ requestId }) =>
		requests.delete(requestId),
	);
}

function preparePage(page: Page): Promise<void> {
	const previous = prepared.get(page);
	if (previous) return previous;
	const pending = (async () => {
		const context = page.context();
		const cdp = await context.newCDPSession(page);
		watchHttp(context, cdp);
		const urls = new Map<string, string>();
		cdp.on("Network.webSocketCreated", ({ requestId, url }) => {
			if (urls.size >= 500) urls.delete(urls.keys().next().value ?? "");
			urls.set(requestId, url);
		});
		cdp.on("Network.webSocketClosed", ({ requestId }) =>
			urls.delete(requestId),
		);
		cdp.on(
			"Network.webSocketWillSendHandshakeRequest",
			({ requestId, request }) => {
				const url = urls.get(requestId);
				if (url) {
					const { version, options } = stateFor(context);
					record(
						context,
						"ws",
						url,
						version,
						matchesHeaders(options, request.headers),
					);
				}
			},
		);
		await cdp.send("Network.enable");
	})();
	prepared.set(page, pending);
	return pending;
}

function mutate<
	Args extends z.ZodObject | undefined = undefined,
	Flags extends z.ZodObject | undefined = undefined,
>(
	name: string,
	summary: string,
	usage: string,
	input: { args?: Args; flags?: Flags },
	change: (
		options: Options,
		input: import("incur").Parser.parse.ReturnType<Args, Flags>,
	) => Options,
) {
	return defineCommand<Args, Flags>({
		name,
		summary,
		usage: `boathook --session NAME plugin headers ${usage}`,
		...input,
		configure(input, options) {
			const next = normalizeOptions(change(options as Options, input));
			return { data: describe(next), options: next };
		},
	});
}

function parseHeaderPairs(headers: string[]): Record<string, string> {
	return Object.fromEntries(
		headers.map((pair) => {
			const separator = pair.indexOf("=");
			if (separator <= 0)
				throw new CommandError(
					"INVALID_HEADER",
					"请按 --header NAME=VALUE 提供请求头。",
				);
			return [pair.slice(0, separator), pair.slice(separator + 1)];
		}),
	);
}

const read = (name: "list" | "scope list") =>
	defineCommand({
		name,
		summary: "查看请求头名称、作用域及生效版本",
		usage: `boathook --session NAME plugin headers ${name}`,
		run: ({ context }) => {
			const { options, version } = stateFor(context);
			return describe(options, version);
		},
	});

const headerName = z.string().describe("请求头名称");
const scopeFlags = z.object({
	host: z.array(z.string()).optional(),
	regex: z.array(z.string()).optional(),
});
const scopeCommands = ["add", "remove"].map((action) =>
	mutate(
		`scope ${action}`,
		"修改请求目标域名条件",
		`scope ${action} [--host HOST] [--regex PATTERN]`,
		{ flags: scopeFlags },
		(options, { options: flags }) => {
			const hosts = (flags.host ?? []).map(hostname);
			const hostRegex = flags.regex ?? [];
			if (!hosts.length && !hostRegex.length)
				throw new CommandError(
					"INVALID_ARGUMENTS",
					"请提供 --host HOST 或 --regex PATTERN。",
				);
			if (action === "remove" && options.scope === "all") return options;
			const before =
				options.scope === "all" ? { hosts: [], hostRegex: [] } : options.scope;
			return {
				...options,
				scope: {
					hosts:
						action === "add"
							? [...before.hosts, ...hosts]
							: before.hosts.filter((host) => !hosts.includes(host)),
					hostRegex:
						action === "add"
							? [...before.hostRegex, ...hostRegex]
							: before.hostRegex.filter((regex) => !hostRegex.includes(regex)),
				},
			};
		},
	),
);

const plugin: BoathookPlugin = {
	name: "headers",
	version,
	apiVersion: 1,
	optionsSchema,
	validateRuntime(raw) {
		const { set, scope } = raw as Options;
		compileHeaderRules(set, scope);
	},
	hooks: {
		async prepareContext(context, raw, { capabilities }) {
			const options = raw as Options;
			const matches = await apply(context, options, capabilities);
			states.set(context, {
				options,
				version: 1,
				evidence: new RingBuffer(500),
				matches,
			});
		},
		preparePage,
		async updateOptions(context, raw, { capabilities }) {
			const state = stateFor(context);
			const { options: previous, version } = state;
			const next = raw as Options;
			state.matches = await apply(context, next, capabilities);
			state.options = next;
			state.version++;
			return async () => {
				state.matches = await apply(context, previous, capabilities);
				state.options = previous;
				state.version = version;
				state.evidence.clear();
			};
		},
	},
	commands: [
		read("list"),
		read("scope list"),
		mutate(
			"replace",
			"替换整组请求头",
			"replace --header NAME=VALUE [--header NAME=VALUE ...]",
			{ flags: z.object({ header: z.array(z.string()).min(1) }) },
			(options, { options: { header } }) => ({
				...options,
				set: parseHeaderPairs(header),
			}),
		),
		mutate(
			"set",
			"设置请求头覆盖值",
			"set NAME VALUE",
			{ args: z.object({ name: headerName, value: z.string() }) },
			(options, { args }) => ({
				...options,
				set: { ...options.set, [args.name.toLowerCase()]: args.value },
			}),
		),
		mutate(
			"remove",
			"移除请求头覆盖值",
			"remove NAME",
			{ args: z.object({ name: headerName }) },
			(options, { args }) => ({
				...options,
				set: Object.fromEntries(
					Object.entries(options.set).filter(
						([key]) => key !== args.name.toLowerCase(),
					),
				),
			}),
		),
		...scopeCommands,
		mutate("scope all", "恢复全局作用域", "scope all", {}, (options) => ({
			...options,
			scope: "all",
		})),
		defineCommand({
			name: "verify",
			summary: "检查当前版本的实际浏览器请求",
			usage:
				"boathook --session NAME plugin headers verify [--transport http|ws] [--host HOST]",
			flags: z.object({
				transport: z.enum(["http", "ws"]).optional(),
				host: z.string().optional(),
			}),
			run({ input: { options }, context }) {
				const { version, evidence } = stateFor(context);
				const host = options.host && hostname(options.host);
				const observed = evidence.peek(
					(item) =>
						item.version === version &&
						(!host || item.host === host) &&
						(!options.transport || item.transport === options.transport),
				);
				const required = options.transport
					? [options.transport]
					: ["http", "ws"];
				if (
					!required.every((type) =>
						observed.some(({ transport }) => transport === type),
					)
				) {
					throw new CommandError(
						"INSUFFICIENT_EVIDENCE",
						"请在当前页触发所需 HTTP 请求或新建 WebSocket 后重试。",
						4,
					);
				}
				if (observed.some(({ matched }) => !matched))
					throw new CommandError(
						"HEADER_MISMATCH",
						"观察到请求头与当前规则不一致，请重试并核对目标域。",
						4,
					);
				return { version, observed };
			},
		}),
	],
};

export default plugin;
