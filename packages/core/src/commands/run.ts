import { stat } from "node:fs/promises";
import type { CommandContext, PluginCommand } from "@boathook/plugin-sdk";

export type ScriptContext = Pick<
	CommandContext,
	"page" | "context" | "args"
> & {
	input: unknown;
};

export const scriptCommand: PluginCommand = {
	name: "run",
	summary: "Run a project script on the active page",
	usage:
		"boathook --session NAME run FILE [--input-json JSON | --input FILE] [-- ARG…]",
	async handler({ page, context, args: [path, input, ...args] }) {
		if (!path) return { ok: false, error: "请指定要运行的 TS 或 JS 文件。" };
		const info = await stat(path);
		// Bun preserves the version suffix in filesystem module specifiers.
		const script = await import(`${path}?boathook=${info.mtimeMs}`);
		if (typeof script.default !== "function") {
			return { ok: false, error: "脚本需要默认导出一个函数。" };
		}
		const data: unknown = await script.default({
			page,
			context,
			args,
			input: input ? JSON.parse(input) : undefined,
		} satisfies ScriptContext);
		return { ok: true, data: JSON.stringify(data) ?? "null" };
	},
};
