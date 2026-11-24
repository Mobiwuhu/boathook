import {
	activateTab,
	removeTab,
	type TabRegistry,
	type TabState,
} from "../browser/tabs.ts";
import type { Response } from "../ipc/protocol.ts";

export type { TabRegistry, TabState } from "../browser/tabs.ts";

export type TabCallbacks = {
	clearRefs: () => void;
	createTab: () => Promise<TabState>;
};

const VALID_SUBCOMMANDS = ["list", "new", "switch", "close"];

export async function handleTab(
	registry: TabRegistry,
	args: string[],
	callbacks: TabCallbacks,
	json = false,
): Promise<Response> {
	const subcommand = args[0];

	switch (subcommand) {
		case "list":
			return handleList(registry, json);
		case "new":
			return handleNew(registry, args, callbacks);
		case "switch":
			return handleSwitch(registry, args, callbacks);
		case "close":
			return handleClose(registry, args, callbacks);
		default:
			return {
				ok: false,
				error: `Usage: boathook --session NAME tab <list|new|switch|close>. Valid subcommands: ${VALID_SUBCOMMANDS.join(", ")}.`,
			};
	}
}

async function handleList(
	registry: TabRegistry,
	json: boolean,
): Promise<Response> {
	const tabs = await Promise.all(
		registry.tabs.map(async (tab, index) => ({
			index: index + 1,
			tabId: tab.identity?.id,
			active: index === registry.activeTabIndex,
			title: await tab.page.title(),
			url: tab.page.url(),
		})),
	);
	const data = json
		? JSON.stringify(tabs)
		: tabs
				.map(({ index, tabId, active, title, url }) => {
					const marker = active ? " [active]" : "";
					return `  ${index}.${tabId ? ` ${tabId}` : ""}${marker} "${title}" (${url})`;
				})
				.join("\n");
	return { ok: true, data };
}

function tabIndex(registry: TabRegistry, target: string): number {
	return target.startsWith("t-")
		? registry.tabs.findIndex(({ identity }) => identity?.id === target) + 1
		: Number.parseInt(target, 10);
}

async function handleNew(
	registry: TabRegistry,
	args: string[],
	callbacks: TabCallbacks,
): Promise<Response> {
	const url = args[1];

	try {
		const tabState = await callbacks.createTab();
		if (!registry.tabs.includes(tabState)) registry.tabs.push(tabState);
		const index = activateTab(registry, tabState) + 1;
		callbacks.clearRefs();

		const label = tabState.identity
			? `${index} (${tabState.identity.id})`
			: String(index);

		if (url) {
			await tabState.page.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: 30_000,
			});
			return {
				ok: true,
				data: `Opened tab ${label}: ${url}`,
			};
		}

		return {
			ok: true,
			data: `Opened tab ${label} (blank)`,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

async function handleSwitch(
	registry: TabRegistry,
	args: string[],
	callbacks: TabCallbacks,
): Promise<Response> {
	const indexArg = args[1];
	if (!indexArg) {
		return {
			ok: false,
			error:
				"Missing tab index. Usage: boathook --session NAME tab switch <index>",
		};
	}

	const index = tabIndex(registry, indexArg);
	if (Number.isNaN(index)) {
		return {
			ok: false,
			error: `Invalid tab index: ${indexArg}. Must be a number.`,
		};
	}

	const tab = registry.tabs[index - 1];
	if (!tab) {
		return {
			ok: false,
			error: `Invalid tab index: ${index}. Open tabs: 1–${registry.tabs.length}.`,
		};
	}

	await tab.page.bringToFront();
	activateTab(registry, tab);
	callbacks.clearRefs();

	const title = await tab.page.title();
	const url = tab.page.url();

	return {
		ok: true,
		data: `Switched to tab ${index}: "${title}" (${url})`,
	};
}

async function handleClose(
	registry: TabRegistry,
	args: string[],
	callbacks: TabCallbacks,
): Promise<Response> {
	if (registry.tabs.length === 1) {
		return {
			ok: false,
			error:
				"Cannot close the only open tab. Use 'boathook stop NAME' to stop the daemon.",
		};
	}

	let closeIndex: number;

	const indexArg = args[1];
	if (indexArg) {
		const parsed = tabIndex(registry, indexArg);
		if (Number.isNaN(parsed) || parsed < 1 || parsed > registry.tabs.length) {
			return {
				ok: false,
				error: `Invalid tab index: ${indexArg}. Open tabs: 1–${registry.tabs.length}.`,
			};
		}
		closeIndex = parsed - 1;
	} else {
		closeIndex = registry.activeTabIndex;
	}

	const closedTab = registry.tabs[closeIndex];
	if (!closedTab) return { ok: false, error: "No open tab to close." };
	const closedDisplayIndex = closeIndex + 1;

	await closedTab.page.close();
	removeTab(registry, closedTab);

	callbacks.clearRefs();

	const activeTab = registry.tabs[registry.activeTabIndex];
	if (!activeTab)
		return { ok: true, data: `Closed tab ${closedDisplayIndex}.` };
	const title = await activeTab.page.title();

	return {
		ok: true,
		data: `Closed tab ${closedDisplayIndex}. Active tab is now ${registry.activeTabIndex + 1}: "${title}"`,
	};
}
