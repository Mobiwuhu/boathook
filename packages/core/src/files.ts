import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import type { z } from "incur";
import writeFileAtomic from "write-file-atomic";

export async function readJson<T>(
	path: string,
	schema: z.ZodType<T>,
): Promise<T | null> {
	return Bun.file(path)
		.text()
		.then((content) => schema.parse(JSON.parse(content)))
		.catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		});
}

export function writeRecord(path: string, data: object) {
	return writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`, {
		mode: 0o600,
	});
}

export function ensurePrivateDirectory(dir: string): string {
	if (existsSync(dir)) {
		const lst = lstatSync(dir);
		if (lst.isSymbolicLink() || !lst.isDirectory()) {
			throw new Error(`Unsafe boathook directory: ${dir}`);
		}
		const st = statSync(dir);
		if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
			throw new Error(`boathook directory is not owned by this user: ${dir}`);
		}
	} else {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	chmodSync(dir, 0o700);
	return dir;
}
