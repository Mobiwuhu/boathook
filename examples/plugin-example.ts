import {
	type BoathookPlugin,
	CommandError,
	defineCommand,
} from "@boathook/plugin-sdk";

// From the repository root:
// boathook start qa --url https://example.com --config-json '{"plugins":[{"id":"timing","entry":"./examples/plugin-example.ts"}]}'
// boathook --session qa plugin timing timing --json
const plugin: BoathookPlugin = {
	name: "timing",
	version: "1.0.0",
	apiVersion: 1,

	commands: [
		defineCommand({
			name: "timing",
			summary: "Show page load timing metrics",
			usage: "boathook --session NAME plugin timing timing [--json]",
			async run({ page }) {
				const url = page.url();
				if (url === "about:blank")
					throw new CommandError(
						"NAVIGATION_TIMING_UNAVAILABLE",
						"Navigate to a page first.",
					);

				const timing = await page.evaluate(() => {
					const [navigation] = performance.getEntriesByType(
						"navigation",
					) as PerformanceNavigationTiming[];
					if (!navigation) return null;
					return {
						ttfb: Math.round(
							navigation.responseStart - navigation.requestStart,
						),
						domContentLoaded: Math.round(
							navigation.domContentLoadedEventEnd - navigation.startTime,
						),
						load: Math.round(navigation.loadEventEnd - navigation.startTime),
						domInteractive: Math.round(
							navigation.domInteractive - navigation.startTime,
						),
						transferSize: navigation.transferSize,
					};
				});

				if (!timing)
					throw new CommandError(
						"NAVIGATION_TIMING_UNAVAILABLE",
						"No navigation timing data available.",
					);
				return { url, ...timing };
			},
		}),
	],

	hooks: {
		async init(config) {
			console.error(
				`[timing plugin] Loaded${config ? " (config found)" : " (no config)"}`,
			);
		},

		async beforeCommand(cmd, { sessionState }) {
			const history = (sessionState.history ?? []) as string[];
			history.push(`${cmd} @ ${new Date().toISOString()}`);
			sessionState.history = history;
		},

		async cleanup() {
			console.error("[timing plugin] Shutting down");
		},
	},
};

export default plugin;
