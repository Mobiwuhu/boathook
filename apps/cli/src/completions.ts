import { type CommandDescription, commandFlags } from "./cli/discovery.ts";
import { globalFlags, globalOptionSpecs } from "./cli/options.ts";

const valueFlags = globalOptionSpecs
	.filter(({ takesValue }) => takesValue)
	.map(({ flag }) => flag);

function generateBashCompletions(entries: Map<string, string[]>): string {
	const COMMANDS = [...entries.keys()];
	const cmdList = COMMANDS.join(" ");
	const globalList = globalFlags.join(" ");

	const cases: string[] = [];
	for (const cmd of COMMANDS) {
		const flags = entries.get(cmd) ?? [];
		if (flags.length > 0) {
			cases.push(
				`        ${cmd})\n            COMPREPLY=( $(compgen -W "${flags.join(" ")}" -- "$cur") )\n            ;;`,
			);
		}
	}

	return `# bash completion for boathook
# Add to ~/.bashrc: eval "$(boathook completions bash)"

_boathook_completions() {
    local cur cmd i
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"

    # Find the command (first non-flag argument after 'boathook')
    cmd=""
    for ((i=1; i < COMP_CWORD; i++)); do
        case "\${COMP_WORDS[i]}" in
            ${valueFlags.join("|")})
                ((i++))
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
${cases.join("\n")}
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
		const flags = entries.get(cmd) ?? [];
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
            ${valueFlags.join("|")})
                ((i++))
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
		"function __boathook_command",
		"    set -l tokens (commandline -opc)",
		"    set -l skip_value 0",
		"    for t in $tokens[2..]",
		"        if test $skip_value -eq 1",
		"            set skip_value 0",
		"            continue",
		"        end",
		"        switch $t",
		`            case ${valueFlags.join(" ")}`,
		"                set skip_value 1",
		"            case '-*'",
		"            case '*'",
		"                echo $t",
		"                return 0",
		"        end",
		"    end",
		"    return 1",
		"end",
		"",
		"function __boathook_no_subcommand",
		"    not __boathook_command >/dev/null",
		"end",
		"",
		"function __boathook_has_command",
		"    set -l cmd (__boathook_command)",
		'    test "$cmd" = "$argv[1]"',
		"end",
		"",
	];

	// Command completions (only when no subcommand yet)
	for (const cmd of COMMANDS) {
		lines.push(`complete -c boathook -n __boathook_no_subcommand -a '${cmd}'`);
	}

	lines.push("");

	// Global flags only before the command.
	for (const flag of globalFlags) {
		const name = flag.replace(/^--/, "");
		lines.push(`complete -c boathook -n __boathook_no_subcommand -l '${name}'`);
	}

	lines.push("");

	// Per-command flags
	for (const cmd of COMMANDS) {
		const flags = entries.get(cmd) ?? [];
		for (const flag of flags) {
			if (flag.startsWith("--")) {
				const name = flag.replace(/^--/, "");
				lines.push(
					`complete -c boathook -n '__boathook_has_command ${cmd}' -l '${name}'`,
				);
			} else if (flag.startsWith("-")) {
				const name = flag.replace(/^-/, "");
				lines.push(
					`complete -c boathook -n '__boathook_has_command ${cmd}' -s '${name}'`,
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
