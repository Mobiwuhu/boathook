import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { handleTestMatrix } from "../packages/core/src/commands/test-matrix.ts";
import {
	type CommandConfig,
	TRUST_PROJECT_CONFIG_ENV,
} from "../packages/core/src/config/schema.ts";
import { CustomReporterRegistry } from "../packages/core/src/flows/custom-reporter.ts";

const TEST_USER_ENV = "BOATHOOK_TEST_MATRIX_USER";
const TEST_PASS_ENV = "BOATHOOK_TEST_MATRIX_PASS";

const BASE_CONFIG: CommandConfig = {
	environments: {
		admin: {
			loginUrl: "https://example.com/login",
			userEnvVar: TEST_USER_ENV,
			passEnvVar: TEST_PASS_ENV,
			successCondition: { urlContains: "/dashboard" },
		},
		viewer: {
			loginUrl: "https://example.com/login",
			userEnvVar: TEST_USER_ENV,
			passEnvVar: TEST_PASS_ENV,
			successCondition: { urlContains: "/dashboard" },
		},
	},
	flows: {
		smoke: {
			description: "Smoke test",
			steps: [{ goto: "https://example.com/app" }],
		},
	},
};

function createMockRolePage() {
	return {
		goto: mock(async () => null),
		getByRole: mock(() => ({
			fill: mock(async () => {}),
			click: mock(async () => {}),
			first: () => ({
				isVisible: mock(async () => true),
				innerText: mock(async () => ""),
			}),
			count: mock(async () => 1),
		})),
		getByLabel: mock(() => ({ or: (locator: unknown) => locator })),
		waitForURL: mock(async () => null),
		url: mock(() => "https://example.com/dashboard"),
		on: mock(() => {}),
		title: mock(async () => "Dashboard"),
		evaluate: mock(async () => null),
		innerText: mock(async () => ""),
		locator: mock(() => ({
			first: () => ({
				isVisible: mock(async () => true),
				innerText: mock(async () => ""),
			}),
			count: mock(async () => 1),
			innerText: mock(async () => ""),
		})),
	} as any;
}

function createDefaultContext() {
	const browser = {
		newContext: mock(async () => {
			const page = createMockRolePage();
			return {
				newPage: mock(async () => page),
				close: mock(async () => {}),
			};
		}),
	};

	return {
		browser: () => browser,
	} as any;
}

describe("handleTestMatrix reporter support", () => {
	const trust = process.env[TRUST_PROJECT_CONFIG_ENV];
	beforeEach(() => {
		process.env[TRUST_PROJECT_CONFIG_ENV] = "1";
	});
	afterEach(() => {
		if (trust === undefined) delete process.env[TRUST_PROJECT_CONFIG_ENV];
		else process.env[TRUST_PROJECT_CONFIG_ENV] = trust;
	});
	test("rejects invalid reporter names", async () => {
		const result = await handleTestMatrix(
			BASE_CONFIG,

			["--roles", "admin,viewer", "--flow", "smoke", "--reporter", "csv"],

			createDefaultContext(),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Invalid reporter 'csv'");
			expect(result.error).toContain("tap");
			expect(result.error).toContain("allure");
			expect(result.error).toContain("html");
		}
	});

	test("returns TAP output with --reporter tap", async () => {
		const previousUser = process.env[TEST_USER_ENV];
		const previousPass = process.env[TEST_PASS_ENV];
		process.env[TEST_USER_ENV] = "user";
		process.env[TEST_PASS_ENV] = "pass";

		try {
			const result = await handleTestMatrix(
				BASE_CONFIG,

				["--roles", "admin,viewer", "--flow", "smoke", "--reporter", "tap"],

				createDefaultContext(),
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toContain("TAP version 13");
				expect(result.data).toContain("1..2");
				expect(result.data).toContain("[admin] goto https://example.com/app");
				expect(result.data).toContain("[viewer] goto https://example.com/app");
			}
		} finally {
			if (previousUser === undefined) {
				delete process.env[TEST_USER_ENV];
			} else {
				process.env[TEST_USER_ENV] = previousUser;
			}

			if (previousPass === undefined) {
				delete process.env[TEST_PASS_ENV];
			} else {
				process.env[TEST_PASS_ENV] = previousPass;
			}
		}
	});

	test("returns JUnit output with suite properties from --junit-property", async () => {
		const previousUser = process.env[TEST_USER_ENV];
		const previousPass = process.env[TEST_PASS_ENV];
		process.env[TEST_USER_ENV] = "user";
		process.env[TEST_PASS_ENV] = "pass";

		try {
			const result = await handleTestMatrix(
				BASE_CONFIG,

				[
					"--roles",
					"admin,viewer",
					"--flow",
					"smoke",
					"--reporter",
					"junit",
					"--junit-property",
					"environment=ci",
					"--junit-property",
					"browser=chrome",
				],

				createDefaultContext(),
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toContain(
					'<property name="environment" value="ci"/>',
				);
				expect(result.data).toContain(
					'<property name="browser" value="chrome"/>',
				);
			}
		} finally {
			if (previousUser === undefined) {
				delete process.env[TEST_USER_ENV];
			} else {
				process.env[TEST_USER_ENV] = previousUser;
			}

			if (previousPass === undefined) {
				delete process.env[TEST_PASS_ENV];
			} else {
				process.env[TEST_PASS_ENV] = previousPass;
			}
		}
	});

	test("returns plugin reporter output with a registered custom reporter", async () => {
		const previousUser = process.env[TEST_USER_ENV];
		const previousPass = process.env[TEST_PASS_ENV];
		process.env[TEST_USER_ENV] = "user";
		process.env[TEST_PASS_ENV] = "pass";
		const reporters = new CustomReporterRegistry();
		reporters.register({
			name: "teamcity",
			render: ({ flowName, results }) =>
				`teamcity:${flowName}:${results.length}`,
		});

		try {
			const result = await handleTestMatrix(
				BASE_CONFIG,

				[
					"--roles",
					"admin,viewer",
					"--flow",
					"smoke",
					"--reporter",
					"teamcity",
				],

				createDefaultContext(),
				{ customReporters: reporters },
			);

			expect(result).toEqual({
				ok: true,
				data: "teamcity:test-matrix-smoke:2",
			});
		} finally {
			if (previousUser === undefined) {
				delete process.env[TEST_USER_ENV];
			} else {
				process.env[TEST_USER_ENV] = previousUser;
			}

			if (previousPass === undefined) {
				delete process.env[TEST_PASS_ENV];
			} else {
				process.env[TEST_PASS_ENV] = previousPass;
			}
		}
	});
});
