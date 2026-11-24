import { mkdtemp, readlink, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import pkg from "../../package.json";
import {
	githubRepository,
	releaseArchiveName,
	releaseDirectoryName,
	releasePlatform,
	releaseVersion,
} from "../release.ts";

export const upgradeOptions = z.strictObject({
	check: z.boolean().optional().describe("只查看是否有新版"),
	repo: z
		.string()
		.regex(githubRepository)
		.optional()
		.describe("GitHub 发布仓库，格式为 OWNER/REPO"),
	archive: z.string().min(1).optional().describe("使用本地发行包"),
});

type UpgradeResult = {
	state: "current" | "available" | "upgraded";
	fromVersion: string;
	toVersion: string;
	repository?: string;
	entry?: string;
};

const manifestSchema = z.object({
	version: z.string().regex(releaseVersion),
	platform: z.literal(releasePlatform),
	repository: z.string().regex(githubRepository).optional(),
});
const githubReleaseSchema = z.object({
	tag_name: z.string(),
	assets: z.array(z.object({ name: z.string(), digest: z.string().nullish() })),
});

async function installedEntry() {
	const binDir = process.env.BOATHOOK_BIN_DIR;
	const entry = binDir
		? join(resolve(binDir), "boathook")
		: (Bun.which("boathook") ?? join(homedir(), ".local/bin/boathook"));
	const current = await readlink(entry).catch(() => "");
	const store = /^(\/.*)\/releases\/(?:[0-9.]+|source)\/bin\/boathook$/.exec(
		current,
	)?.[1];
	if (!store) return undefined;
	const binary = await realpath(entry).catch(() => undefined);
	if (binary !== (await realpath(process.execPath))) return undefined;
	return { store, directory: dirname(dirname(current)), entry, current };
}

async function readManifest(directory: string) {
	const file = Bun.file(join(directory, "manifest.json"));
	const manifest = manifestSchema.safeParse(
		await file.json().catch(() => undefined),
	);
	if (!manifest.success) {
		throw new CommandError(
			"RELEASE_INVALID",
			"发行清单无效，请检查 boathook 发行包。",
		);
	}
	return manifest.data;
}

export async function githubRelease(
	repo: string,
	request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
	const response = await request(
		`https://api.github.com/repos/${repo}/releases/latest`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "boathook",
			},
			signal: AbortSignal.timeout(10_000),
		},
	).catch(() => undefined);
	if (!response?.ok) {
		const status = response ? ` (HTTP ${response.status})` : "";
		throw new CommandError(
			"RELEASE_LOOKUP_FAILED",
			`无法查询 ${repo} 的最新发行版${status}，请检查仓库和网络。`,
			1,
		);
	}
	const payload = githubReleaseSchema.safeParse(
		await response.json().catch(() => undefined),
	);
	const version = payload.success ? payload.data.tag_name.slice(1) : "";
	if (
		!payload.success ||
		!payload.data.tag_name.startsWith("v") ||
		!releaseVersion.test(version)
	) {
		throw new CommandError(
			"RELEASE_INVALID",
			"GitHub 发行标签必须使用 vMAJOR.MINOR.PATCH 格式。",
		);
	}
	return {
		repo,
		tag: payload.data.tag_name,
		version,
		assets: payload.data.assets,
	};
}

export function remoteArchive(
	release: Awaited<ReturnType<typeof githubRelease>>,
) {
	const name = releaseArchiveName(release.version);
	const digest = release.assets.find((asset) => asset.name === name)?.digest;
	if (!digest || !/^sha256:[a-f\d]{64}$/i.test(digest)) {
		throw new CommandError(
			"RELEASE_ASSET_MISSING",
			`发行版 ${release.tag} 缺少 ${name} 或其 SHA-256 校验值。`,
		);
	}
	return {
		url: `https://github.com/${release.repo}/releases/download/${release.tag}/${name}`,
		checksum: digest.slice(7).toLowerCase(),
	};
}

async function downloadArchive(
	archive: ReturnType<typeof remoteArchive>,
	path: string,
) {
	try {
		const response = await fetch(archive.url, {
			signal: AbortSignal.timeout(180_000),
		});
		if (!response.ok || !response.body)
			throw new Error(`HTTP ${response.status}`);
		await Bun.write(path, response);
	} catch {
		throw new CommandError(
			"RELEASE_DOWNLOAD_FAILED",
			"下载发行包失败，请检查网络后重试。",
			1,
		);
	}
	const hash = new Bun.CryptoHasher("sha256");
	for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
	if (hash.digest("hex") !== archive.checksum) {
		throw new CommandError(
			"RELEASE_CHECKSUM_MISMATCH",
			"发行包的 SHA-256 校验失败，请重新下载。",
			1,
		);
	}
}

async function runReleaseStep(args: string[], code: string, env = process.env) {
	const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
	const [status, output, errors] = await Promise.all([
		child.exited,
		child.stdout.text(),
		child.stderr.text(),
	]);
	if (status !== 0) {
		throw new CommandError(
			code,
			errors.trim() || output.trim() || "发行包处理失败。",
			1,
		);
	}
}

function isNewer(version: string): boolean {
	return Bun.semver.order(version, pkg.version) > 0;
}

export async function upgrade(
	options: z.infer<typeof upgradeOptions>,
): Promise<UpgradeResult> {
	if (options.archive && options.repo) {
		throw new CommandError("INVALID_OPTIONS", "请只选择 --archive 或 --repo。");
	}
	if (`${process.platform}-${process.arch}` !== releasePlatform) {
		throw new CommandError(
			"UPGRADE_UNSUPPORTED_PLATFORM",
			"boathook 发行包目前适用于 Linux x86_64。",
		);
	}
	const install = await installedEntry();
	let release: Awaited<ReturnType<typeof githubRelease>> | undefined;
	let archive: ReturnType<typeof remoteArchive> | undefined;
	if (!options.archive) {
		const saved =
			install && (await readManifest(install.directory).catch(() => undefined));
		const repo =
			options.repo ?? process.env.BOATHOOK_RELEASE_REPO ?? saved?.repository;
		if (!repo || !githubRepository.test(repo)) {
			throw new CommandError(
				"RELEASE_REPOSITORY_REQUIRED",
				"请用 --repo OWNER/REPO 指定 GitHub 发布仓库，或用 --archive 选择本地发行包。",
			);
		}
		release = await githubRelease(repo);
		const info = {
			fromVersion: pkg.version,
			toVersion: release.version,
			repository: repo,
		};
		if (!isNewer(release.version)) return { state: "current", ...info };
		archive = remoteArchive(release);
		if (options.check) return { state: "available", ...info };
	}

	if (!options.check && !install) {
		throw new CommandError(
			"UPGRADE_INSTALL_NOT_FOUND",
			"请从已安装的 boathook 命令运行升级。自定义安装目录请设置 BOATHOOK_BIN_DIR。",
		);
	}
	const scratch = await mkdtemp(join(tmpdir(), "boathook-upgrade-"));
	try {
		const file = options.archive
			? resolve(options.archive)
			: join(scratch, "release.tar.gz");
		if (archive) await downloadArchive(archive, file);
		await runReleaseStep(
			[
				"tar",
				"-xzf",
				file,
				"-C",
				scratch,
				"--no-same-owner",
				"--no-same-permissions",
			],
			"RELEASE_EXTRACT_FAILED",
		);
		const directory = join(scratch, releaseDirectoryName);
		const manifest = await readManifest(directory);
		if (release && release.version !== manifest.version) {
			throw new CommandError(
				"RELEASE_INVALID",
				"发行清单的版本与 GitHub 标签不一致。",
			);
		}
		const info = {
			fromVersion: pkg.version,
			toVersion: manifest.version,
			repository: release?.repo ?? manifest.repository,
		};
		if (!isNewer(manifest.version)) return { state: "current", ...info };
		if (options.check || !install) return { state: "available", ...info };
		await runReleaseStep(
			["bash", join(directory, "install.sh")],
			"UPGRADE_INSTALL_FAILED",
			{
				...process.env,
				BOATHOOK_STATE_DIR: install.store,
				BOATHOOK_BIN_DIR: dirname(install.entry),
				BOATHOOK_EXPECTED_ENTRY: install.current,
			},
		);
		return { state: "upgraded", ...info, entry: install.entry };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
