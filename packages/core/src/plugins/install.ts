import { mkdtemp, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";
import parsePackageArg from "npm-package-arg";
import { ensurePrivateDirectory, readJson, writeRecord } from "../files.ts";
import { stateRoot } from "../paths.ts";
import { bunCliEnv } from "../runtime.ts";
import { pluginDirectory, recordInstalledPlugin } from "./catalog.ts";
import { describePlugin } from "./manifest.ts";
import { importProductPlugin } from "./modules.ts";

const dependenciesSchema = z.object({
	dependencies: z.record(z.string(), z.string()),
});

function isRegistryPackage(source: string): boolean {
	if (source.startsWith("-")) return false;
	try {
		const { type } = parsePackageArg(source);
		return type === "tag" || type === "version" || type === "range";
	} catch {
		return false;
	}
}

function runBun(args: string[], cwd: string): Promise<number> {
	return Bun.spawn([process.execPath, ...args], {
		cwd,
		env: bunCliEnv(),
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	}).exited;
}

export async function installPlugin(source: string) {
	let packDirectory = false;
	const local =
		isAbsolute(source) || source.startsWith("./") || source.startsWith("../");
	if (local) {
		source = resolve(source);
		const directory = await stat(source).catch(() => null);
		packDirectory = directory?.isDirectory() ?? false;
		if (!packDirectory && !(directory?.isFile() && source.endsWith(".tgz")))
			throw new CommandError(
				"INVALID_PLUGIN_SOURCE",
				"请指定插件目录或 .tgz 包。",
			);
	} else if (!isRegistryPackage(source)) {
		throw new CommandError(
			"INVALID_PLUGIN_SOURCE",
			"请提供本地插件包或 npm 包名，可附版本。",
		);
	}
	ensurePrivateDirectory(stateRoot());
	const root = ensurePrivateDirectory(pluginDirectory());
	const packages = ensurePrivateDirectory(join(root, "packages"));
	const directory = await mkdtemp(join(packages, "pkg-"));
	try {
		const manifest = join(directory, "package.json");
		await writeRecord(manifest, { private: true });
		let input = source;
		if (packDirectory) {
			const filename = "plugin.tgz";
			const packed = await runBun(
				[
					"pm",
					"pack",
					"--ignore-scripts",
					"--filename",
					join(directory, filename),
				],
				source,
			);
			if (packed !== 0)
				throw new CommandError(
					"PLUGIN_PACK_FAILED",
					"Bun 打包本地插件失败，请检查包的 package.json 和入口。",
					1,
				);
			input = `./${filename}`;
		}
		if (
			(await runBun(
				["add", "--ignore-scripts", "--exact", input],
				directory,
			)) !== 0
		)
			throw new CommandError(
				"PLUGIN_INSTALL_FAILED",
				"Bun 安装插件失败，请检查包名、registry 权限和网络后重试。",
				1,
			);
		const resolved = await readJson(manifest, dependenciesSchema);
		const [packageName] = Object.keys(resolved?.dependencies ?? {});
		if (!packageName)
			throw new CommandError(
				"PLUGIN_INSTALL_FAILED",
				"未找到已安装包，请检查 package.json。",
				1,
			);
		const entry = Bun.resolveSync(packageName, directory);
		const { commands, ...identity } = describePlugin(
			await importProductPlugin(entry),
		);
		const receipt = { ...identity, source, entry };
		await recordInstalledPlugin({ ...receipt, commands });
		return receipt;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}
