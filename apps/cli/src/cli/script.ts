import { resolve } from "node:path";
import { sessionRequest } from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { Parser, z } from "incur";
import { writeResult } from "./output.ts";

async function readInput(input?: string, inputJson?: string): Promise<string> {
	if (input !== undefined && inputJson !== undefined) {
		throw new CommandError(
			"INVALID_INPUT",
			"请只选择 --input 或 --input-json。",
		);
	}
	let value = inputJson;
	if (input !== undefined) {
		value =
			input === "-"
				? await Bun.stdin.text()
				: await Bun.file(resolve(input)).text();
	}
	if (value === undefined) return "";
	try {
		JSON.parse(value);
		return value;
	} catch {
		throw new CommandError("INVALID_INPUT", "请输入有效的 JSON。");
	}
}

export const scriptArguments = z.object({
	file: z.string().describe("脚本路径"),
});
export const scriptOptions = z.object({
	inputJson: z.string().optional().describe("直接传入 JSON"),
	input: z.string().optional().describe("JSON 文件路径，- 代表标准输入"),
});

async function scriptPayload(
	file: string,
	args: string[],
	options: z.infer<typeof scriptOptions>,
): Promise<string[]> {
	return [
		resolve(file),
		await readInput(options.input, options.inputJson),
		...args,
	];
}

export async function parseScriptArgs(argv: string[]): Promise<string[]> {
	const separator = argv.indexOf("--");
	const input = separator < 0 ? argv : argv.slice(0, separator);
	const parsed = Parser.parse(input, {
		args: scriptArguments,
		options: scriptOptions,
	});
	return scriptPayload(
		parsed.args.file,
		separator < 0 ? [] : argv.slice(separator + 1),
		parsed.options,
	);
}
export async function runProjectScript(options: {
	session: string;
	file: string;
	args: string[];
	json: boolean;
	timeout?: number;
	tab?: string;
	snapshotId?: string;
	input?: string;
	inputJson?: string;
}): Promise<void> {
	const response = await sessionRequest(options.session, {
		cmd: "run",
		args: await scriptPayload(options.file, options.args, options),
		timeout: options.timeout,
		tab: options.tab,
		snapshotId: options.snapshotId,
	});
	if (!response.ok)
		throw new CommandError(
			response.code ?? "SCRIPT_FAILED",
			response.error,
			response.exitCode ?? 1,
		);
	if (!("data" in response)) throw new Error("脚本返回了无效的结果。");
	writeResult("run", JSON.parse(response.data), {
		json: options.json,
		session: options.session,
		text: response.data,
	});
}
