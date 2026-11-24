import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const compiledExecutable = Bun.main.startsWith("/$bunfs/");

export function releaseDirectory(): string | undefined {
	return compiledExecutable ? dirname(dirname(process.execPath)) : undefined;
}

export function bunExecutable(): string | null {
	const override = process.env.BOATHOOK_BUN_EXECUTABLE;
	if (override) return override;
	if (!compiledExecutable) return process.execPath;
	const release = releaseDirectory();
	const bundled = release && join(release, "bin", "bun");
	return bundled && existsSync(bundled) ? bundled : Bun.which("bun");
}

export function chromeExecutable(): string | undefined {
	const release = releaseDirectory();
	const bundled = release && join(release, "chrome", "chrome");
	return (
		process.env.BOATHOOK_CHROME_EXECUTABLE ??
		(bundled && existsSync(bundled) ? bundled : undefined)
	);
}
