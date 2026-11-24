import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
		const release = join(directory, "boathook-linux-x64");
		const { plugins } = (await Bun.file(
			join(release, "manifest.json"),
		).json()) as {
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
		assert.equal(JSON.parse(await run([binary, "doctor", "--json"])).ok, true);
		const installed = JSON.parse(
			await run([binary, "plugin", "ls", "--json"]),
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
		const config = JSON.stringify({
			plugins: plugins.map(({ id }) => ({ id })),
		});
		await run([binary, "start", "qa", "--config-json", config]);
		try {
			const active = JSON.parse(
				await run([binary, "--session", "qa", "plugin", "ls", "--json"]),
			).data;
			assert.deepEqual(
				active.map(({ id }: { id: string }) => id),
				plugins.map(({ id }) => id),
			);
			await run([binary, "--session", "qa", "snapshot", "-i"]);
		} finally {
			await run([binary, "stop", "qa"]);
		}
		console.log(
			"PASS: installed " +
				archive +
				" and loaded " +
				plugins.length +
				" plugins",
		);
	}
} finally {
	await rm(storage, { recursive: true, force: true });
}
