import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

type Bundle = {
	cwd: string;
	metafile: string;
};

type BundledPackage = {
	name: string;
	version: string;
	license: string;
};

type Metafile = {
	outputs: Record<string, { inputs: Record<string, unknown> }>;
};

const mplSources = new Map([
	[
		"axe-core@4.11.1",
		"https://github.com/dequelabs/axe-core/archive/fbd2f40d36ff954bbf670f5bb14ecaae455d228b.tar.gz",
	],
	[
		"@axe-core/playwright@4.11.1",
		"https://github.com/dequelabs/axe-core-npm/archive/66a3106a704e1d446f23cb151f96363425f42d02.tar.gz",
	],
]);
const patchrightPackages = new Set([
	"patchright@1.58.2",
	"patchright-core@1.58.2",
]);
const licenseName = /^(?:licen[cs]e|copying)(?:[.-]|$)/i;
const noticeName = /^(?:notice|third[-_ ]?party[-_ ]?notices?)(?:[.-]|$)/i;

async function bundledPackageDirectories(bundle: Bundle): Promise<string[]> {
	const { outputs } = (await Bun.file(bundle.metafile).json()) as Metafile;
	const directories = new Set<string>();
	const marker = "/node_modules/";
	for (const { inputs } of Object.values(outputs)) {
		for (const input of Object.keys(inputs)) {
			const path = resolve(bundle.cwd, input);
			const index = path.lastIndexOf(marker);
			if (index < 0) continue;
			const base = path.slice(0, index + marker.length);
			const [name, scopedName] = path.slice(base.length).split("/");
			directories.add(
				name.startsWith("@") ? join(base, name, scopedName) : join(base, name),
			);
		}
	}
	return [...directories].sort();
}

export async function writeBundleLicenses(
	directory: string,
	bundle: Bundle,
): Promise<string[]> {
	await mkdir(directory, { recursive: true });
	const files = ["THIRD-PARTY.md"];
	const entries = new Map<string, string>();
	for (const packageDir of await bundledPackageDirectories(bundle)) {
		const pkg = (await Bun.file(
			join(packageDir, "package.json"),
		).json()) as BundledPackage;
		const id = `${pkg.name}@${pkg.version}`;
		if (entries.has(id)) continue;
		const source = mplSources.get(id);
		if (!pkg.license || (pkg.license.includes("MPL-2.0") && !source)) {
			throw new Error(`请核对 ${id} 的发行许可和对应源码。`);
		}
		const names = (await readdir(packageDir))
			.filter((name) => licenseName.test(name) || noticeName.test(name))
			.sort();
		const documents = names.map((name) => ({
			name,
			path: join(packageDir, name),
		}));
		if (id === "imurmurhash@0.1.4") {
			// This release includes its MIT notice in the README.
			documents.push({
				name: "README.md",
				path: join(packageDir, "README.md"),
			});
		} else if (patchrightPackages.has(id)) {
			// These packages ship third-party notices. Add the Playwright 1.58.2 license and notice.
			for (const name of ["LICENSE.txt", "NOTICE.txt"]) {
				documents.push({
					name,
					path: join(import.meta.dir, "license-files", name),
				});
			}
		} else if (!names.some((name) => licenseName.test(name))) {
			throw new Error(`找不到 ${id} 的许可证文件。`);
		}

		const folder = join("dependencies", id.replace("/", "+"));
		await mkdir(join(directory, folder), { recursive: true });
		const links = [];
		for (const { name, path } of documents) {
			const destination = join(folder, name);
			await copyFile(path, join(directory, destination));
			files.push(destination);
			links.push(`[${name}](${destination})`);
		}
		if (source) links.push(`[Corresponding source](${source})`);
		const change =
			id === "patchright-core@1.58.2"
				? " boathook modifies `lib/server/utils/nodePlatform.js` for standalone executables."
				: "";
		entries.set(
			id,
			`- \`${id}\` (${pkg.license}).${change} ${links.join(" · ")}`,
		);
	}

	await Bun.write(
		join(directory, "THIRD-PARTY.md"),
		`# Third-party notices\n\n${[...entries.values()].sort().join("\n")}\n`,
	);
	return files.sort();
}
