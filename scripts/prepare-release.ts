import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseVersion } from "../apps/cli/src/release.ts";
import { readReleaseVersion, releaseManifests } from "./release-packages.ts";

const repo = join(import.meta.dir, "..");
const [type, versionBase, ...extra] = process.argv.slice(2);
if (
	extra.length ||
	!type ||
	!["initial", "patch", "minor", "major"].includes(type) ||
	(versionBase && !releaseVersion.test(versionBase))
)
	throw new Error(
		"Usage: bun scripts/prepare-release.ts initial|patch|minor|major [BASE_VERSION]",
	);

async function run(args: string[], cwd: string): Promise<void> {
	const child = Bun.spawn([process.execPath, ...args], {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0)
		throw new Error(`bun ${args.join(" ")} failed.`);
}

const current = await readReleaseVersion(repo);
if (type !== "initial") {
	const cli = join(repo, "apps/cli");
	if (versionBase && Bun.semver.order(versionBase, current) > 0) {
		await run(["pm", "version", versionBase, "--no-git-tag-version"], cli);
	}
	await run(["pm", "version", type, "--no-git-tag-version"], cli);
	const [cliManifest, ...pluginManifests] = releaseManifests;
	const { version } = await Bun.file(join(repo, cliManifest)).json();
	for (const manifest of pluginManifests) {
		const file = Bun.file(join(repo, manifest));
		const pkg = await file.json();
		await Bun.write(
			file,
			`${JSON.stringify({ ...pkg, version }, null, "\t")}\n`,
		);
	}
	await run(["install", "--lockfile-only", "--ignore-scripts"], repo);
}

const version = await readReleaseVersion(repo);
console.log(`Prepared release v${version}`);
if (process.env.GITHUB_OUTPUT)
	await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
