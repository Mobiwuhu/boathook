import { arch, platform } from "node:os";
import pkg from "../package.json";

export function formatVersion(): string {
	return `boathook ${pkg.version} (${platform()}-${arch()})`;
}
