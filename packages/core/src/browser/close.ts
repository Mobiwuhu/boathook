import { readlink } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "playwright";

export async function closeProfileBrowser(
	context: BrowserContext,
	profile: string,
): Promise<void> {
	const owner = await readlink(join(profile, "SingletonLock")).catch(() => "");
	const pid = Number(owner.match(/-(\d+)$/)?.[1]);
	const close = context.close();
	if (!(pid > 0)) return close;
	// Chromium can exit before Playwright finishes closing its process pipes.
	// Wait for either completion or the managed profile's Chrome process to exit.
	let timer: ReturnType<typeof setInterval> | undefined;
	const exited = new Promise<void>((done) => {
		timer = setInterval(() => {
			try {
				process.kill(pid, 0);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") done();
			}
		}, 50);
	});
	try {
		await Promise.race([close, exited]);
	} finally {
		clearInterval(timer);
	}
}
