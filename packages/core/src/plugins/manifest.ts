import type { BoathookPlugin, PluginCommand } from "@boathook/plugin-sdk";
import { z } from "incur";

export const pluginIdentifier = /^[\w][\w.-]*$/;
const reservedIds = new Set([
	"boathook",
	"ls",
	"install",
	"enable",
	"disable",
	"help",
]);

export const pluginIdSchema = z
	.string()
	.regex(pluginIdentifier)
	.refine((id) => !reservedIds.has(id));

const jsonSchema = z.record(z.string(), z.unknown());
export const pluginManifestSchema = z.object({
	id: pluginIdSchema,
	version: z.string(),
	commands: z.array(
		z.object({
			path: z.array(z.string().regex(pluginIdentifier)).min(1),
			summary: z.string(),
			usage: z.string(),
			updatesConfig: z.boolean(),
			args: jsonSchema.optional(),
			flags: jsonSchema.optional(),
		}),
	),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function commandWords(command: PluginCommand): string[] {
	return command.name.trim().split(/\s+/);
}

export function describePlugin(plugin: BoathookPlugin): PluginManifest {
	return {
		id: plugin.name,
		version: plugin.version,
		commands: (plugin.commands ?? []).map((command) => {
			const { input, summary, usage } = command;
			const options = { unrepresentable: "any" as const };
			return {
				path: commandWords(command),
				summary,
				usage,
				updatesConfig: Boolean(command.configure),
				args: input?.args && z.toJSONSchema(input.args, options),
				flags: input?.flags && z.toJSONSchema(input.flags, options),
			};
		}),
	};
}
