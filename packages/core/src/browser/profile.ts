import { cp, lstat, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import { readJson, writeRecord } from "../files.ts";

const defaultProfile = "Default";
const localStateFile = "Local State";
const excluded = new Set([
	"Cache",
	"Code Cache",
	"GPUCache",
	"DevToolsActivePort",
]);

// Import the same login entries as pw-pool (44e1811, lib/profile.js).
const loginFiles = [
	"Preferences",
	"Cookies",
	"Cookies-journal",
	"Network/Cookies",
	"Network/Cookies-journal",
	"Network/TransportSecurity",
	"Network/Trust Tokens",
	"Login Data",
	"Login Data-journal",
	"Login Data For Account",
	"Login Data For Account-journal",
	"Web Data",
	"Web Data-journal",
	"Local Storage",
	"IndexedDB",
	"Storage",
	"Extension Cookies",
];
const loginPaths = [
	localStateFile,
	...loginFiles.map((file) => join(defaultProfile, file)),
];

const chromeLocalStateSchema = z.looseObject({
	profile: z
		.looseObject({ info_cache: z.record(z.string(), z.unknown()).optional() })
		.optional(),
});

function isLoginPath(path: string): boolean {
	return (
		path === "" ||
		loginPaths.some(
			(entry) =>
				path === entry ||
				path.startsWith(entry + sep) ||
				entry.startsWith(path + sep),
		)
	);
}

export async function copyProfile(
	source: string,
	target: string,
	include?: (relativePath: string) => boolean,
): Promise<void> {
	const temporary = await mkdtemp(join(dirname(target), ".profile-"));
	try {
		await cp(source, temporary, {
			recursive: true,
			filter: async (path) => {
				if (include && !include(relative(source, path))) return false;
				const name = basename(path);
				if (excluded.has(name) || name.startsWith("Singleton")) return false;
				const file = await lstat(path);
				return file.isDirectory() || file.isFile();
			},
		});
		await rename(temporary, target);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export async function copyLoginProfile(
	directory: string,
	target: string,
): Promise<void> {
	const source = await realpath(directory).catch(() => {
		throw new CommandError(
			"PROFILE_UNREADABLE",
			"无法读取 --from 的目录，请检查路径和权限。",
		);
	});
	const profile = await lstat(join(source, defaultProfile)).catch((error) => {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
		throw new CommandError(
			"PROFILE_UNREADABLE",
			`无法读取 ${defaultProfile}/，请检查目录权限。`,
		);
	});
	if (!profile?.isDirectory()) {
		throw new CommandError(
			"INVALID_PROFILE",
			`请让 --from 指向包含 ${defaultProfile}/ 的 Chrome 用户数据目录。`,
		);
	}
	await copyProfile(source, target, isLoginPath);

	const statePath = join(target, localStateFile);
	const localState = await readJson(statePath, chromeLocalStateSchema).catch(
		() => {
			throw new CommandError(
				"INVALID_PROFILE",
				`无法读取 Chrome 的 ${localStateFile}，请检查用户数据目录副本。`,
			);
		},
	);
	if (!localState) return;
	// Chrome may have last opened a profile outside the login file selection.
	const info = localState.profile?.info_cache?.[defaultProfile];
	await writeRecord(statePath, {
		...localState,
		profile: {
			...localState.profile,
			last_used: defaultProfile,
			last_active_profiles: [defaultProfile],
			profiles_order: [defaultProfile],
			info_cache: info === undefined ? {} : { [defaultProfile]: info },
		},
	});
}
