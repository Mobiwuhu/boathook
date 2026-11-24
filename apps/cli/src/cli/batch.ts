import { type BatchResponse, BUILTIN_COMMANDS } from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { Parser, z } from "incur";
import { globalOptions } from "./options.ts";
import { parseCommandData, writeError, writeResult } from "./output.ts";
import { resolveCommandPaths } from "./paths.ts";
import { parseScriptArgs } from "./script.ts";

const target = globalOptions
	.pick({ tab: true, snapshotId: true, timeout: true })
	.strict();
const batchOptions = z.object({
	file: z.string().min(1).optional(),
	continueOnError: z.boolean().optional(),
});
const batchInput = target.extend({
	continueOnError: z.boolean().optional(),
	batch: z
		.array(
			target.extend({
				cmd: z.string(),
				args: z.array(z.string()).default([]),
				json: z.boolean().optional(),
			}),
		)
		.min(1),
});

export function parseBatchArgs(args: string[]): {
	filePath?: string;
	continueOnError: boolean;
} {
	const parsed = Parser.parse(args, {
		args: z.object({ path: z.string().min(1).optional() }),
		options: batchOptions,
	});
	if (parsed.args.path && parsed.options.file)
		throw new CommandError("INVALID_ARGUMENTS", "请只指定一个批处理文件。");
	return {
		filePath: parsed.args.path ?? parsed.options.file,
		continueOnError: parsed.options.continueOnError === true,
	};
}

export async function readBatchPayload(args: string[]) {
	try {
		const { filePath, continueOnError } = parseBatchArgs(args);
		if (!filePath)
			throw new CommandError(
				"INVALID_ARGUMENTS",
				"请指定批处理 JSON 文件。用法见 boathook help batch。",
			);
		const data: unknown = await Bun.file(filePath).json();
		const request = batchInput.parse(
			Array.isArray(data) ? { batch: data } : data,
		);
		const batch = [];
		for (const item of request.batch) {
			if (!BUILTIN_COMMANDS.has(item.cmd) && item.cmd !== "run")
				throw new CommandError(
					"INVALID_ARGUMENTS",
					`批处理不支持命令 ${item.cmd}。`,
				);
			if (item.cmd === "status" && item.args.length > 0)
				throw new CommandError(
					"INVALID_ARGUMENTS",
					"批处理 status 的目标取自批处理会话，args 应为空。",
				);
			batch.push({
				...item,
				args:
					item.cmd === "run"
						? await parseScriptArgs(item.args)
						: resolveCommandPaths(item.cmd, item.args, process.cwd()),
			});
		}
		return {
			...request,
			batch,
			continueOnError: continueOnError || request.continueOnError,
		};
	} catch (error) {
		if (error instanceof CommandError) throw error;
		throw new CommandError(
			"INVALID_ARGUMENTS",
			"批处理输入无效。" +
				(error instanceof Error ? error.message : String(error)),
		);
	}
}

export function writeBatch(
	response: BatchResponse,
	json: boolean,
	session: string,
): void {
	const { output, isError } = formatBatchOutput(response);
	const data = {
		batch: response.batch.map((item) =>
			item.ok
				? { cmd: item.cmd, ok: true, data: parseCommandData(item.data, true) }
				: {
						cmd: item.cmd,
						ok: false,
						error: { code: item.code ?? "COMMAND_FAILED", message: item.error },
					},
		),
		stoppedEarly: response.stoppedEarly ?? false,
	};
	if (isError) {
		const failed = response.batch.findLast((item) => !item.ok);
		writeError(
			"batch",
			new CommandError(
				"BATCH_FAILED",
				"批处理中有命令执行失败。",
				failed?.exitCode ?? 1,
			),
			json,
			session,
			{ data, text: `${output}\n` },
		);
		return;
	}
	writeResult("batch", data, { json, session, text: output });
}

export function formatBatchOutput(response: BatchResponse): {
	output: string;
	isError: boolean;
} {
	const lines = ["Batch Results:", ""];
	let isError = false;

	for (const entry of response.batch) {
		if (entry.ok) {
			lines.push(`[PASS] ${entry.cmd}: ${entry.data}`);
		} else {
			isError = true;
			lines.push(`[FAIL] ${entry.cmd}: ${entry.error}`);
		}
	}

	if (response.stoppedEarly) {
		lines.push("");
		lines.push("Stopped early after the first failure.");
	}

	return {
		output: lines.join("\n"),
		isError,
	};
}
