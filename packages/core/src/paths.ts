import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function stateRoot(): string {
	return resolve(
		process.env.BOATHOOK_STATE_DIR ?? join(homedir(), ".boathook"),
	);
}
