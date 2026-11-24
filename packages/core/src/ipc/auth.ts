import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * Generate a cryptographically secure token, write it to the token file,
 * and return it. The file is readable only by the current user (0o600).
 */
export function generateToken(path: string): string {
	const token = randomBytes(32).toString("hex");
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	writeFileSync(path, token, { mode: 0o600 });
	chmodSync(path, 0o600);
	return token;
}

/**
 * Read the token from the token file. Returns null if the file
 * does not exist or is unreadable.
 */
export function readToken(path: string): string | null {
	try {
		if (!existsSync(path)) return null;
		return readFileSync(path, "utf-8").trim();
	} catch {
		return null;
	}
}

/**
 * Remove the token file (called during daemon shutdown).
 */
export function cleanupToken(path: string): void {
	rmSync(path, { force: true });
}
