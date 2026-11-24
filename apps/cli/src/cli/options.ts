import { MAX_TIMEOUT_MS } from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";

export const globalOptions = z.object({
	tab: z.string().min(1).optional().describe("目标标签页 ID"),
	snapshotId: z.string().min(1).optional().describe("元素编号所属的快照 ID"),
	session: z.string().min(1).optional().describe("目标会话"),
	timeout: z
		.number()
		.int()
		.positive()
		.max(MAX_TIMEOUT_MS)
		.optional()
		.describe("命令超时毫秒数"),
	json: z.boolean().optional().describe("输出 JSON 回执"),
	format: z.enum(["json", "text"]).optional().describe("输出格式"),
});

export function longFlag(name: string): string {
	return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export const globalOptionSpecs = Object.entries(globalOptions.shape).map(
	([name, schema]) => ({
		name,
		flag: longFlag(name),
		takesValue: schema.unwrap().type !== "boolean",
	}),
);
export const globalFlags = globalOptionSpecs.map(({ flag }) => flag);

export function selectSession(positional?: string, explicit?: string): string {
	if (positional && explicit && positional !== explicit) {
		throw new CommandError(
			"INVALID_SESSION",
			"位置参数和 --session 必须指向同一个会话。",
		);
	}
	const name = positional ?? explicit ?? process.env.BOATHOOK_SESSION;
	if (!name)
		throw new CommandError(
			"SESSION_REQUIRED",
			"请用 --session NAME 选择会话。",
		);
	return name;
}
