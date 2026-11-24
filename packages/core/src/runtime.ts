import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const compiledExecutable = Bun.main.startsWith("/$bunfs/");

export function releaseDirectory(): string | undefined {
	return compiledExecutable ? dirname(dirname(process.execPath)) : undefined;
}

export function bunCliEnv(): NodeJS.ProcessEnv {
	// Run the invoked executable as Bun's CLI, even when it is compiled.
	return { ...process.env, BUN_BE_BUN: "1" };
}

export function chromeExecutable(): string | undefined {
	const release = releaseDirectory();
	const bundled = release && join(release, "chrome", "chrome");
	return (
		process.env.BOATHOOK_CHROME_EXECUTABLE ??
		(bundled && existsSync(bundled) ? bundled : undefined)
	);
}
