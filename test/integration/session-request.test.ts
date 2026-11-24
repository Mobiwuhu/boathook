import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
	parseConfigJson,
	resolveConfig,
} from "../../packages/core/src/config/session.ts";
import { generateToken } from "../../packages/core/src/ipc/auth.ts";
import {
	prepareSessionDirectories,
	sessionPaths,
} from "../../packages/core/src/session/paths.ts";
import { sessionRequest } from "../../packages/core/src/session/request.ts";
import { writeRecord } from "../../packages/core/src/session/store.ts";
import { socketTestDirectory } from "../support/socket-command.ts";

test("a lost daemon reply reports a disconnect without replaying the command", async () => {
	const directory = socketTestDirectory();
	const previousState = process.env.BOATHOOK_STATE_DIR;
	process.env.BOATHOOK_STATE_DIR = directory;
	try {
		const paths = sessionPaths("qa");
		prepareSessionDirectories(paths);
		const config = await resolveConfig(parseConfigJson("{}"));
		await writeRecord(paths.sessionPath, {
			name: "qa",
			headed: false,
			idleTimeout: 0,
			config,
		});
		await writeRecord(paths.processPath, {
			id: "test-daemon",
			pid: process.pid,
			socketPath: paths.socketPath,
		});
		generateToken(paths.tokenPath);
		let calls = 0;
		const server = Bun.listen({
			unix: paths.socketPath,
			socket: {
				data(socket) {
					calls++;
					socket.end();
				},
			},
		});
		try {
			await expect(
				sessionRequest("qa", { cmd: "title", args: [] }),
			).rejects.toMatchObject({
				code: "SESSION_DISCONNECTED",
			});
			expect(calls).toBe(1);
		} finally {
			server.stop(true);
		}
	} finally {
		if (previousState === undefined) delete process.env.BOATHOOK_STATE_DIR;
		else process.env.BOATHOOK_STATE_DIR = previousState;
		await rm(directory, { recursive: true, force: true });
	}
});
