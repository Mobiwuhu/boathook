import { join } from "node:path";
import type { NetworkRule, NetworkRules } from "@boathook/plugin-sdk";
import { CommandError } from "@boathook/plugin-sdk";
import type { BrowserContext, Worker } from "playwright";
import { ensurePrivateDirectory } from "../files.ts";
import manifest from "./network-extension/manifest.json";
import workerSource from "./network-extension/worker.js" with { type: "text" };

export async function stageNetworkExtension(directory: string): Promise<void> {
	if (typeof workerSource !== "string")
		throw new Error("Chrome 扩展资源读取失败，请重新构建 boathook。");
	ensurePrivateDirectory(directory);
	await Promise.all([
		Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest)),
		Bun.write(join(directory, "worker.js"), workerSource),
	]);
}

export async function loadNetworkExtension(
	context: BrowserContext,
	directory: string,
): Promise<NetworkRuleStore> {
	const browser = context.browser();
	if (!browser) throw new Error("Chrome 调试会话不可用。");
	const cdp = await browser.newBrowserCDPSession();
	const previousWorkers = new Set(context.serviceWorkers());
	let id: string;
	try {
		({ id } = await cdp.send("Extensions.loadUnpacked", { path: directory }));
	} finally {
		await cdp.detach().catch(() => {});
	}
	const workerUrl = `chrome-extension://${id}/worker.js`;
	// Reloading a persisted extension can return before its old worker detaches.
	function isLoadedWorker(worker: Worker): boolean {
		return worker.url() === workerUrl && !previousWorkers.has(worker);
	}
	const worker =
		context.serviceWorkers().find(isLoadedWorker) ??
		(await context.waitForEvent("serviceworker", {
			predicate: isLoadedWorker,
			timeout: 5000,
		}));
	return new NetworkRuleStore(worker);
}

export class NetworkRuleStore {
	private readonly ids = new Map<string, number[]>();
	private nextId = 1;
	private pending = Promise.resolve();

	constructor(private readonly worker: Worker) {}

	forPlugin(id: string): NetworkRules {
		return {
			replace: (rules) => {
				const update = this.pending.then(() => this.replace(id, rules));
				this.pending = update.catch(() => {});
				return update;
			},
		};
	}

	private async replace(id: string, rules: readonly NetworkRule[]) {
		const ids = this.ids.get(id) ?? [];
		// Keep reservations after failures so a retry can remove every rule owned by this plugin.
		const addRules = rules.map((rule, index) => {
			const ruleId = ids[index] ?? this.nextId++;
			ids[index] = ruleId;
			return { ...rule, id: ruleId };
		});
		if (ids.length === 0) return;
		this.ids.set(id, ids);
		const rejected = await this.worker.evaluate(
			async ({ addRules, removeRuleIds }) => {
				const dnr = chrome.declarativeNetRequest;
				for (const { condition } of addRules) {
					if (!condition.regexFilter) continue;
					const { isSupported } = await dnr.isRegexSupported({
						regex: condition.regexFilter,
						isCaseSensitive: condition.isUrlFilterCaseSensitive,
					});
					if (!isSupported) return "Chrome 不支持这条网络规则的正则。";
				}
				try {
					await dnr.updateSessionRules({ addRules, removeRuleIds });
					return null;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
			{ addRules, removeRuleIds: ids },
		);
		if (rejected) {
			throw new CommandError(
				"NETWORK_RULES_REJECTED",
				`Chrome 拒绝了网络规则。请检查条件和动作后重试。\n${rejected}`,
			);
		}
	}
}
