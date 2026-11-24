import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { handleLogin } from "../packages/core/src/commands/login.ts";
import {
	type CommandConfig,
	TRUST_PROJECT_CONFIG_ENV,
} from "../packages/core/src/config/schema.ts";

const VALID_CONFIG: CommandConfig = {
	environments: {
		staging: {
			loginUrl: "https://staging.example.com/login",
			userEnvVar: "BOATHOOK_STAGING_USER",
			passEnvVar: "BOATHOOK_STAGING_PASS",
			submitButton: "Sign in",
			successCondition: { urlContains: "/dashboard" },
		},
		production: {
			loginUrl: "https://app.example.com/login",
			userEnvVar: "BOATHOOK_PROD_USER",
			passEnvVar: "BOATHOOK_PROD_PASS",
			successCondition: { elementVisible: ".user-menu" },
		},
	},
};

function mockPage(overrides: Record<string, unknown> = {}) {
	return {
		goto: mock(() => Promise.resolve()),
		url: mock(() => "https://staging.example.com/dashboard"),
		title: mock(() => Promise.resolve("Dashboard")),
		locator: mock(() => ({
			ariaSnapshot: mock(() =>
				Promise.resolve(
					'- textbox "Username"\n- textbox "Password"\n- button "Sign in"',
				),
			),
		})),
		getByRole: mock((_role: string, _opts: { name: string }) => ({
			fill: mock(() => Promise.resolve()),
			click: mock(() => Promise.resolve()),
			nth: mock(() => ({
				fill: mock(() => Promise.resolve()),
				click: mock(() => Promise.resolve()),
			})),
		})),
		getByLabel: mock(() => ({ or: (locator: unknown) => locator })),
		waitForURL: mock(() => Promise.resolve()),
		waitForSelector: mock(() => Promise.resolve()),
		screenshot: mock(() => Promise.resolve()),
		...overrides,
	} as never;
}

describe("login command", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env[TRUST_PROJECT_CONFIG_ENV] = "1";
		process.env.BOATHOOK_STAGING_USER = "testuser";
		process.env.BOATHOOK_STAGING_PASS = "testpass";
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	test("returns error when no config is loaded", async () => {
		const res = await handleLogin(null, mockPage(), ["--env", "staging"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("session configuration");
		}
	});

	test("returns error when --env flag is missing", async () => {
		const res = await handleLogin(VALID_CONFIG, mockPage(), []);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("--env");
		}
	});

	test("returns error when --env has no value", async () => {
		const res = await handleLogin(VALID_CONFIG, mockPage(), ["--env"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("--env");
		}
	});

	test("returns error for unknown environment", async () => {
		const res = await handleLogin(VALID_CONFIG, mockPage(), ["--env", "test"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("test");
			expect(res.error).toContain("staging");
			expect(res.error).toContain("production");
		}
	});

	test("shows '(none)' when no environments are configured", async () => {
		const emptyConfig: CommandConfig = { environments: {} };
		const res = await handleLogin(emptyConfig, mockPage(), [
			"--env",
			"nonexistent",
		]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("(none)");
			expect(res.error).not.toEndWith("Available: .");
		}
	});

	test("returns error when credentials env vars are missing", async () => {
		delete process.env.BOATHOOK_STAGING_USER;
		delete process.env.BOATHOOK_STAGING_PASS;

		const res = await handleLogin(VALID_CONFIG, mockPage(), [
			"--env",
			"staging",
		]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("BOATHOOK_STAGING_USER");
			expect(res.error).toContain("BOATHOOK_STAGING_PASS");
		}
	});

	test("blocks credentials from untrusted config context", async () => {
		const page = mockPage();

		delete process.env[TRUST_PROJECT_CONFIG_ENV];
		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain(TRUST_PROJECT_CONFIG_ENV);
		}
		expect(page.goto).not.toHaveBeenCalled();
	});

	test("navigates to login URL and fills credentials", async () => {
		const page = mockPage();

		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.data).toContain("Logged in to staging");
		}

		expect(page.goto).toHaveBeenCalledWith(
			"https://staging.example.com/login",
			expect.objectContaining({ waitUntil: "domcontentloaded" }),
		);
	});

	test("returns success with current URL on login", async () => {
		const page = mockPage({
			url: mock(() => "https://staging.example.com/dashboard"),
		});

		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.data).toContain("https://staging.example.com/dashboard");
		}
	});

	test("returns error with screenshot path when page.goto fails", async () => {
		const page = mockPage({
			goto: mock(() => Promise.reject(new Error("Navigation timeout"))),
			screenshot: mock(() => Promise.resolve()),
		});

		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("Login failed: Navigation timeout.");
			expect(res.error).toContain("/screenshots/login-failure-");
		}
	});

	test("returns error without screenshot info when screenshot also fails", async () => {
		const page = mockPage({
			goto: mock(() => Promise.reject(new Error("Connection refused"))),
			screenshot: mock(() => Promise.reject(new Error("Page crashed"))),
		});

		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe("Login failed: Connection refused.");
			expect(res.error).not.toContain("Screenshot");
		}
	});

	test("returns error when fillField cannot find the field", async () => {
		// getByRole returns a locator whose fill always rejects, simulating a missing field
		const page = mockPage({
			getByRole: mock(() => ({
				fill: mock(() => Promise.reject(new Error("Element not found"))),
				click: mock(() => Promise.reject(new Error("Element not found"))),
			})),
			screenshot: mock(() => Promise.resolve()),
		});

		const res = await handleLogin(VALID_CONFIG, page, ["--env", "staging"]);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("Login failed");
			expect(res.error).toContain("Could not find input field");
		}
	});
});
