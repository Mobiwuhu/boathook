import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { ensurePrivateDirectory } from "../files.ts";
import { stateRoot } from "../paths.ts";

export function sessionPaths(name: string) {
	const id = namedId(name);
	const root = stateRoot();
	const dir = join(root, "sessions", id);
	const run = join(root, "run", id);
	const preferredSocket = join(run, "daemon.sock");
	const socketId = createHash("sha256").update(run).digest("hex").slice(0, 24);
	const socketPath =
		Buffer.byteLength(preferredSocket) <= 100
			? preferredSocket
			: join("/tmp", `boathook-${process.getuid?.()}`, `${socketId}.sock`);
	return {
		root,
		dir,
		run,
		socketPath,
		pidPath: join(run, "daemon.pid"),
		tokenPath: join(run, "daemon.token"),
		lockPath: join(run, "lock"),
		processPath: join(run, "process.json"),
		sessionPath: join(dir, "session.json"),
		statePath: join(dir, "tabs.json"),
		logPath: join(dir, "daemon.log"),
		profilePath: join(dir, "profile"),
		artifactsPath: join(dir, "artifacts"),
	};
}

export type SessionPaths = ReturnType<typeof sessionPaths>;

export function namedId(name: string): string {
	if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(name)) {
		throw new Error(
			"名称须以字母或数字开头，最多 64 个字符，可包含点、短横线和下划线。",
		);
	}
	return createHash("sha256").update(name).digest("hex").slice(0, 20);
}

export function prepareSessionDirectories(paths: SessionPaths): void {
	for (const directory of [
		paths.root,
		dirname(paths.dir),
		paths.dir,
		dirname(paths.run),
		paths.run,
		dirname(paths.socketPath),
		paths.artifactsPath,
	]) {
		ensurePrivateDirectory(directory);
	}
}
