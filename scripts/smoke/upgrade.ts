import assert from "node:assert/strict";
import { mkdir, mkdtemp, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { releaseDirectoryName } from "../../apps/cli/src/release.ts";

const [base, next] = process.argv.slice(2).map((arg) => resolve(arg));
assert(base && next, "Usage: bun run test:upgrade BASE.tar.gz NEXT.tar.gz");
const scratch = await mkdtemp(join(tmpdir(), "bc-upgrade-smoke-"));
const state = join(scratch, "state");
const bin = join(scratch, "bin");
const binary = join(bin, "boathook");
const env = {
	...process.env,
	BOATHOOK_STATE_DIR: state,
	BOATHOOK_BIN_DIR: bin,
};
delete env.BOATHOOK_CHROME_EXECUTABLE;
delete env.BOATHOOK_SESSION;
delete env.BUN_BE_BUN;
const page = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch() {
		return new Response("<!doctype html><title>Upgrade smoke</title>", {
			headers: { "content-type": "text/html" },
		});
	},
});

async function run(args: string[], settings = { success: true }) {
	const child = Bun.spawn(args, {
		cwd: scratch,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		child.stdout.text(),
		child.stderr.text(),
	]);
	assert.equal(
		code === 0,
		settings.success,
		JSON.stringify({ args, code, stdout, stderr }),
	);
	return stdout.trim();
}

async function unpack(archive: string, name: string) {
	const directory = join(scratch, name);
	await mkdir(directory);
	await run(["tar", "-xzf", archive, "-C", directory]);
	return join(directory, releaseDirectoryName);
}

let active = false;
try {
	const before = await unpack(base, "base");
	const damaged = await unpack(next, "candidate");
	const from = (await Bun.file(join(before, "manifest.json")).json()).version;
	const to = (await Bun.file(join(damaged, "manifest.json")).json()).version;
	assert(Bun.semver.order(to, from) > 0);

	await run(["bash", join(before, "install.sh")]);
	const previous = await readlink(binary);
	assert.equal(previous, join(state, "releases", from, "bin/boathook"));
	await run([binary, "start", "qa", "--url", page.url.href]);
	active = true;
	await run([
		binary,
		"--session",
		"qa",
		"eval",
		'localStorage.setItem("upgrade-test", "retained")',
	]);
	const pid = JSON.parse(await run([binary, "--json", "status", "qa"])).data
		.pid;
	assert.equal(typeof pid, "number");

	const check = JSON.parse(
		await run([binary, "--json", "upgrade", "--archive", next, "--check"]),
	);
	assert.equal(check.data.state, "available");
	assert.equal(check.data.toVersion, to);
	assert.equal(await readlink(binary), previous);
	console.log(
		"PASS: checking reports the next version without switching the executable",
	);

	await Bun.write(join(damaged, "licenses/Bun.txt"), "corrupt license");
	const badArchive = join(scratch, "damaged.tar.gz");
	await run([
		"tar",
		"-czf",
		badArchive,
		"-C",
		join(scratch, "candidate"),
		releaseDirectoryName,
	]);
	const failed = JSON.parse(
		await run([binary, "--json", "upgrade", "--archive", badArchive], {
			success: false,
		}),
	);
	assert.equal(failed.error.code, "UPGRADE_INSTALL_FAILED");
	assert.equal(await readlink(binary), previous);
	console.log("PASS: a damaged release leaves the existing executable active");

	const updated = JSON.parse(
		await run([binary, "--json", "upgrade", "--archive", next]),
	);
	assert.equal(updated.data.state, "upgraded");
	assert.equal(updated.data.fromVersion, from);
	assert.equal(updated.data.toVersion, to);
	const release = join(state, "releases", to);
	assert.equal(await readlink(binary), join(release, "bin/boathook"));
	const doctor = JSON.parse(await run([binary, "--json", "doctor"])).data;
	assert.equal(doctor.packageManager, await realpath(binary));
	assert.equal(doctor.chrome, join(release, "chrome/chrome"));
	assert.equal(
		JSON.parse(await run([binary, "--json", "status", "qa"])).data.pid,
		pid,
	);
	await run([binary, "restart", "qa"]);
	assert.equal(
		await run([
			binary,
			"--session",
			"qa",
			"eval",
			'localStorage.getItem("upgrade-test")',
		]),
		"retained",
	);
	assert.equal(
		JSON.parse(await run([binary, "--json", "upgrade", "--archive", next])).data
			.state,
		"current",
	);
	console.log(
		`PASS: upgraded ${from} to ${to}, activated the new CLI and Chrome, and reopened the saved profile`,
	);
} finally {
	try {
		if (active) await run([binary, "stop", "qa"]);
	} finally {
		page.stop(true);
		await rm(scratch, { recursive: true, force: true });
	}
}
