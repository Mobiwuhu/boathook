export function parseVars(args: string[]): Record<string, string> {
	const vars: Record<string, string> = {};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--var") {
			const next = args[i + 1];
			if (!next) continue;

			const eqIdx = next.indexOf("=");
			if (eqIdx < 0) continue;

			const key = next.slice(0, eqIdx);
			const value = next.slice(eqIdx + 1);
			vars[key] = value;
			i++;
		}
	}

	return vars;
}

export function interpolateVars(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
		return key in vars ? vars[key] : match;
	});
}
