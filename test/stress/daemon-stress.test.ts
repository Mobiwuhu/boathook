import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { sendPayload } from "../../packages/core/src/ipc/client.ts";
import { startTestServer } from "../support/session-server.ts";
import { socketTestDirectory } from "../support/socket-command.ts";

test("the daemon serves concurrent page queries over its Unix socket", async () => {
	const requested = Number.parseInt(
		process.env.BOATHOOK_STRESS_ITERATIONS ?? "50",
		10,
	);
	const iterations = requested > 0 ? requested : 50;
	const directory = socketTestDirectory();
	const socketPath = join(directory, "daemon.sock");
	const url = "about:blank";
	try {
		const { shutdown } = await startTestServer(
			{
				page: {
					title: async () => "Stress page",
					url: () => url,
					on: () => {},
				} as never,
				context: {} as never,
				config: null,
			},
			{
				socketPath,
				pidPath: join(directory, "daemon.pid"),
				idleTimeoutMs: 60_000,
			},
			async () => {},
		);
		try {
			for (let i = 0; i < iterations; i++) {
				const [title, address] = await Promise.all([
					sendPayload(socketPath, { cmd: "title", args: [] }, 1_000),
					sendPayload(socketPath, { cmd: "url", args: [] }, 1_000),
				]);
				expect(title).toEqual({ ok: true, data: "Stress page" });
				expect(address).toEqual({ ok: true, data: url });
			}
		} finally {
			await shutdown();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);
