import { join } from "node:path";
import { releaseVersion } from "../apps/cli/src/release.ts";
import {
	checkNpmArchive,
	npmArchiveName,
	npmPackages,
} from "./release-packages.ts";

const publicRegistry = "https://registry.npmjs.org/";

export async function publishReleasePackages(
	directory: string,
	version: string,
	{ registry = publicRegistry, checkOnly = false } = {},
): Promise<void> {
	if (!releaseVersion.test(version))
		throw new Error("Invalid release version.");

	const packages = await Promise.all(
		npmPackages.map(async (id) => {
			const file = join(directory, npmArchiveName(id, version));
			checkNpmArchive(file, id, version);
			const name = `@boathook/${id}`;
			const bytes = await Bun.file(file).arrayBuffer();
			const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
			const url = new URL(`${encodeURIComponent(name)}/${version}`, registry);
			const response = await fetch(url, {
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});
			if (response.status === 404) return { file, name, published: false };
			if (!response.ok)
				throw new Error(
					`Cannot check ${name}@${version} on npm (HTTP ${response.status}).`,
				);
			const pkg = await response.json();
			if (pkg.dist?.integrity !== integrity)
				throw new Error(
					`${name}@${version} already has a different tarball on npm.`,
				);
			return { file, name, published: true };
		}),
	);
	if (checkOnly) return;

	for (const { file, name, published } of packages) {
		if (published) {
			console.log(
				`${name}@${version} is already published with the verified tarball.`,
			);
			continue;
		}
		const child = Bun.spawn(
			[
				process.execPath,
				"publish",
				file,
				"--access",
				"public",
				"--registry",
				registry,
				"--ignore-scripts",
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		if ((await child.exited) !== 0)
			throw new Error(
				`Publishing ${name}@${version} failed. Re-run the publish job.`,
			);
	}
}

if (import.meta.main) {
	const [directory, version, option, ...extra] = process.argv.slice(2);
	if (
		!directory ||
		!version ||
		(option && option !== "--check") ||
		extra.length
	)
		throw new Error(
			"Usage: bun scripts/publish-release-packages.ts DIRECTORY VERSION [--check]",
		);
	await publishReleasePackages(directory, version, {
		checkOnly: option === "--check",
	});
}
