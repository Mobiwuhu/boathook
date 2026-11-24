import {
	BUILTIN_COMMANDS,
	installedPlugins,
	KNOWN_FLAGS,
} from "@boathook/core";
import type { Cli } from "incur";
import { COMMANDS } from "../help.ts";
import { longFlag } from "./options.ts";
import type { CommandTarget } from "./parse.ts";
import { sessionPluginManifests } from "./plugins.ts";

type Properties = {
	properties?: Record<string, { description?: string }>;
	required?: string[];
};
export type CommandDescription = {
	name: string;
	description: string;
	usage?: string;
	flags?: string[];
	schema?: { args?: Properties; options?: Properties };
};

const controls: CommandDescription[] = [
	{
		name: "batch",
		description: "在同一会话顺序执行一组命令",
		usage: "boathook --session NAME batch FILE [--continue-on-error]",
		flags: ["--file", "--continue-on-error"],
	},
	{
		name: "plugin",
		description: "安装和调用插件",
		usage: "boathook plugin ls | install SOURCE | ID help | ID COMMAND",
	},
	{ name: "plugin ls", description: "列出已安装或会话启用的插件" },
	{
		name: "plugin install",
		description: "安装插件包",
		usage: "boathook plugin install SOURCE",
	},
	{
		name: "completions",
		description: "生成 Shell 补全脚本",
		usage: "boathook completions bash|zsh|fish",
	},
	{
		name: "help",
		description: "查看命令用法",
		usage: "boathook help [COMMAND]",
	},
	{ name: "version", description: "查看版本", usage: "boathook version" },
];

export async function describeCommands(
	program: Pick<Cli.Cli, "serve">,
	target?: CommandTarget,
): Promise<CommandDescription[]> {
	let output = "";
	await program.serve(["--format", "json", "--llms-full"], {
		stdout: (chunk) => {
			output += chunk;
		},
		exit: () => {},
	});
	const product = (JSON.parse(output) as { commands: CommandDescription[] })
		.commands;
	const roots = new Set(product.map(({ name }) => name.split(" ")[0]));
	const pages = [...BUILTIN_COMMANDS]
		.filter((name) => !roots.has(name))
		.map((name) => ({
			name,
			description: COMMANDS[name]?.summary ?? "",
			usage: COMMANDS[name]?.usage,
			flags: KNOWN_FLAGS[name],
		}));
	const plugins = target?.session
		? await sessionPluginManifests(target.session, target.timeout)
		: [...(await installedPlugins()).values()];
	const pluginCommands = plugins.flatMap(({ id, commands }) =>
		commands.map(({ path, summary, usage, args, flags }) => ({
			name: ["plugin", id, ...path].join(" "),
			description: summary,
			usage,
			schema: { args, options: flags },
		})),
	);
	return [...product, ...pages, ...controls, ...pluginCommands].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export function helpFor(
	commands: CommandDescription[],
	cmd: string,
	args: string[],
): { name: string; matches: CommandDescription[] } {
	const words = args.filter((arg) => arg !== "--help" && arg !== "-h");
	if (cmd === "help" || cmd.startsWith("-")) {
		const name = words.join(" ");
		return {
			name,
			matches: commands.filter(
				({ name: path }) =>
					!name || path === name || path.startsWith(`${name} `),
			),
		};
	}
	const invocation = [cmd, ...words].join(" ");
	const declaration = commands
		.filter(
			({ name }) => invocation === name || invocation.startsWith(`${name} `),
		)
		.sort((a, b) => b.name.length - a.name.length)[0];
	return declaration
		? { name: declaration.name, matches: [declaration] }
		: helpFor(commands, "help", [cmd, ...words]);
}

export function commandFlags(command: CommandDescription): string[] {
	return (
		command.flags ??
		Object.keys(command.schema?.options?.properties ?? {})
			.map(longFlag)
			.filter((word) => /^--[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(word))
	);
}

export function commandHelp(command: CommandDescription): string {
	const fields = Object.entries(command.schema?.options?.properties ?? {});
	const args = Object.keys(command.schema?.args?.properties ?? {});
	const usage =
		command.usage ??
		[
			"boathook",
			command.name,
			...args.map((name) =>
				command.schema?.args?.required?.includes(name)
					? `<${name}>`
					: `[${name}]`,
			),
			...(fields.length ? ["[options]"] : []),
		].join(" ");
	return [
		command.description,
		usage,
		...fields.map(
			([name, property]) =>
				`  ${longFlag(name)}  ${property.description ?? ""}`,
		),
	].join("\n");
}
