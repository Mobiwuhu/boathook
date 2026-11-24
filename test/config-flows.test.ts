import { describe, expect, test } from "bun:test";
import { z } from "incur";
import { configInputSchema } from "../packages/core/src/config/session.ts";

const MINIMAL_ENVS = {
	environments: {
		staging: {
			loginUrl: "https://example.com/login",
			userEnvVar: "U",
			passEnvVar: "P",
			successCondition: { urlContains: "/dashboard" },
		},
	},
};

describe("Project config — flows", () => {
	test("accepts config with flows", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				signup: {
					description: "Register a new user",
					variables: ["base_url", "email"],
					steps: [
						{ goto: "{{base_url}}/register" },
						{ fill: { Email: "{{email}}" } },
						{ click: "Submit" },
					],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts flows without optional description and variables", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				simple: {
					steps: [{ goto: "https://example.com" }],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("rejects flow missing steps array", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				broken: {},
			},
		});
		expect(result.success).toBe(false);
		if (result.error) expect(z.prettifyError(result.error)).toContain("broken");
		if (result.error) expect(z.prettifyError(result.error)).toContain("steps");
	});

	test("rejects flow with empty steps array", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				empty: { steps: [] },
			},
		});
		expect(result.success).toBe(false);
		if (result.error) expect(z.prettifyError(result.error)).toContain("empty");
		if (result.error) expect(z.prettifyError(result.error)).toContain("steps");
	});

	test("rejects flow with invalid step shape", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				bad: { steps: [{ badKey: "value" }] },
			},
		});
		expect(result.success).toBe(false);
		if (result.error) expect(z.prettifyError(result.error)).toContain("bad");
		if (result.error) expect(z.prettifyError(result.error)).toContain("step");
	});

	test("accepts all valid step types", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				everything: {
					steps: [
						{ goto: "https://example.com" },
						{ click: "Submit" },
						{ click: { name: "Yes", index: 1 } },
						{ click: { name: "Yes", near: "Selling?" } },
						{ click: { selector: ".btn" } },
						{ fill: { Email: "test@test.com" } },
						{ fill: { Email: { value: "test@test.com", index: 0 } } },
						{ fill: { selector: "input", value: "test" } },
						{ select: { Role: "Admin" } },
						{ select: { Role: { value: "Admin", index: 0 } } },
						{ select: { selector: "#role", value: "Admin" } },
						{ screenshot: true },
						{ screenshot: "/tmp/shot.png" },
						{ console: "error" },
						{ network: true },
						{ wait: { urlContains: "/done" } },
						{ assert: { visible: ".btn" } },
						{ login: "staging" },
						{ snapshot: true },
					],
				},
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("Flow step disambiguation validation", () => {
	// --- click ---
	test("accepts click with name + index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: { name: "Yes", index: 1 } }] },
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts click with name + near", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ click: { name: "Yes", near: "Are you selling?" } }],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts click with selector", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: { selector: ".q2 button" } }] },
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts click with name only (object form)", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: { name: "Submit" } }] },
			},
		});
		expect(result.success).toBe(true);
	});

	test("rejects click with both index and near", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ click: { name: "Yes", index: 1, near: "Question" } }],
				},
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects click with negative index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: { name: "Yes", index: -1 } }] },
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects click with non-integer index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: { name: "Yes", index: 1.5 } }] },
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects click with empty object", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: {} }] },
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects click with selector + name", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ click: { selector: ".btn", name: "Submit" } }],
				},
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects click with wrong type", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ click: 123 }] },
			},
		});
		expect(result.success).toBe(false);
	});

	// --- fill ---
	test("accepts fill with selector + value", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ fill: { selector: "input.email", value: "a@b.com" } }],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts fill with per-field index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ fill: { Email: { value: "a@b.com", index: 1 } } }],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("rejects fill selector without value", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: { steps: [{ fill: { selector: "input" } }] },
			},
		});
		expect(result.success).toBe(false);
	});

	test("rejects fill with per-field negative index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ fill: { Email: { value: "a@b.com", index: -1 } } }],
				},
			},
		});
		expect(result.success).toBe(false);
	});

	// --- select ---
	test("accepts select with selector + value", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ select: { selector: "#country", value: "UK" } }],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("accepts select with per-field index", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				test: {
					steps: [{ select: { Country: { value: "UK", index: 0 } } }],
				},
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("Project config — permissions", () => {
	test("accepts config with permissions", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			permissions: {
				"Create User": {
					page: "{{base_url}}/admin/users/new",
					granted: { visible: "form.create-user" },
					denied: { textContains: "Access denied" },
				},
			},
		});
		expect(result.success).toBe(true);
	});

	test("rejects permission missing page", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			permissions: {
				"Create User": {
					granted: { visible: "form" },
					denied: { textContains: "denied" },
				},
			},
		});
		expect(result.success).toBe(false);
		if (result.error)
			expect(z.prettifyError(result.error)).toContain("Create User");
		if (result.error) expect(z.prettifyError(result.error)).toContain("page");
	});

	test("rejects permission missing granted", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			permissions: {
				"Create User": {
					page: "/admin",
					denied: { textContains: "denied" },
				},
			},
		});
		expect(result.success).toBe(false);
		if (result.error)
			expect(z.prettifyError(result.error)).toContain("Create User");
		if (result.error)
			expect(z.prettifyError(result.error)).toContain("granted");
	});

	test("rejects permission missing denied", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			permissions: {
				"Create User": {
					page: "/admin",
					granted: { visible: "form" },
				},
			},
		});
		expect(result.success).toBe(false);
		if (result.error)
			expect(z.prettifyError(result.error)).toContain("Create User");
		if (result.error) expect(z.prettifyError(result.error)).toContain("denied");
	});

	test("accepts all valid assert conditions in permissions", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			permissions: {
				P1: {
					page: "/p1",
					granted: { visible: ".btn" },
					denied: { notVisible: ".btn" },
				},
				P2: {
					page: "/p2",
					granted: { textContains: "yes" },
					denied: { textNotContains: "yes" },
				},
				P3: {
					page: "/p3",
					granted: { urlContains: "/ok" },
					denied: { urlPattern: "^/denied" },
				},
				P4: {
					page: "/p4",
					granted: { elementText: { selector: "h1", contains: "OK" } },
					denied: { elementCount: { selector: ".err", count: 1 } },
				},
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("Project config — healthcheck", () => {
	test("accepts config with healthcheck", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			healthcheck: {
				pages: [
					{
						url: "{{base_url}}/api/health",
						name: "API Health",
						screenshot: false,
					},
					{ url: "{{base_url}}/dashboard", name: "Dashboard" },
				],
			},
		});
		expect(result.success).toBe(true);
	});

	test("rejects healthcheck with empty pages", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			healthcheck: { pages: [] },
		});
		expect(result.success).toBe(false);
		if (result.error)
			expect(z.prettifyError(result.error)).toContain("healthcheck");
		if (result.error) expect(z.prettifyError(result.error)).toContain("pages");
	});

	test("rejects healthcheck page missing url", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			healthcheck: {
				pages: [{ name: "Missing URL" }],
			},
		});
		expect(result.success).toBe(false);
		if (result.error) expect(z.prettifyError(result.error)).toContain("url");
	});

	test("accepts healthcheck pages with assertions", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			healthcheck: {
				pages: [
					{
						url: "{{base_url}}/health",
						assertions: [{ textContains: "ok" }],
					},
				],
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("Project config — optional settings", () => {
	test("accepts configuration with only login environments", () => {
		const result = configInputSchema.safeParse(MINIMAL_ENVS);
		expect(result.success).toBe(true);
	});

	test("accepts flows, permissions and healthcheck together", () => {
		const result = configInputSchema.safeParse({
			...MINIMAL_ENVS,
			flows: {
				signup: {
					steps: [{ goto: "https://example.com/register" }],
				},
			},
			permissions: {
				"Create User": {
					page: "/admin",
					granted: { visible: "form" },
					denied: { textContains: "denied" },
				},
			},
			healthcheck: {
				pages: [{ url: "{{base_url}}/health" }],
			},
		});
		expect(result.success).toBe(true);
	});
});
