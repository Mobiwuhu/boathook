import { CommandError } from "@boathook/plugin-sdk";
import { lock } from "proper-lockfile";

export async function withPathLock<T>(
	path: string,
	lockPath: string,
	run: () => Promise<T>,
): Promise<T> {
	const release = await lock(path, {
		lockfilePath: lockPath,
		retries: { retries: 60, minTimeout: 100, maxTimeout: 250 },
	}).catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
			throw new CommandError(
				"SESSION_BUSY",
				"另一条命令正在更新，请稍后重试。",
				3,
			);
		}
		throw error;
	});
	try {
		return await run();
	} finally {
		await release();
	}
}
