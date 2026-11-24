import {
	assertSuccess,
	createBatchFile,
	fixtureUrl,
	resolveOutputDir,
	withBenchmarkSession,
	writeJsonArtifact,
} from "./lib.ts";

const iterations = Number.parseInt(
	process.env.BOATHOOK_BENCHMARK_ITERATIONS ?? "10",
	10,
);
const outDir = resolveOutputDir("regression");

const registerUrl = fixtureUrl("register.html");
const welcomeUrl = fixtureUrl("welcome.html");
const testPageUrl = fixtureUrl("test-page.html");

const batchFile = createBatchFile(outDir, "warm-batch.json", [
	{ cmd: "goto", args: [registerUrl] },
	{ cmd: "snapshot", args: [] },
	{ cmd: "text", args: [] },
]);

await withBenchmarkSession(welcomeUrl, async ({ run, startupMs }) => {
	const benchmarkRun = await run([
		"benchmark",
		"--iterations",
		String(iterations),
		"--json",
	]);
	assertSuccess(benchmarkRun, "benchmark");

	const benchmark = JSON.parse(benchmarkRun.stdout).data as {
		iterations: number;
		results: Array<{ name: string; p50: number; p95: number; p99: number }>;
		target: string;
	};

	const navigateWarm = await run(["goto", testPageUrl]);
	assertSuccess(navigateWarm, "warm goto");

	const snapshotFirst = await run(["snapshot", "--json"]);
	assertSuccess(snapshotFirst, "first snapshot");

	const snapshotCached = await run(["snapshot", "--json"]);
	assertSuccess(snapshotCached, "cached snapshot");

	const batchRun = await run(["batch", batchFile, "--json"]);
	assertSuccess(batchRun, "batch warm path");

	const report = {
		timestamp: new Date().toISOString(),
		iterations,
		coldStartMs: startupMs,
		warmGotoMs: navigateWarm.durationMs,
		snapshotMs: {
			first: snapshotFirst.durationMs,
			cached: snapshotCached.durationMs,
		},
		batchMs: batchRun.durationMs,
		benchmark,
	};

	const outPath = writeJsonArtifact(
		outDir,
		"performance-regression.json",
		report,
	);
	process.stdout.write(`${JSON.stringify({ outPath, ...report }, null, 2)}\n`);
});
