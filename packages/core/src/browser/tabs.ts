import { RingBuffer } from "@boathook/plugin-sdk/utilities";
import type { BrowserContext, Page } from "playwright";
import type { ConsoleEntry } from "../commands/console.ts";
import type { NetworkEntry } from "../commands/network.ts";
import type { NavigationPlan } from "../session/navigation.ts";
import { createRefState, type RefState } from "./refs.ts";

export type TabState = {
	page: Page;
	consoleBuffer: RingBuffer<ConsoleEntry>;
	networkBuffer: RingBuffer<NetworkEntry>;
	identity?: { id: string; snapshotId?: string; refs: RefState };
	selectedFrameIndex?: number;
};

export type TabRegistry = {
	tabs: TabState[];
	activeTabIndex: number;
};

export function createTabState(page: Page): TabState {
	return {
		page,
		consoleBuffer: new RingBuffer(500),
		networkBuffer: new RingBuffer(500),
	};
}

export function activateTab(registry: TabRegistry, tab: TabState): number {
	const index = registry.tabs.indexOf(tab);
	if (index < 0) return -1;
	registry.activeTabIndex = index;
	return index;
}

export function removeTab(registry: TabRegistry, tab: TabState): void {
	const index = registry.tabs.indexOf(tab);
	if (index < 0) return;
	registry.tabs.splice(index, 1);
	if (index < registry.activeTabIndex) registry.activeTabIndex--;
	registry.activeTabIndex = Math.max(
		0,
		Math.min(registry.activeTabIndex, registry.tabs.length - 1),
	);
}

type TabEvents = {
	attach: (tab: TabState) => void;
	prepare?: (page: Page) => Promise<void>;
	changed: () => void;
	error: (error: unknown) => void;
};

type RegisteredTab = { tab: TabState; ready: Promise<void> };

export class ManagedTabs {
	private readonly registered = new WeakMap<Page, RegisteredTab>();
	private readonly scratch = new WeakSet<Page>();
	private readonly openingScratch = new Set<Promise<Page>>();

	constructor(
		private readonly context: BrowserContext,
		private readonly registry: TabRegistry,
		private readonly events: TabEvents,
	) {}

	private register(page: Page, id?: string): RegisteredTab {
		const previous = this.registered.get(page);
		if (previous) {
			if (id && previous.tab.identity) previous.tab.identity.id = id;
			return previous;
		}
		const tab = createTabState(page);
		tab.identity = {
			id: id ?? `t-${crypto.randomUUID().slice(0, 8)}`,
			refs: createRefState(),
		};
		const ready = Promise.resolve().then(() => this.events.prepare?.(page));
		const entry = { tab, ready };
		this.registered.set(page, entry);
		this.registry.tabs.push(tab);
		this.events.attach(tab);
		page.once("close", () => {
			removeTab(this.registry, tab);
			this.events.changed();
		});
		this.events.changed();
		void ready.catch((error: unknown) => {
			if (!page.isClosed()) this.events.error(error);
		});
		return entry;
	}

	private async observe(page: Page): Promise<void> {
		// The page event fires before context.newPage() resolves.
		if (this.openingScratch.size > 0)
			await Promise.allSettled(this.openingScratch);
		if (!this.scratch.has(page) && !page.isClosed()) this.register(page);
	}

	async newScratchPage(): Promise<Page> {
		const opening = this.context.newPage().then(async (page) => {
			this.scratch.add(page);
			try {
				await this.events.prepare?.(page);
				return page;
			} catch (error) {
				await page.close().catch(() => {});
				throw error;
			}
		});
		this.openingScratch.add(opening);
		try {
			return await opening;
		} finally {
			this.openingScratch.delete(opening);
		}
	}

	async newTab(): Promise<TabState> {
		const page = await this.context.newPage();
		if (page.isClosed()) throw new Error("新标签页已关闭，请重新创建。");
		const { tab, ready } = this.register(page);
		try {
			await ready;
			if (page.isClosed()) throw new Error("新标签页已关闭，请重新创建。");
			return tab;
		} catch (error) {
			await page.close().catch(() => {});
			throw error;
		}
	}

	async ready(page: Page): Promise<void> {
		await this.registered.get(page)?.ready;
	}

	async restore(initialPage: Page, plan?: NavigationPlan): Promise<void> {
		const existing = [
			initialPage,
			...this.context.pages().filter((page) => page !== initialPage),
		];
		this.context.on("page", (page) => {
			void this.observe(page).catch(this.events.error);
		});
		if (!plan) {
			for (const page of existing) await this.register(page).ready;
			return;
		}
		const targets = [];
		for (const [index, { id, url }] of plan.tabs.entries()) {
			const page = existing[index] ?? (await this.context.newPage());
			const { tab, ready } = this.register(page, id);
			await ready;
			targets.push({ url, tab });
		}
		for (const page of existing.slice(plan.tabs.length))
			await this.observe(page);
		const activeTab = targets[plan.activeTabIndex]?.tab;
		if (activeTab) activateTab(this.registry, activeTab);
		for (const { url, tab } of targets) {
			if (url === "about:blank" && tab.page.url() === url) continue;
			try {
				await tab.page.goto(url, {
					waitUntil: "domcontentloaded",
					timeout: 30_000,
				});
			} catch (error) {
				if (tab === activeTab && plan.requireActiveNavigation) throw error;
				this.events.error(error);
			}
		}
	}
}
