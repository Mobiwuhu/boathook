import type { Page } from "playwright";
import { resolveLocator } from "../browser/refs.ts";
import type { Response } from "../ipc/protocol.ts";

export async function handleElementCount(
	page: Page,
	args: string[],
): Promise<Response> {
	const selector = args[0];
	if (!selector) {
		return {
			ok: false,
			error: "Usage: boathook --session NAME element-count <selector|@ref>",
		};
	}

	try {
		const resolved = resolveLocator(page, selector);
		if ("error" in resolved) {
			return { ok: false, error: resolved.error };
		}

		const count = await resolved.locator.count();
		return { ok: true, data: String(count) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}
