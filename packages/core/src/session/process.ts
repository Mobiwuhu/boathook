import {
	closeSync,
	constants,
	fchmodSync,
	lstatSync,
	openSync,
	readFileSync,
	rmSync,
	writeSync,
} from "node:fs";

export const DEFAULT_SESSION_IDLE_SECONDS = 24 * 60 * 60;

export type LifecycleConfig = {
	pidPath: string;
	socketPath: string;
	idleTimeoutMs: number;
};

/** Returns true if a live daemon is already running. Cleans up stale PID files. */
export function checkStalePid(
	config: Pick<LifecycleConfig, "pidPath">,
): boolean {
	let content: string;
	try {
		const stats = lstatSync(config.pidPath);
		if (stats.isSymbolicLink()) {
			rmSync(config.pidPath, { force: true });
			return false;
		}
		if (!stats.isFile()) {
			throw new Error(`Unsafe boathook PID file path: ${config.pidPath}`);
		}
		content = readFileSync(config.pidPath, "utf-8").trim();
	} catch (error) {
		// The daemon can remove its PID file while the supervisor waits for shutdown.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}

	const pid = Number.parseInt(content, 10);
	if (!Number.isInteger(pid) || pid <= 0) {
		rmSync(config.pidPath, { force: true });
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		rmSync(config.pidPath, { force: true });
		return false;
	}
}

export function writePidFile(config: LifecycleConfig): void {
	const fd = openSync(
		config.pidPath,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		fchmodSync(fd, 0o600);
		writeSync(fd, String(process.pid));
	} finally {
		closeSync(fd);
	}
}

export function cleanupFiles(config: LifecycleConfig): void {
	rmSync(config.pidPath, { force: true });
	rmSync(config.socketPath, { force: true });
}

export type IdleTimer = {
	reset: () => void;
	clear: () => void;
};

export function createIdleTimer(
	config: LifecycleConfig,
	onExpiry: () => void,
): IdleTimer {
	let handle: ReturnType<typeof setTimeout> | null = null;

	function start() {
		if (config.idleTimeoutMs > 0) {
			handle = setTimeout(onExpiry, config.idleTimeoutMs);
		}
	}

	function reset() {
		if (handle !== null) clearTimeout(handle);
		start();
	}

	function clear() {
		if (handle !== null) {
			clearTimeout(handle);
			handle = null;
		}
	}

	start();
	return { reset, clear };
}
