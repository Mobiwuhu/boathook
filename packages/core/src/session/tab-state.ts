import { copyFileSync, readFileSync } from "node:fs";
import { z } from "incur";

const tabsSchema = z
	.object({
		version: z.literal(1),
		activeTabIndex: z.number().int().nonnegative(),
		tabs: z.array(z.object({ url: z.string(), id: z.string().optional() })),
	})
	.refine(
		({ activeTabIndex, tabs }) => activeTabIndex < Math.max(1, tabs.length),
	);

export type TabSnapshot = z.infer<typeof tabsSchema>;

export function readTabSnapshot(path: string): TabSnapshot | null {
	try {
		return tabsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			try {
				copyFileSync(path, `${path}.corrupt-${Date.now()}`);
			} catch {
				// Best effort when the damaged state cannot be read.
			}
		}
		return null;
	}
}
