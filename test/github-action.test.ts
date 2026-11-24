import { describe, expect, test } from "bun:test";

const action = await Bun.file(".github/actions/boathook/action.yml").text();

describe("boathook GitHub Action", () => {
	test("builds the boathook checkout", () => {
		expect(action).toContain("using: composite");
		expect(action).toContain("bun install --frozen-lockfile");
		expect(action).toContain("bun run build");
		expect(action).toContain("dist/boathook");
	});

	test("opens and cleans up an isolated session", () => {
		expect(action).toContain("BOATHOOK_STATE_DIR=$(mktemp -d)");
		expect(action).toContain("start qa");
		expect(action).toContain('"--session", "qa", ...args');
		expect(action).toContain("stop qa");
	});
});
