import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computePercentiles } from "../packages/core/src/commands/benchmark.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..");

export type CommandRun = {
	args: string[];
	durationMs: number;
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type DurationSummary = {
	iterations: number;
	p50: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
};

export function resolveOutputDir(name: string): string {
	const baseDir =
		process.env.BOATHOOK_BENCHMARK_OUT_DIR ??
		join(REPO_ROOT, ".benchmarks", new Date().toISOString().slice(0, 10));
	const outDir = join(baseDir, name);
	mkdirSync(outDir, { recursive: true });
	return outDir;
}

export function fixtureUrl(name: string): string {
	return pathToFileURL(join(REPO_ROOT, "test", "fixtures", name)).href;
}

async function runCommand(
	command: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<CommandRun> {
	const start = performance.now();
	const proc = Bun.spawn(command, {
		cwd: options?.cwd ?? REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			...options?.env,
		},
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
		proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
		proc.exited,
	]);

	return {
		args: command,
		durationMs: Math.round(performance.now() - start),
		exitCode,
		stdout,
		stderr,
	};
}

export function runShell(
	command: string,
	options?: {
		cwd?: string;
		env?: Record<string, string>;
	},
): Promise<CommandRun> {
	return runCommand(["sh", "-lc", command], options);
}

type BenchmarkSession = {
	startupMs: number;
	run: (args: string[]) => Promise<CommandRun>;
};

export async function withBenchmarkSession<T>(
	url: string,
	benchmark: (session: BenchmarkSession) => Promise<T>,
): Promise<T> {
	const state = createTempDir("boathook-bench-");
	const binary = join(REPO_ROOT, "dist/boathook");
	const name = "benchmark";
	const command = (args: string[]) =>
		runCommand([binary, ...args], { env: { BOATHOOK_STATE_DIR: state } });
	let started = false;
	try {
		const start = await command(["start", name, "--url", url]);
		assertSuccess(start, "start benchmark session");
		started = true;
		return await benchmark({
			startupMs: start.durationMs,
			run: (args) => command(["--session", name, ...args]),
		});
	} finally {
		if (started)
			assertSuccess(await command(["stop", name]), "stop benchmark session");
		removeDir(state);
	}
}

export function writeJsonArtifact(
	outDir: string,
	filename: string,
	value: unknown,
): string {
	const outPath = join(outDir, filename);
	writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`);
	return outPath;
}

export function createBatchFile(
	outDir: string,
	filename: string,
	batch: unknown,
): string {
	return writeJsonArtifact(outDir, filename, batch);
}

export function assertSuccess(run: CommandRun, label: string): void {
	if (run.exitCode === 0) return;

	throw new Error(
		`${label} failed with exit ${run.exitCode}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
	);
}

export function summariseDurations(durations: number[]): DurationSummary {
	const sorted = [...durations].sort((a, b) => a - b);
	const { p50, p95, p99 } = computePercentiles(sorted);
	return {
		iterations: durations.length,
		p50,
		p95,
		p99,
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
	};
}

export function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(path: string): void {
	rmSync(path, { recursive: true, force: true });
}
