import {
	installedPlugins,
	installPlugin,
	type PluginManifest,
	pluginInfoCommand,
	sessionRequest,
} from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { parseCommandData, writeResult } from "./output.ts";

export async function requestPluginData(
	session: string,
	cmd: string,
	args: string[] = [],
	timeout?: number,
	tab?: string,
	snapshotId?: string,
): Promise<string> {
	const result = await sessionRequest(session, {
		cmd,
		args,
		json: true,
		timeout,
		tab,
		snapshotId,
	});
	if (!result.ok)
		throw new CommandError(
			result.code ?? "PLUGIN_COMMAND_FAILED",
			result.error,
			result.exitCode ?? 1,
		);
	if (!("data" in result)) throw new Error("插件返回了无效的结果。");
	return result.data;
}

export async function sessionPluginManifests(
	session: string,
	timeout?: number,
) {
	return JSON.parse(
		await requestPluginData(session, pluginInfoCommand, [], timeout),
	) as Array<PluginManifest & { source?: string; entry: string }>;
}

function matchesPath(words: string[], prefix: string[]): boolean {
	return prefix.every((word, index) => word === words[index]);
}

function showHelp(
	plugin: PluginManifest,
	path: string[],
	json: boolean,
	session?: string,
): void {
	const commands = plugin.commands.filter(({ path: words }) =>
		matchesPath(words, path),
	);
	if (path.length && commands.length === 0)
		throw new CommandError(
			"PLUGIN_COMMAND_NOT_FOUND",
			`找不到该子命令，请查看 plugin ${plugin.id} help。`,
		);
	writeResult(
		`plugin ${plugin.id} help`,
		{ ...plugin, commands },
		{
			json,
			session,
			text: commands
				.map(({ usage, summary }) => `${usage}\n  ${summary}`)
				.join("\n"),
		},
	);
}

export async function runPluginCommand({
	session,
	args,
	json,
	timeout,
	tab,
	snapshotId,
	onCommand,
}: {
	session?: string;
	args: string[];
	json: boolean;
	timeout?: number;
	tab?: string;
	snapshotId?: string;
	onCommand?: (command: string) => void;
}): Promise<void> {
	const [id, ...path] = args;
	if (!id || id === "--help" || id === "-h" || id === "help") {
		writeResult(
			"plugin help",
			{ commands: ["ls", "install SOURCE", "ID help", "ID COMMAND"] },
			{
				json,
				text: "boathook plugin ls | install SOURCE | ID help\nboathook --session NAME plugin ls | ID COMMAND",
			},
		);
		return;
	}
	if (id === "install") {
		const [source] = path;
		if (!source || path.length !== 1 || session)
			throw new CommandError(
				"INVALID_ARGUMENTS",
				"请使用 boathook plugin install SOURCE。",
			);
		writeResult("plugin install", await installPlugin(source), { json });
		return;
	}
	const isHelp = (word: string) => word === "--help" || word === "-h";
	const help = !path.length || path[0] === "help" || path.some(isHelp);
	const helpPath =
		path[0] === "help" ? path.slice(1) : path.filter((word) => !isHelp(word));
	if (!session) {
		const installed = await installedPlugins();
		if (id === "ls") {
			writeResult(
				"plugin ls",
				[...installed.values()].map(
					({ commands: _commands, ...plugin }) => plugin,
				),
				{ json },
			);
			return;
		}
		if (help) {
			const plugin = installed.get(id);
			if (!plugin)
				throw new CommandError(
					"PLUGIN_NOT_INSTALLED",
					`找不到插件 ${id}，请安装它或用 --session NAME 查看会话中的插件。`,
				);
			showHelp(
				{ id, version: plugin.version, commands: plugin.commands },
				helpPath,
				json,
			);
			return;
		}
		throw new CommandError(
			"SESSION_REQUIRED",
			"请用 --session NAME 选择要操作的会话。",
		);
	}

	const plugins = await sessionPluginManifests(session, timeout);
	if (id === "ls") {
		writeResult(
			"plugin ls",
			plugins.map(({ commands: _commands, ...plugin }) => plugin),
			{ json, session },
		);
		return;
	}
	const plugin = plugins.find((plugin) => plugin.id === id);
	if (!plugin)
		throw new CommandError(
			"PLUGIN_NOT_ENABLED",
			`会话 ${session} 未启用插件 ${id}。`,
		);
	if (help) {
		showHelp(plugin, helpPath, json, session);
		return;
	}
	const command = plugin.commands
		.filter((command) => matchesPath(path, command.path))
		.sort((a, b) => b.path.length - a.path.length)[0];
	if (!command)
		throw new CommandError(
			"PLUGIN_COMMAND_NOT_FOUND",
			`找不到该子命令，请查看 plugin ${id} help。`,
		);
	const name = ["plugin", id, ...command.path].join(" ");
	onCommand?.(name);
	const result = await requestPluginData(
		session,
		[id, ...command.path].join(":"),
		path.slice(command.path.length),
		timeout,
		tab,
		snapshotId,
	);
	writeResult(name, parseCommandData(result, json), {
		json,
		session,
		text: result,
	});
}
