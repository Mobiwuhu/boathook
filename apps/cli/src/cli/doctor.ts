import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	chromeExecutable,
	sessionRequest,
	startSession,
	stopSession,
} from "@boathook/core";
import { CommandError } from "@boathook/plugin-sdk";

export async function doctor() {
	const state = await mkdtemp(join(tmpdir(), "bc-doctor-"));
	const previous = process.env.BOATHOOK_STATE_DIR;
	const name = "doctor";
	let started = false;
	try {
		process.env.BOATHOOK_STATE_DIR = state;
		await startSession(name, {
			url: "data:text/html,<title>boathook ready</title>",
		});
		started = true;
		const response = await sessionRequest(name, { cmd: "title", args: [] });
		if (
			!response.ok ||
			!("data" in response) ||
			response.data !== "boathook ready"
		) {
			throw new CommandError(
				"DOCTOR_FAILED",
				"Chrome 已启动，但页面检查失败，请检查浏览器依赖。",
				1,
			);
		}
		return {
			ready: true,
			bun: Bun.version,
			packageManager: process.execPath,
			chrome: chromeExecutable() ?? "system",
			headless: true,
		};
	} finally {
		try {
			if (started) await stopSession(name);
			await rm(state, { recursive: true, force: true });
		} finally {
			if (previous === undefined) delete process.env.BOATHOOK_STATE_DIR;
			else process.env.BOATHOOK_STATE_DIR = previous;
		}
	}
}
