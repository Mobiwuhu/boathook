import {
	type CommandDescription,
	commandFlags,
	globalFlags,
} from "./cli/discovery.ts";

function generateBashCompletions(entries: Map<string, string[]>): string {
	const COMMANDS = [...entries.keys()];
	const cmdList = COMMANDS.join(" ");
	const globalList = globalFlags.join(" ");

	const cases: string[] = [];
	for (const cmd of COMMANDS) {
		const flags = [...(entries.get(cmd) ?? []), ...globalFlags];
		if (flags.length > 0) {
			cases.push(
				`        ${cmd})\n            COMPREPLY=( $(compgen -W "${flags.join(" ")}" -- "$cur") )`,
			);
		}
	}

	return `# bash completion for boathook
# Add to ~/.bashrc: eval "$(boathook completions bash)"

_boathook_completions() {
    local cur prev cmd
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Find the command (first non-flag argument after 'boathook')
    cmd=""
    for ((i=1; i < COMP_CWORD; i++)); do
        case "\${COMP_WORDS[i]}" in
            ${globalFlags.filter((flag) => flag !== "--json").join("|")})
                ((i++))
                ;;
            --json)
                ;;
            -*)
                ;;
            *)
                cmd="\${COMP_WORDS[i]}"
                break
                ;;
        esac
    done

    # Complete command names if no command found yet
    if [[ -z "$cmd" ]]; then
        if [[ "$cur" == -* ]]; then
            COMPREPLY=( $(compgen -W "${globalList}" -- "$cur") )
        else
            COMPREPLY=( $(compgen -W "${cmdList}" -- "$cur") )
        fi
        return 0
    fi

    # Complete flags for the matched command
    if [[ "$cur" == -* ]]; then
        case "$cmd" in
${cases.join("\n            ;;\n")}
            ;;
            *)
                COMPREPLY=( $(compgen -W "${globalList}" -- "$cur") )
                ;;
        esac
    fi

    return 0
}

complete -F _boathook_completions boathook
`;
}

function generateZshCompletions(entries: Map<string, string[]>): string {
	const COMMANDS = [...entries.keys()];
	const cmdDescriptions: string[] = [];
	for (const cmd of COMMANDS) {
		// Escape colons in command names for zsh
		const escaped = cmd.replace(/:/g, "\\:");
		cmdDescriptions.push(`        '${escaped}'`);
	}

	const flagCases: string[] = [];
	for (const cmd of COMMANDS) {
		const flags = [...(entries.get(cmd) ?? []), ...globalFlags];
		if (flags.length > 0) {
			const flagArgs = flags.map((f) => `'${f}'`).join(" ");
			flagCases.push(
				`        ${cmd})\n            _arguments ${flagArgs} && return 0\n            ;;`,
			);
		}
	}

	return `#compdef boathook
# zsh completion for boathook
# Add to ~/.zshrc: eval "$(boathook completions zsh)"

_boathook() {
    local -a commands
    commands=(
${cmdDescriptions.join("\n")}
    )

    local cmd=""
    local i
    for ((i=2; i < CURRENT; i++)); do
        case "\${words[i]}" in
            ${globalFlags.filter((flag) => flag !== "--json").join("|")})
                ((i++))
                ;;
            --json)
                ;;
            -*)
                ;;
            *)
                cmd="\${words[i]}"
                break
                ;;
        esac
    done

    if [[ -z "$cmd" ]]; then
        if [[ "\${words[CURRENT]}" == -* ]]; then
            compadd -- ${globalFlags.join(" ")}
        else
            compadd -- ${COMMANDS.join(" ")}
        fi
        return 0
    fi

    # Complete flags for the command
    case "$cmd" in
${flagCases.join("\n")}
        *)
            compadd -- ${globalFlags.join(" ")}
            ;;
    esac
}

_boathook "$@"
`;
}

function generateFishCompletions(entries: Map<string, string[]>): string {
	const COMMANDS = [...entries.keys()];
	const lines: string[] = [
		"# fish completion for boathook",
		"# Add to fish config: boathook completions fish | source",
		"",
		"# Disable file completions by default",
		"complete -c boathook -f",
		"",
		"# Helper: returns true when no subcommand has been given yet",
		"function __boathook_no_subcommand",
		`    set -l cmds ${COMMANDS.join(" ")}`,
		"    set -l tokens (commandline -opc)",
		"    for t in $tokens[2..]",
		"        if contains -- $t $cmds",
		"            return 1",
		"        end",
		"    end",
		"    return 0",
		"end",
		"",
	];

	// Command completions (only when no subcommand yet)
	for (const cmd of COMMANDS) {
		lines.push(`complete -c boathook -n __boathook_no_subcommand -a '${cmd}'`);
	}

	lines.push("");

	// Global flags (available everywhere)
	for (const flag of globalFlags) {
		const name = flag.replace(/^--/, "");
		lines.push(`complete -c boathook -l '${name}'`);
	}

	lines.push("");

	// Per-command flags
	for (const cmd of COMMANDS) {
		const flags = entries.get(cmd) ?? [];
		for (const flag of flags) {
			// Skip flags already covered by globals
			if (globalFlags.includes(flag)) continue;
			if (flag.startsWith("--")) {
				const name = flag.replace(/^--/, "");
				lines.push(
					`complete -c boathook -n '__fish_seen_subcommand_from ${cmd}' -l '${name}'`,
				);
			} else if (flag.startsWith("-")) {
				const name = flag.replace(/^-/, "");
				lines.push(
					`complete -c boathook -n '__fish_seen_subcommand_from ${cmd}' -s '${name}'`,
				);
			}
		}
	}

	lines.push("");
	return lines.join("\n");
}

export function generateCompletions(
	shell: string,
	commands: CommandDescription[],
): string | null {
	const entries = new Map<string, string[]>();
	for (const command of commands) {
		const root = command.name.split(" ")[0];
		if (root)
			entries.set(root, [
				...new Set([...(entries.get(root) ?? []), ...commandFlags(command)]),
			]);
	}
	switch (shell) {
		case "bash":
			return generateBashCompletions(entries);
		case "zsh":
			return generateZshCompletions(entries);
		case "fish":
			return generateFishCompletions(entries);
		default:
			return null;
	}
}
