import { join } from "node:path";
import { z } from "incur";
import { readJson, writeRecord } from "../files.ts";
import { stateRoot } from "../paths.ts";
import { withPathLock } from "../session/lock.ts";
import { pluginManifestSchema } from "./manifest.ts";

const installedPluginSchema = pluginManifestSchema.extend({
	entry: z.string(),
	source: z.string(),
});
const installedSchema = z.array(installedPluginSchema);
export type InstalledPlugin = z.infer<typeof installedPluginSchema>;

export function pluginDirectory(): string {
	return join(stateRoot(), "plugins");
}

export async function installedPlugins(): Promise<
	Map<string, InstalledPlugin>
> {
	const installed = await readJson(
		join(pluginDirectory(), "installed.json"),
		installedSchema,
	);
	return new Map(installed?.map((plugin) => [plugin.id, plugin]));
}

export async function recordInstalledPlugin(
	plugin: InstalledPlugin,
): Promise<void> {
	const directory = pluginDirectory();
	const index = join(directory, "installed.json");
	await withPathLock(directory, join(directory, "install.lock"), async () => {
		const previous = (await readJson(index, installedSchema)) ?? [];
		await writeRecord(index, [
			...previous.filter(({ id }) => id !== plugin.id),
			installedPluginSchema.parse(plugin),
		]);
	});
}
