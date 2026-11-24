import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCI } from "../apps/cli/src/cli/ci-init.ts";

const workflowPath = ".github/workflows/boathook-qa.yml";

let project: string;
beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "boathook-ci-"));
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
});

test("generates a GitHub Actions workflow in a clean project", async () => {
	const path = join(project, workflowPath);
	expect((await initCI({}, project)).path).toBe(path);
	const config = await Bun.file(path).text();
	expect(config).toContain("on: [push, pull_request]");
	expect(config).toContain("uses: actions/checkout@v4");
	expect(config).toContain('curl -fLsS "$BOATHOOK_RELEASE_URL"');
	expect(config).toContain("boathook-linux-x64/install.sh");
	expect(config).toContain("boathook start qa --url");
	expect(config).toContain("boathook --session qa snapshot -i");
	expect(config).toContain('boathook" stop qa');
});

test("replaces an existing workflow only with force", async () => {
	const { path } = await initCI({}, project);
	const originalWorkflow = await Bun.file(path).text();
	const customWorkflow = "name: Custom QA\n";
	await Bun.write(path, customWorkflow);
	await expect(initCI({}, project)).rejects.toMatchObject({
		code: "CI_FILE_EXISTS",
	});
	expect(await Bun.file(path).text()).toBe(customWorkflow);
	expect((await initCI({ force: true }, project)).path).toBe(path);
	expect(await Bun.file(path).text()).toBe(originalWorkflow);
});
