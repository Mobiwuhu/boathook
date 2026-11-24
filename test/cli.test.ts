import { describe, expect, test } from "bun:test";
import {
	formatBatchOutput,
	parseBatchArgs,
} from "../apps/cli/src/cli/batch.ts";
import { parseArgs } from "../apps/cli/src/cli/parse.ts";

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
		const result = parseArgs(["https://example.com", "--timeout", "60000"]);
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

	test("extracts --timeout flag from args", () => {
		const result = parseArgs([
			"goto",
			"https://example.com",
			"--timeout",
			"60000",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: 60000,
			session: undefined,
			json: false,
		});
	});

	test("--timeout flag is removed from args", () => {
		const result = parseArgs([
			"goto",
			"https://example.com",
			"--timeout",
			"5000",
		]);
		if (result && "args" in result) {
			expect(result.args).not.toContain("--timeout");
			expect(result.args).not.toContain("5000");
		}
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
			parseArgs(["goto", "https://example.com", "--timeout", timeout]),
		).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENTS" }));
	});

	test.each([
		"--timeout",
		"--session",
	])("rejects a missing value for %s", (flag) => {
		expect(() => parseArgs(["goto", "https://example.com", flag])).toThrow(
			expect.objectContaining({ code: "INVALID_ARGUMENTS" }),
		);
	});

	test("--timeout in middle of args", () => {
		const result = parseArgs([
			"screenshot",
			"--timeout",
			"10000",
			"/tmp/shot.png",
		]);
		expect(result).toEqual({
			cmd: "screenshot",
			args: ["/tmp/shot.png"],
			timeout: 10000,
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

	test("extracts --session flag from args", () => {
		const result = parseArgs([
			"goto",
			"https://example.com",
			"--session",
			"worker-1",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: undefined,
			session: "worker-1",
			json: false,
		});
	});

	test("extracts --json flag from args", () => {
		const result = parseArgs(["snapshot", "--json"]);
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
			"url",
			"--session",
			"s1",
			"--timeout",
			"5000",
			"--json",
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
				"click",
				"@e1",
				"--tab=t1",
				"--snapshot-id=s1",
				"--format=json",
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
			"goto",
			"https://example.com",
			"--session",
			"first",
			"--session",
			"second",
		]);
		expect(result).toEqual({
			cmd: "goto",
			args: ["https://example.com"],
			timeout: undefined,
			session: "second",
			json: false,
		});
	});

	// Issue #46: Global flags placed before the command name
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

	test("global flags mixed before and after command", () => {
		const result = parseArgs([
			"--timeout",
			"3000",
			"screenshot",
			"--session",
			"s2",
			"/tmp/shot.png",
		]);
		expect(result).toEqual({
			cmd: "screenshot",
			args: ["/tmp/shot.png"],
			timeout: 3000,
			session: "s2",
			json: false,
		});
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
