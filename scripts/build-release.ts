import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { importProductPlugin } from "@boathook/core";
import { githubRepository } from "../apps/cli/src/release.ts";
import { writeBundleLicenses } from "./release-licenses.ts";
import {
	npmArchiveName,
	npmPackages,
	readReleaseVersion,
} from "./release-packages.ts";

const repo = join(import.meta.dir, "..");
const output = join(repo, "dist");
const version = await readReleaseVersion(repo);
const repository =
	process.env.BOATHOOK_RELEASE_REPO ?? process.env.GITHUB_REPOSITORY;
if (repository && !githubRepository.test(repository)) {
	throw new Error("请为发行包指定有效的 GitHub OWNER/REPO。");
}
const chromeVersion = "153.0.8010.12";
const chromeBuilds = {
	"linux-x64": {
		platform: "linux64",
		sha256: "8aac35011c18f6e2d10696154af89a5728ac2ddd6dc6fad24ffdf243c3fcfd5a",
	},
	"darwin-arm64": {
		platform: "mac-arm64",
		sha256: "930e2a2c15addbaca1fe9b07bfa520667bced556d7988707186819cb4279ef3b",
	},
	"darwin-x64": {
		platform: "mac-x64",
		sha256: "4e12e2b8a297a2eb79c16258e46961c73f8aa2fa6be6b1d3cdbb553fb5d4ef1c",
	},
};
const releasePlatform = `${process.platform}-${process.arch}`;
const releaseDirectoryName = `boathook-${releasePlatform}`;
const chromeBuild = chromeBuilds[releasePlatform as keyof typeof chromeBuilds];
if (!chromeBuild) {
	throw new Error(`此平台暂不提供 boathook 发行包：${releasePlatform}。`);
}
const chromeDirectory = `chrome-${chromeBuild.platform}`;
const chrome = {
	version: chromeVersion,
	url: `https://storage.googleapis.com/chrome-for-testing-public/${chromeVersion}/${chromeBuild.platform}/${chromeDirectory}.zip`,
	sha256: chromeBuild.sha256,
	directory: chromeDirectory,
};
const executables = ["bin/boathook", "bin/bun", "install.sh"];
type PackagedPlugin = { id: string; version: string; file: string };

async function run(args: string[], cwd = repo): Promise<void> {
	const child = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" });
	if ((await child.exited) !== 0)
		throw new Error(`${args[0]} 执行失败，请检查构建输出。`);
}

async function checksum(directory: string, file: string): Promise<string> {
	const digest = new Bun.CryptoHasher("sha256")
		.update(await Bun.file(join(directory, file)).arrayBuffer())
		.digest("hex");
	return `${digest}  ${file}`;
}

async function buildPlugin(
	source: string,
	packageName: string,
	scratch: string,
) {
	const metafile = join(scratch, "plugin-build.json");
	await run(
		[process.execPath, "run", "build", `--metafile=${metafile}`],
		source,
	);
	const entry = Bun.resolveSync(packageName, source);
	const plugin = await importProductPlugin(entry);
	const licenses = join(dirname(entry), "licenses");
	await rm(licenses, { recursive: true, force: true });
	await writeBundleLicenses(licenses, { cwd: source, metafile });
	await copyFile(join(repo, "LICENSE"), join(licenses, "MIT.txt"));
	return plugin;
}

async function pack(source: string, file: string): Promise<void> {
	await run(
		[process.execPath, "pm", "pack", "--ignore-scripts", "--filename", file],
		source,
	);
}

async function packagePlugins(
	directory: string,
	scratch: string,
): Promise<PackagedPlugin[]> {
	const plugins: PackagedPlugin[] = [];
	const paths = await Array.fromAsync(
		new Bun.Glob("packages/*/package.json").scan(repo),
	);
	for (const manifest of paths.sort()) {
		const { name: packageName, keywords } = await Bun.file(
			join(repo, manifest),
		).json();
		if (!keywords?.includes("boathook-plugin")) continue;
		const source = join(repo, dirname(manifest));
		const { name: id, version } = await buildPlugin(
			source,
			packageName,
			scratch,
		);
		const file = `plugins/${id}-${encodeURIComponent(version)}.tgz`;
		await mkdir(join(directory, "plugins"), { recursive: true });
		await pack(source, join(directory, file));
		plugins.push({ id, version, file });
	}
	return plugins;
}

async function packageNpmReleases(scratch: string): Promise<void> {
	const directory = join(output, "npm");
	await mkdir(directory, { recursive: true });
	for (const id of npmPackages) {
		const source = join(repo, "packages", id);
		if (id === "headers") {
			const plugin = await buildPlugin(source, "@boathook/headers", scratch);
			if (plugin.name !== id || plugin.version !== version)
				throw new Error(`The headers plugin must report version ${version}.`);
		}
		await pack(source, join(directory, npmArchiveName(id, version)));
	}
}

async function writeArchive(
	scratch: string,
	directory: string,
	coreFiles: string[],
	plugins: PackagedPlugin[],
): Promise<void> {
	const files = [
		...coreFiles,
		"core-checksums.txt",
		...plugins.map(({ file }) => file),
	];
	await Bun.write(
		join(directory, "manifest.json"),
		JSON.stringify(
			{
				version,
				platform: releasePlatform,
				repository,
				bun: Bun.version,
				chrome,
				files,
				plugins,
			},
			null,
			2,
		),
	);
	const checksums = await Promise.all(
		[...files, "manifest.json"].map((file) => checksum(directory, file)),
	);
	await Bun.write(
		join(directory, "checksums.txt"),
		[...checksums, ""].join("\n"),
	);
	const suffix = plugins.length > 0 ? "-with-plugins" : "";
	const archive = join(
		output,
		`${releaseDirectoryName}-${version}${suffix}.tar.gz`,
	);
	await run(["tar", "-czf", archive, "-C", scratch, releaseDirectoryName]);
	console.log(archive);
}

const bunVersion = (await Bun.file(join(repo, ".bun-version")).text()).trim();
if (Bun.version !== bunVersion)
	throw new Error(`请使用 Bun ${bunVersion} 构建发行包。`);
const flags = process.argv.slice(2);
if (
	flags.some((flag) => flag !== "--with-plugins" && flag !== "--npm-packages")
)
	throw new Error("用法为 bun run release [--with-plugins] [--npm-packages]。");

await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(output, ".release-"));
try {
	const metafile = join(scratch, "cli-build.json");
	await run([process.execPath, "run", "build", `--metafile=${metafile}`]);
	const binary = join(output, "boathook");
	if (process.platform === "darwin")
		await run(["codesign", "-s", "-", "-f", binary]);
	const directory = join(scratch, releaseDirectoryName);
	const licenses = join(directory, "licenses");
	await mkdir(join(directory, "bin"), { recursive: true });
	await mkdir(join(directory, "scripts"));
	const licenseFiles = await writeBundleLicenses(licenses, {
		cwd: join(repo, "apps/cli"),
		metafile,
	});
	await Promise.all([
		copyFile(binary, join(directory, "bin/boathook")),
		copyFile(process.execPath, join(directory, "bin/bun")),
		copyFile(join(repo, "install.sh"), join(directory, "install.sh")),
		copyFile(
			join(repo, "scripts/install-entry.sh"),
			join(directory, "scripts/install-entry.sh"),
		),
		copyFile(join(repo, "LICENSE"), join(licenses, "MIT.txt")),
	]);
	const license = await fetch(
		`https://raw.githubusercontent.com/oven-sh/bun/bun-v${Bun.version}/LICENSE.md`,
		{ signal: AbortSignal.timeout(10_000) },
	);
	if (!license.ok)
		throw new Error("无法下载本版 Bun 的许可证，请检查网络后重试。");
	await Bun.write(join(licenses, "Bun.txt"), license);
	for (const file of executables) await chmod(join(directory, file), 0o755);
	const coreFiles = [
		...executables,
		"scripts/install-entry.sh",
		...["MIT.txt", "Bun.txt", ...licenseFiles].map((path) =>
			join("licenses", path),
		),
	];
	const checksums = await Promise.all(
		coreFiles.map((file) => checksum(directory, file)),
	);
	await Bun.write(
		join(directory, "core-checksums.txt"),
		[...checksums, ""].join("\n"),
	);
	await writeArchive(scratch, directory, coreFiles, []);
	if (flags.includes("--npm-packages")) await packageNpmReleases(scratch);
	if (flags.includes("--with-plugins")) {
		await writeArchive(
			scratch,
			directory,
			coreFiles,
			await packagePlugins(directory, scratch),
		);
	}
} finally {
	await rm(scratch, { recursive: true, force: true });
}
