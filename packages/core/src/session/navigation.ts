import { z } from "incur";
import { readTabSnapshot } from "./tab-state.ts";

export const navigationSchema = z
	.object({
		tabs: z
			.array(z.object({ id: z.string().optional(), url: z.string() }))
			.min(1),
		activeTabIndex: z.number().int().nonnegative(),
		requireActiveNavigation: z.boolean(),
		pluginUrl: z.string().optional(),
	})
	.refine(({ tabs, activeTabIndex }) => activeTabIndex < tabs.length);

export type NavigationPlan = z.infer<typeof navigationSchema>;

export function planNavigation(
	statePath: string,
	entryUrl: string | undefined,
	useEntry: boolean,
): NavigationPlan {
	const saved = readTabSnapshot(statePath);
	if (!saved?.tabs.length) {
		return {
			tabs: [{ url: entryUrl ?? "about:blank" }],
			activeTabIndex: 0,
			requireActiveNavigation: true,
			pluginUrl: entryUrl,
		};
	}
	const { activeTabIndex } = saved;
	const tabs = saved.tabs.map((tab, index) =>
		useEntry && entryUrl && index === activeTabIndex
			? { ...tab, url: entryUrl }
			: tab,
	);
	const activeUrl = tabs[activeTabIndex]?.url;
	return {
		tabs,
		activeTabIndex,
		requireActiveNavigation: useEntry,
		pluginUrl:
			activeUrl && URL.parse(activeUrl)?.hostname ? activeUrl : entryUrl,
	};
}
