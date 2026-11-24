import { describe, expect, test } from "bun:test";
import { parseArgs } from "../apps/cli/src/cli/parse.ts";
import { formatVersion } from "../apps/cli/src/version.ts";

describe("formatVersion", () => {
	test("includes version from package.json", async () => {
		const pkg = await import("../apps/cli/package.json");
		const output = formatVersion();
		expect(output).toContain(`boathook ${pkg.default.version}`);
	});

	test("includes platform and architecture", () => {
		const output = formatVersion();
		// Format: boathook X.Y.Z (os-arch)
		expect(output).toMatch(/\(.+-.+\)$/);
	});

	test("matches expected format exactly", () => {
		const output = formatVersion();
		expect(output).toMatch(/^boathook \d+\.\d+\.\d+ \(\w+-\w+\)$/);
	});
});

describe("version in CLI", () => {
	test("parseArgs handles 'version' command", () => {
		const result = parseArgs(["version"]);
		expect(result).toEqual({
			cmd: "version",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parseArgs handles '--version' flag", () => {
		const result = parseArgs(["--version"]);
		expect(result).toEqual({
			cmd: "--version",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});
});
