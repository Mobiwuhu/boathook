import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	checkNpmArchive,
	npmArchiveName,
	npmPackages,
} from "../release-packages.ts";

const archives = process.argv.slice(2);
assert(archives.length > 0, "Usage: bun run test:release RELEASE.tar.gz [...]");
const storage = await mkdtemp(join(tmpdir(), "boathook-release-"));
const env = { ...process.env };
delete env.BOATHOOK_CHROME_EXECUTABLE;
delete env.BOATHOOK_BUN_EXECUTABLE;
delete env.BOATHOOK_SESSION;
env.BOATHOOK_STATE_DIR = join(storage, "state");
env.BOATHOOK_BIN_DIR = join(storage, "bin");
const binary = join(env.BOATHOOK_BIN_DIR, "boathook");
const npmDirectory = process.env.BOATHOOK_SMOKE_NPM_DIR;
const releaseDirectoryName = `boathook-${process.platform}-${process.arch}`;

async function run(args: string[], cwd = storage): Promise<string> {
	const child = Bun.spawn(args, {
		cwd,
		env,
		stdout: "pipe",
		stderr: "inherit",
	});
	const output = await new Response(child.stdout).text();
	assert.equal(await child.exited, 0, `${args.join(" ")}\n${output}`);
	return output;
}

async function checkNpmPackages(
	directory: string,
	version: string,
): Promise<void> {
	for (const id of npmPackages) {
		const file = join(directory, npmArchiveName(id, version));
		checkNpmArchive(file, id, version);
		const entries = (await run(["tar", "-tzf", file])).trim().split("\n");
		assert(entries.includes("package/README.md"), id);
		assert(entries.includes("package/README.zh-CN.md"), id);
	}
	const headers = join(directory, npmArchiveName("headers", version));
	assert.match(
		await run([
			"tar",
			"-xOzf",
			headers,
			"package/dist/licenses/THIRD-PARTY.md",
		]),
		/^# Third-party notices/,
	);
	const { data: installed } = JSON.parse(
		await run([binary, "--json", "plugin", "install", headers]),
	);
	assert.equal(installed.id, "headers");
	assert.equal(installed.version, version);

	const project = join(storage, "sdk-project");
	await mkdir(project);
	await Bun.write(join(project, "package.json"), '{"private":true}');
	await run(
		[
			process.execPath,
			"add",
			"--ignore-scripts",
			join(directory, npmArchiveName("plugin-sdk", version)),
		],
		project,
	);
	await run(
		[
			process.execPath,
			"-e",
			'import { defineCommand } from "@boathook/plugin-sdk"; if (typeof defineCommand !== "function") process.exit(1)',
		],
		project,
	);
	console.log(`PASS: standalone headers and plugin SDK packages at ${version}`);
}

try {
	// Install core first so the optional plugins exercise upgrades in place.
	archives.sort(
		(a, b) =>
			Number(a.endsWith("-with-plugins.tar.gz")) -
			Number(b.endsWith("-with-plugins.tar.gz")),
	);
	for (const [index, archive] of archives.entries()) {
		const directory = join(storage, String(index));
		await mkdir(directory);
		await run(["tar", "-xzf", resolve(archive), "-C", directory]);
		const release = join(directory, releaseDirectoryName);
		const { version, plugins } = (await Bun.file(
			join(release, "manifest.json"),
		).json()) as {
			version: string;
			plugins: Array<{ id: string; version: string; file: string }>;
		};
		const notices = await Bun.file(
			join(release, "licenses", "THIRD-PARTY.md"),
		).text();
		assert.match(notices, /patchright-core@.+Apache-2[.]0/);
		for (const name of ["axe-core", "@axe-core/playwright"]) {
			const entry = notices
				.split("\n")
				.find((line) => line.startsWith(`- \`${name}@`));
			assert.ok(
				entry?.includes("MPL-2.0") && entry.includes("[Corresponding source]("),
				name,
			);
		}
		await run(["bash", "install.sh", "--dry-run"], release);
		await run(["bash", "install.sh"], release);
		const installedRelease = join(env.BOATHOOK_STATE_DIR, "releases", version);
		const runtimeFiles = ["bin/boathook", "bin/bun", "chrome/chrome"];
		const runtimeInodes = await Promise.all(
			runtimeFiles.map(
				async (file) => (await stat(join(installedRelease, file))).ino,
			),
		);
		await run(["bash", "install.sh"], release);
		assert.deepEqual(
			await Promise.all(
				runtimeFiles.map(
					async (file) => (await stat(join(installedRelease, file))).ino,
				),
			),
			runtimeInodes,
			"Reinstalling the same version must reuse the CLI, Bun, and Chrome",
		);
		assert(
			(await run([binary, "--version"])).startsWith(`boathook ${version} (`),
		);
		assert.equal(JSON.parse(await run([binary, "--json", "doctor"])).ok, true);
		const installed = JSON.parse(
			await run([binary, "--json", "plugin", "ls"]),
		).data;
		for (const { id, version, file } of plugins) {
			const notice = await run([
				"tar",
				"-xOzf",
				join(release, file),
				"package/dist/licenses/THIRD-PARTY.md",
			]);
			assert.ok(notice.startsWith("# Third-party notices"));
			assert(
				installed.some(
					(plugin: { id: string; version: string }) =>
						plugin.id === id && plugin.version === version,
				),
				id,
			);
		}
		const selected = plugins.map(({ id }) => ({ id }));
		if (npmDirectory && index === 0) {
			assert.equal(
				installed.length,
				0,
				"The public CLI installs with zero plugins.",
			);
			await checkNpmPackages(resolve(npmDirectory), version);
			selected.push({ id: "headers" });
		}
		const config = JSON.stringify({ plugins: selected });
		await run([binary, "start", "qa", "--config-json", config]);
		try {
			const active = JSON.parse(
				await run([binary, "--json", "--session", "qa", "plugin", "ls"]),
			).data;
			assert.deepEqual(
				active.map(({ id }: { id: string }) => id),
				selected.map(({ id }) => id),
			);
			await run([binary, "--session", "qa", "snapshot", "-i"]);
		} finally {
			await run([binary, "stop", "qa"]);
		}
		console.log(
			"PASS: installed " +
				archive +
				" and loaded " +
				selected.length +
				" plugins",
		);
	}
} finally {
	await rm(storage, { recursive: true, force: true });
}
