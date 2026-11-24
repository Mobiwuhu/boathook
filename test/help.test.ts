import { expect, test } from "bun:test";
import { BUILTIN_COMMANDS } from "@boathook/core";
import { COMMANDS } from "../apps/cli/src/help.ts";

test("each daemon command has its own help entry", () => {
	// The product command catalog supplies status help through Incur.
	const pageCommands = [...BUILTIN_COMMANDS].filter(
		(name) => name !== "status",
	);
	expect(Object.keys(COMMANDS).sort()).toEqual(pageCommands.sort());
	for (const { summary, usage } of Object.values(COMMANDS)) {
		expect(summary.length).toBeGreaterThan(0);
		expect(usage.length).toBeGreaterThan(0);
	}
});
