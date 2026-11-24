import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleFlow } from "../packages/core/src/commands/flow.ts";
import type { CommandConfig } from "../packages/core/src/config/schema.ts";
import { loadFlowFile } from "../packages/core/src/flows/loader.ts";

const BASE_CONFIG: CommandConfig = {
	environments: {
		staging: {
			loginUrl: "https://example.com/login",
			userEnvVar: "STAGING_USER",
			passEnvVar: "STAGING_PASS",
			successCondition: { urlContains: "/dashboard" },
		},
	},
};

const testRoots = new Set<string>();

function createProject(): {
	root: string;
	config: CommandConfig;
} {
	const root = join(
		tmpdir(),
		`boathook-flow-template-init-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(root, { recursive: true });
	testRoots.add(root);

	return {
		root,
		config: { ...BASE_CONFIG, projectDir: root },
	};
}

afterEach(() => {
	for (const root of testRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	testRoots.clear();
});

describe("handleFlow - flow init", () => {
	test("shows usage and available templates when the template is missing", async () => {
		const { config } = createProject();

		const result = await handleFlow(config, null as any, ["init"]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain(
				"Usage: boathook --session NAME flow init <template> [name] [--force]",
			);
			expect(result.error).toContain("smoke");
			expect(result.error).toContain("login-smoke");
		}
	});

	test("scaffolds a smoke template into flows/ beside the config", async () => {
		const { root, config } = createProject();

		const result = await handleFlow(config, null as any, [
			"init",
			"smoke",
			"checkout-smoke",
		]);

		const flowPath = join(root, "flows", "checkout-smoke.json");
		expect(result.ok).toBe(true);
		expect(existsSync(flowPath)).toBe(true);
		const { flow, error } = loadFlowFile(flowPath);
		expect(error).toBeNull();
		expect(flow?.variables).toEqual(["url", "expected_text"]);
		expect(readFileSync(flowPath, "utf-8")).toContain("{{url}}");
		if (result.ok) {
			expect(result.data).toContain("Created flows/checkout-smoke.json");
		}
	});

	test("refuses to overwrite an existing flow without --force", async () => {
		const { root, config } = createProject();
		const flowsDir = join(root, "flows");
		mkdirSync(flowsDir, { recursive: true });
		writeFileSync(
			join(flowsDir, "smoke.json"),
			JSON.stringify({ steps: [{ goto: "https://old.example.com" }] }, null, 2),
			"utf-8",
		);

		const result = await handleFlow(config, null as any, ["init", "smoke"]);

		expect(result).toEqual({
			ok: false,
			error:
				"flows/smoke.json already exists. Use --force to overwrite the generated flow.",
		});
	});

	test("overwrites an existing flow when --force is provided", async () => {
		const { root, config } = createProject();
		const flowsDir = join(root, "flows");
		mkdirSync(flowsDir, { recursive: true });
		const flowPath = join(flowsDir, "smoke.json");
		writeFileSync(
			flowPath,
			JSON.stringify({ steps: [{ goto: "https://old.example.com" }] }, null, 2),
			"utf-8",
		);

		const result = await handleFlow(config, null as any, [
			"init",
			"smoke",
			"smoke",
			"--force",
		]);

		expect(result.ok).toBe(true);
		expect(readFileSync(flowPath, "utf-8")).toContain('"expected_text"');
	});

	test("returns a helpful error for an unknown template", async () => {
		const { config } = createProject();

		const result = await handleFlow(config, null as any, [
			"init",
			"unknown-template",
		]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain(
				"Unknown flow template 'unknown-template'",
			);
			expect(result.error).toContain("smoke");
			expect(result.error).toContain("login-smoke");
		}
	});

	test("rejects reserved flow names that would shadow subcommands", async () => {
		const { config } = createProject();

		const result = await handleFlow(config, null as any, [
			"init",
			"smoke",
			"list",
		]);

		expect(result).toEqual({
			ok: false,
			error:
				"Invalid flow name 'list'. 'init' and 'list' are reserved for flow subcommands.",
		});
	});
});
