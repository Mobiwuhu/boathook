import { join } from "node:path";
import { releaseVersion } from "../apps/cli/src/release.ts";

export const npmPackages = ["plugin-sdk", "headers"] as const;
export type NpmReleasePackage = (typeof npmPackages)[number];

export const releaseManifests = [
	"apps/cli/package.json",
	...npmPackages.map((id) => `packages/${id}/package.json`),
];

export function npmArchiveName(id: NpmReleasePackage, version: string): string {
	return `boathook-${id}-${version}.tgz`;
}

export function checkNpmArchive(
	file: string,
	id: NpmReleasePackage,
	version: string,
): void {
	const result = Bun.spawnSync(["tar", "-xOzf", file, "package/package.json"]);
	if (result.exitCode !== 0)
		throw new Error(`Cannot read package.json in ${file}.`);
	const pkg = JSON.parse(result.stdout.toString());
	if (pkg.name !== `@boathook/${id}` || pkg.version !== version || pkg.private)
		throw new Error(
			`${file} must contain public package @boathook/${id}@${version}.`,
		);
}

export async function readReleaseVersion(repo: string): Promise<string> {
	const [cli, ...packages] = await Promise.all(
		releaseManifests.map((path) => Bun.file(join(repo, path)).json()),
	);
	if (typeof cli.version !== "string" || !releaseVersion.test(cli.version))
		throw new Error("CLI version must use MAJOR.MINOR.PATCH.");
	for (const pkg of packages) {
		if (pkg.version !== cli.version)
			throw new Error(
				`${pkg.name} version must match the CLI (${cli.version}).`,
			);
	}
	return cli.version;
}
