import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import { copyLoginProfile, copyProfile } from "../browser/profile.ts";
import {
	loginSchema as checkSchema,
	type LoginCheck,
} from "../config/session.ts";
import { ensurePrivateDirectory } from "../files.ts";
import { stateRoot } from "../paths.ts";
import { withPathLock } from "./lock.ts";
import { namedId } from "./paths.ts";
import { listDirectories, readJson, writeRecord } from "./store.ts";

const currentSchema = z.object({ version: z.uuid() });
const templateSchema = currentSchema.extend({
	name: z.string(),
	url: z.string().optional(),
	state: z.enum(["unchecked", "ready"]),
	savedAt: z.string(),
});
const loginSchema = z.object({
	loginSession: z.string(),
	url: z.string(),
	check: checkSchema.optional(),
});
type Template = z.infer<typeof templateSchema>;

function templateDir(name: string): string {
	return join(stateRoot(), "templates", namedId(name));
}

async function withTemplateLock<T>(
	name: string,
	run: (dir: string) => Promise<T>,
): Promise<T> {
	const dir = templateDir(name);
	for (const path of [stateRoot(), dirname(dir), dir])
		ensurePrivateDirectory(path);
	return withPathLock(dir, join(dir, "lock"), () => run(dir));
}

async function readCurrent(dir: string): Promise<Template | null> {
	const current = await readJson(join(dir, "current.json"), currentSchema);
	return current
		? readJson(
				join(dir, "versions", current.version, "template.json"),
				templateSchema,
			)
		: null;
}

export function getTemplate(name: string): Promise<Template | null> {
	return readCurrent(templateDir(name));
}

export async function listTemplates(): Promise<Template[]> {
	const directories = await listDirectories(join(stateRoot(), "templates"));
	const templates = await Promise.all(directories.map(readCurrent));
	return templates
		.filter((template) => template !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveTemplate(
	name: string,
	profilePath: string,
): Promise<Template> {
	return withTemplateLock(name, async (dir) => {
		const template = await readCurrent(dir);
		if (!template)
			throw new CommandError(
				"TEMPLATE_NOT_FOUND",
				"找不到模板，请先保存登录模板。",
			);
		await copyProfile(
			join(dir, "versions", template.version, "profile"),
			profilePath,
		);
		return template;
	});
}

export function saveProfileTemplate(
	name: string,
	source: string | { directory: string },
	url: string | undefined,
	replace: boolean,
	verify?: (profile: string) => Promise<void>,
): Promise<Template> {
	return withTemplateLock(name, async (dir) => {
		if (!replace && (await readCurrent(dir))) {
			throw new CommandError(
				"TEMPLATE_EXISTS",
				"模板已存在。续登时请显式传入 --replace。",
			);
		}
		const version = randomUUID();
		const versionDir = ensurePrivateDirectory(join(dir, "versions", version));
		const record: Template = {
			name,
			version,
			url,
			state: verify ? "ready" : "unchecked",
			savedAt: new Date().toISOString(),
		};
		try {
			const snapshot = join(versionDir, "profile");
			if (typeof source === "string") await copyProfile(source, snapshot);
			else await copyLoginProfile(source.directory, snapshot);
			await verify?.(snapshot);
			await writeRecord(join(versionDir, "template.json"), record);
			await writeRecord(join(dir, "current.json"), { version });
		} catch (error) {
			await rm(versionDir, { recursive: true, force: true });
			throw error;
		}
		return record;
	});
}

export function getLogin(name: string) {
	return readJson(join(templateDir(name), "login.json"), loginSchema);
}

export function beginLogin(
	name: string,
	url: string,
	replace: boolean,
	check?: LoginCheck,
) {
	return withTemplateLock(name, async (dir) => {
		if ((await readCurrent(dir)) && !replace) {
			throw new CommandError(
				"TEMPLATE_EXISTS",
				"模板已存在。续登时请显式传入 --replace。",
			);
		}
		const previous = await getLogin(name);
		if (previous) {
			if (previous.url !== url)
				throw new CommandError(
					"LOGIN_IN_PROGRESS",
					"已有登录任务，请先取消再更改入口。",
				);
			return { ...previous, created: false };
		}
		const login = {
			loginSession: `login-${name.slice(0, 40)}-${randomUUID().slice(0, 8)}`,
			url,
			check,
		};
		await writeRecord(join(dir, "login.json"), login);
		return { ...login, created: true };
	});
}

export function removeTemplate(name: string): Promise<void> {
	return withTemplateLock(name, async (dir) => {
		if (!(await readCurrent(dir)))
			throw new CommandError(
				"TEMPLATE_NOT_FOUND",
				"找不到要删除的模板，请先查看 template ls。",
			);
		await rm(join(dir, "current.json"));
		await rm(join(dir, "versions"), { recursive: true, force: true });
	});
}

export function forgetLogin(name: string, loginSession: string): Promise<void> {
	return withTemplateLock(name, async (dir) => {
		if ((await getLogin(name))?.loginSession === loginSession) {
			await rm(join(dir, "login.json"), { force: true });
		}
	});
}
