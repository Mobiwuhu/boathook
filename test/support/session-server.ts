import type { Page } from "playwright";
import { startServer } from "../../packages/core/src/daemon/execute.ts";

function preparePage(page: Page): Page {
	page.once ??= (() => page) as Page["once"];
	page.isClosed ??= () => false;
	return page;
}

export function startTestServer(
	...args: Parameters<typeof startServer>
): ReturnType<typeof startServer> {
	const [{ page, context }] = args;
	preparePage(page);
	context.pages ??= () => [page];
	context.on ??= (() => context) as typeof context.on;
	const openPage = context.newPage;
	if (openPage)
		context.newPage = async () => preparePage(await openPage.call(context));
	return startServer(...args);
}
