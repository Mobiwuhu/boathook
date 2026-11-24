import { describe, expect, test } from "bun:test";
import {
	formatBatchOutput,
	parseBatchArgs,
} from "../apps/cli/src/cli/batch.ts";
import {
	jsonForInvalidGlobalArgs,
	parseArgs,
} from "../apps/cli/src/cli/parse.ts";

describe("parseArgs", () => {
	test("parses goto command with URL", () => {
		const result = parseArgs(["goto", "https://example.com"]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("treats a bare URL as goto shorthand", () => {
		const result = parseArgs(["--timeout", "60000", "https://example.com"]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: 60000,
			session: undefined,
			json: false,
		});
	});

	test("parses text command with no args", () => {
		const result = parseArgs(["text"]);
		expect(result).toEqual({
			cmd: "text",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses the stop command with a session name", () => {
		const result = parseArgs(["stop", "qa"]);
		expect(result).toEqual({
			cmd: "stop",
			args: ["qa"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("returns help command for empty args", () => {
		const result = parseArgs([]);
		expect(result).toEqual({
			cmd: "help",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("passes through unknown commands (server validates)", () => {
		const result = parseArgs(["unknown"]);
		expect(result).toEqual({
			cmd: "unknown",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses help with no args", () => {
		const result = parseArgs(["help"]);
		expect(result).toEqual({
			cmd: "help",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses help with command arg", () => {
		const result = parseArgs(["help", "goto"]);
		expect(result).toEqual({
			cmd: "help",
			args: ["goto"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses --help flag", () => {
		const result = parseArgs(["--help"]);
		expect(result).toEqual({
			cmd: "--help",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses -h flag", () => {
		const result = parseArgs(["-h"]);
		expect(result).toEqual({
			cmd: "-h",
			args: [],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("parses command with --help flag (interception is in runCli)", () => {
		const result = parseArgs(["goto", "--help"]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["--help"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("extracts --timeout before the command", () => {
		const result = parseArgs([
			"--timeout",
			"60000",
			"goto",
			"https://example.com",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: 60000,
			session: undefined,
			json: false,
		});
	});

	test.each([
		"abc",
		"25bad",
		"-5",
		"0",
		"1.5",
		"2147483648",
	])("rejects invalid timeout %s", (timeout) => {
		expect(() =>
			parseArgs(["--timeout", timeout, "goto", "https://example.com"]),
		).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENTS" }));
	});

	test.each([
		"--timeout",
		"--session",
	])("rejects a missing value for %s", (flag) => {
		expect(() => parseArgs([flag])).toThrow(
			expect.objectContaining({ code: "INVALID_ARGUMENTS" }),
		);
	});

	test("preserves a command's own --timeout", () => {
		const result = parseArgs([
			"plugin",
			"report",
			"export",
			"--timeout",
			"10000",
		]);
		expect(result).toEqual({
			cmd: "plugin",
			args: ["report", "export", "--timeout", "10000"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("preserves multiple non-timeout args", () => {
		const result = parseArgs(["fill", "input.email", "user@test.com"]);
		expect(result).toEqual({
			cmd: "fill",
			args: ["input.email", "user@test.com"],
			timeout: undefined,
			session: undefined,
			json: false,
		});
	});

	test("extracts --session before the command", () => {
		const result = parseArgs([
			"--session",
			"worker-1",
			"goto",
			"https://example.com",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: undefined,
			session: "worker-1",
			json: false,
		});
	});

	test("extracts --json before the command", () => {
		const result = parseArgs(["--json", "snapshot"]);
		expect(result).toEqual({
			cmd: "snapshot",
			args: [],
			timeout: undefined,
			session: undefined,
			json: true,
		});
	});

	test("combines --session, --timeout, and --json", () => {
		const result = parseArgs([
			"--session",
			"s1",
			"--timeout",
			"5000",
			"--json",
			"url",
		]);
		expect(result).toEqual({
			cmd: "url",
			args: [],
			timeout: 5000,
			session: "s1",
			json: true,
		});
	});

	test("parses equals-form global flags for page commands", () => {
		expect(
			parseArgs([
				"--session=qa",
				"--tab=t1",
				"--snapshot-id=s1",
				"--format=json",
				"click",
				"@e1",
			]),
		).toMatchObject({
			cmd: "click",
			args: ["@e1"],
			session: "qa",
			tab: "t1",
			snapshotId: "s1",
			json: true,
		});
	});

	test("duplicate --session flags uses the last value", () => {
		const result = parseArgs([
			"--session",
			"first",
			"--session",
			"second",
			"goto",
			"https://example.com",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: undefined,
			session: "second",
			json: false,
		});
	});

	test("--timeout before command is parsed correctly", () => {
		const result = parseArgs(["--timeout", "5000", "title"]);
		expect(result).toEqual({
			cmd: "title",
			args: [],
			timeout: 5000,
			session: undefined,
			json: false,
		});
	});

	test("--session before command is parsed correctly", () => {
		const result = parseArgs(["--session", "mysession", "url"]);
		expect(result).toEqual({
			cmd: "url",
			args: [],
			timeout: undefined,
			session: "mysession",
			json: false,
		});
	});

	test("--json before command is parsed correctly", () => {
		const result = parseArgs(["--json", "status"]);
		expect(result).toEqual({
			cmd: "status",
			args: [],
			timeout: undefined,
			session: undefined,
			json: true,
		});
	});

	test("all global flags before command", () => {
		const result = parseArgs([
			"--timeout",
			"5000",
			"--session",
			"s1",
			"--json",
			"goto",
			"https://example.com",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: 5000,
			session: "s1",
			json: true,
		});
	});

	test("the host and plugin can both use --format", () => {
		const result = parseArgs([
			"--timeout",
			"3000",
			"--session",
			"plugin",
			"--format",
			"json",
			"plugin",
			"report",
			"export",
			"--format",
			"xml",
		]);
		expect(result).toEqual({
			cmd: "plugin",
			args: ["report", "export", "--format", "xml"],
			timeout: 3000,
			session: "plugin",
			json: true,
		});
	});

	test("honors explicit text output and negated booleans", () => {
		expect(parseArgs(["--json", "--format=text", "help"]).json).toBe(false);
		expect(parseArgs(["--json", "--no-json", "help"]).json).toBe(false);
		expect(parseArgs(["--json=true", "--help"]).json).toBe(true);
	});

	test("only uses leading output flags for errors in global options", () => {
		expect(
			jsonForInvalidGlobalArgs([
				"--timeout",
				"bad",
				"plugin",
				"report",
				"export",
				"--format",
				"json",
			]),
		).toBe(false);
		expect(jsonForInvalidGlobalArgs(["--format=json", "--timeout"])).toBe(true);
		expect(
			jsonForInvalidGlobalArgs(["--json", "--format=text", "--session"]),
		).toBe(false);
		expect(jsonForInvalidGlobalArgs(["--session", "--json", "--timeout"])).toBe(
			false,
		);
	});

	test("preserves the monitor command config path", () => {
		const result = parseArgs([
			"--timeout",
			"8000",
			"monitor",
			"check",
			"--config",
			"/tmp/cfg.json",
		]);
		expect(result).toMatchObject({
			cmd: "monitor",
			args: ["check", "--config", "/tmp/cfg.json"],
			timeout: 8000,
		});
	});
});

describe("parseBatchArgs", () => {
	test("accepts a positional file path and continue-on-error flag", () => {
		expect(parseBatchArgs(["commands.json", "--continue-on-error"])).toEqual({
			filePath: "commands.json",
			continueOnError: true,
		});
	});

	test("accepts --file syntax", () => {
		expect(parseBatchArgs(["--file", "commands.json"])).toEqual({
			filePath: "commands.json",
			continueOnError: false,
		});
	});
});

describe("formatBatchOutput", () => {
	test("formats batch responses and reports failures", () => {
		const formatted = formatBatchOutput({
			ok: true,
			batch: [
				{ cmd: "title", ok: true, data: "Mock Title" },
				{
					cmd: "goto",
					ok: false,
					error: "Usage: boathook --session NAME goto <url>",
				},
			],
			stoppedEarly: true,
		});

		expect(formatted.output).toContain("[PASS] title");
		expect(formatted.output).toContain("[FAIL] goto");
		expect(formatted.output).toContain("Stopped early");
		expect(formatted.isError).toBe(true);
	});
});
