import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "incur";
import { sessionConfigSchema } from "../config/session.ts";
import { readJson } from "../files.ts";
import { stateRoot } from "../paths.ts";

export { readJson, writeRecord } from "../files.ts";

export const sessionSchema = z.object({
	name: z.string(),
	url: z.string().optional(),
	headed: z.boolean(),
	idleTimeout: z.number().int().nonnegative(),
	template: z.string().optional(),
	templateVersion: z.uuid().optional(),
	config: sessionConfigSchema,
});

const processSchema = z.object({
	id: z.string(),
	pid: z.number().int().positive(),
	socketPath: z.string(),
});

export type SessionRecord = z.infer<typeof sessionSchema>;
export type ProcessRecord = z.infer<typeof processSchema>;

export function readSession(path: string) {
	return readJson(path, sessionSchema);
}

export function readProcess(path: string) {
	return readJson(path, processSchema);
}

export async function listDirectories(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		(error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		},
	);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(directory, entry.name));
}

export async function listSessionRecords(): Promise<SessionRecord[]> {
	const directories = await listDirectories(join(stateRoot(), "sessions"));
	const sessions = await Promise.all(
		directories.map((directory) =>
			readSession(join(directory, "session.json")),
		),
	);
	return sessions
		.filter((session) => session !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}
