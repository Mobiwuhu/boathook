import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	configInputSchema,
	parseConfigJson,
	resolveConfig,
	sessionConfigSchema,
} from "../packages/core/src/config/session.ts";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "boathook-config-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("session configuration", () => {
	test("rejects malformed JSON", () => {
		expect(() => parseConfigJson("invalid JSON")).toThrow(
			"请输入有效的配置 JSON",
		);
	});
	test("reports the invalid field", () => {
		expect(() =>
			parseConfigJson(
				JSON.stringify({ artifacts: { retention: { traces: "later" } } }),
			),
		).toThrow("artifacts.retention.traces");
	});

	test("allows a project to omit command settings", () => {
		expect(configInputSchema.parse({})).toEqual({ plugins: [] });
	});

	test("preserves validated settings in the session snapshot", async () => {
		const commands = {
			environments: {
				staging: {
					loginUrl: "https://example.test/login",
					userEnvVar: "STAGING_USER",
					passEnvVar: "STAGING_PASS",
					successCondition: { urlPattern: "^https://example.test/dashboard$" },
				},
			},
			flows: { smoke: { steps: [{ goto: "https://example.test" }] } },
			permissions: {
				reports: {
					page: "https://example.test/reports",
					granted: { visible: "main" },
					denied: { textContains: "Denied" },
				},
			},
			healthcheck: {
				pages: [{ url: "https://example.test/status", console: "error" }],
			},
			artifacts: {
				retention: {
					default: "7d",
					screenshots: "2d",
					traces: "14d",
					videos: "30d",
				},
			},
			timeout: 2500,
		};
		const config = await resolveConfig(
			parseConfigJson(
				JSON.stringify({
					...commands,
					login: { check: "./verify.ts" },
					browser: {
						proxy: { server: "http://127.0.0.1:9876", enabled: false },
					},
				}),
			),
			root,
		);
		expect(
			sessionConfigSchema.parse(JSON.parse(JSON.stringify(config))),
		).toMatchObject({
			projectDir: root,
			commands,
			login: { check: join(root, "verify.ts") },
			proxy: { server: "http://127.0.0.1:9876", enabled: false },
		});
	});

	test.each([
		{ browser: "firefox" },
		{ proxy: { server: "http://127.0.0.1:9876" } },
		{ playwright: { launchOptions: { executablePath: "./fake-browser" } } },
	])("rejects fields outside the project schema: %j", (config) => {
		expect(configInputSchema.safeParse(config).success).toBe(false);
	});
});
