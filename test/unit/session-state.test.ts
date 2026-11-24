import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRecord } from "../../packages/core/src/files.ts";
import { planNavigation } from "../../packages/core/src/session/navigation.ts";
import { readTabSnapshot } from "../../packages/core/src/session/tab-state.ts";

let directory: string;
let stateFile: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "boathook-tabs-"));
	stateFile = join(directory, "tabs.json");
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

test("restores the saved tabs and active tab for a session", async () => {
	const tabs = [
		{ id: "t-a", url: "https://example.com" },
		{ id: "t-b", url: "https://example.test" },
	];
	await writeRecord(stateFile, { version: 1, tabs, activeTabIndex: 1 });
	const plan = planNavigation(stateFile, undefined, false);
	expect(plan.tabs).toEqual(tabs);
	expect(plan.activeTabIndex).toBe(1);
});

test("backs up corrupt tab state before using the session entry URL", () => {
	writeFileSync(stateFile, "{invalid");
	expect(readTabSnapshot(stateFile)).toBeNull();
	expect(
		readdirSync(directory).some((name) =>
			name.startsWith("tabs.json.corrupt-"),
		),
	).toBe(true);
	const plan = planNavigation(stateFile, "https://example.com", false);
	expect(plan.tabs).toEqual([{ url: "https://example.com" }]);
});
