import { CommandError, type NetworkRule } from "@boathook/plugin-sdk";
import { RegExpParser, visitRegExpAST } from "@eslint-community/regexpp";

export type HeaderScope = "all" | { hosts: string[]; hostRegex: string[] };

const resourceTypes: NetworkRule["condition"]["resourceTypes"] = [
	"main_frame",
	"sub_frame",
	"stylesheet",
	"script",
	"image",
	"font",
	"object",
	"xmlhttprequest",
	"ping",
	"csp_report",
	"media",
	"websocket",
	"webtransport",
	"webbundle",
	"other",
];
const protocol = "(?:https?|wss?)://(?:[^/?#@]*@)?";
const suffix = "\\.?(?::[0-9]+)?/";
const hostnameCharacters = "abcdefghijklmnopqrstuvwxyz0123456789._-";
const hostnameClass = "[a-z0-9._-]";
const regexParser = new RegExpParser();

function hostnameFilter(pattern: string): string {
	const replacements: { start: number; end: number; source: string }[] = [];
	// A word boundary excludes a terminal DNS dot from the matched hostname.
	const end = `\\b${suffix}.*$`;
	const unsupported = () =>
		new CommandError(
			"HEADER_REGEX_UNSUPPORTED",
			`域名正则 ${pattern} 无法转换为 Chrome 支持的匹配条件。请修改正则或使用 --host。`,
		);
	function restrict(node: { start: number; end: number; raw: string }) {
		const atom = new RegExp(`^(?:${node.raw})$`);
		const allowed = Array.from(hostnameCharacters).filter((char) =>
			atom.test(char),
		);
		const source =
			allowed.length === 0
				? "(?:$.)"
				: allowed.length === hostnameCharacters.length
					? hostnameClass
					: `[${allowed.join("")}]`;
		replacements.push({ start: node.start, end: node.end, source });
	}
	visitRegExpAST(regexParser.parsePattern(pattern), {
		onAssertionEnter(node) {
			if (node.kind === "word") return;
			if (node.kind !== "start" && node.kind !== "end") throw unsupported();
			replacements.push({
				start: node.start,
				end: node.end,
				source: node.kind === "start" ? `^${protocol}` : end,
			});
		},
		onBackreferenceEnter() {
			throw unsupported();
		},
		onModifiersEnter() {
			throw unsupported();
		},
		onCharacterClassEnter: restrict,
		onCharacterSetEnter(node) {
			if (node.parent.type !== "CharacterClass") restrict(node);
		},
		onCharacterEnter(node) {
			if (
				node.parent.type === "Alternative" ||
				node.parent.type === "Quantifier"
			)
				restrict(node);
		},
	});
	let source = pattern;
	for (const { start, end, source: replacement } of replacements.reverse()) {
		source = source.slice(0, start) + replacement + source.slice(end);
	}
	// The optional URL boundaries are consumed either here or at an anchor in the user pattern.
	return `^(?:${protocol}${hostnameClass}*)?(?:${source})(?:${hostnameClass}*${end})?$`;
}

export function compileHeaderRules(
	set: Record<string, string>,
	scope: HeaderScope,
): NetworkRule[] {
	const requestHeaders = Object.entries(set).map(([header, value]) => ({
		header,
		value,
		operation: "set" as const,
	}));
	if (requestHeaders.length === 0) return [];
	const action = { type: "modifyHeaders" as const, requestHeaders };
	if (scope === "all") return [{ condition: { resourceTypes }, action }];
	const filters = [
		...scope.hosts.map((host) => `^${protocol}${RegExp.escape(host)}${suffix}`),
		...scope.hostRegex.map(hostnameFilter),
	];
	return filters.map((regexFilter) => ({
		condition: { resourceTypes, regexFilter, isUrlFilterCaseSensitive: true },
		action,
	}));
}
