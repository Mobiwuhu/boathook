// Usage: bun run test:integration
// Build with bun run build in that repository first.
// Set BOATHOOK_SMOKE_CHROME to use an installed Chromium executable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const binary = process.env.BOATHOOK_SMOKE_BINARY ?? join(repo, "dist/boathook");
const defaultIdleSeconds = 86_400;
const scratch = await mkdtemp(
	join(process.env.BOATHOOK_SMOKE_TMP ?? "/tmp", "bc-"),
);
const sessions = new Set(["qa", "qb"]);
const state = join(
	scratch,
	"session-storage-with-a-socket-path-that-is-too-long-for-a-unix-socket",
);
const env = {
	...process.env,
	BOATHOOK_STATE_DIR: state,
	BOATHOOK_CHROME_EXECUTABLE:
		process.env.BOATHOOK_SMOKE_CHROME ?? process.env.BOATHOOK_CHROME_EXECUTABLE,
	XDG_RUNTIME_DIR: join(scratch, "run"),
	XDG_STATE_HOME: join(scratch, "xdg-state"),
	BOATHOOK_TRUST_PROJECT_CONFIG: "0",
	BOATHOOK_SMOKE_USERNAME: "test-user",
	BOATHOOK_SMOKE_PASSWORD: crypto.randomUUID(),
};
const fixtureHtml = `<!doctype html>
<title>Smoke ready</title>
<button onclick="localStorage.setItem('clicked', 'yes'); document.title='Smoke clicked'">Run check</button>
<button onclick="window.open('/popup', '_blank')">Open popup</button>
<script>
	if (localStorage.clicked) document.title = "Smoke restored";
	if (window.bcContext && window.bcPage) document.title = window.bcContext + "/" + window.bcPage;
	if (window.bcEntry) document.body.dataset.entry = window.bcEntry;
	const style = getComputedStyle(document.body);
	document.body.dataset.display = CSSStyleDeclaration.prototype.getPropertyValue.call(style, "display");
</script>`;
const signInHtml = `<!doctype html>
<title>Smoke sign in</title>
<form action="/signed-in" method="post" autocomplete="off">
	<label>Username <input name="username"></label>
	<label>Password <input name="password" type="password" autocomplete="new-password"></label>
	<button style="display:block;margin-top:150px">Sign in</button>
</form>`;
const fixture = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const { pathname } = new URL(request.url);
		const headers = { "Content-Type": "text/html;charset=utf-8" };
		if (pathname === "/signin") return new Response(signInHtml, { headers });
		if (pathname === "/signed-in" && request.method === "POST") {
			const form = await request.formData();
			if (
				form.get("username") !== env.BOATHOOK_SMOKE_USERNAME ||
				form.get("password") !== env.BOATHOOK_SMOKE_PASSWORD
			)
				return new Response("Sign-in failed", { status: 403 });
			return new Response(
				"<title>Smoke signed in</title><main>Signed in</main>",
				{ headers },
			);
		}
		return new Response(fixtureHtml, { headers });
	},
});

async function command(args: string[], stdin?: string, cwd = scratch) {
	const proc = Bun.spawn([binary, ...args], {
		cwd,
		env,
		stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code, out: out.trim(), err: err.trim() };
}

async function run(...args: string[]): Promise<string> {
	const result = await command(args);
	assert.equal(result.code, 0, JSON.stringify({ args, ...result }));
	return result.out;
}

function storageId(name: string): string {
	return createHash("sha256").update(name).digest("hex").slice(0, 20);
}

async function checkOfflineQueries(): Promise<void> {
	await mkdir(env.XDG_RUNTIME_DIR);
	const occupied = join(env.XDG_RUNTIME_DIR, "occupied");
	await writeFile(occupied, "occupied");
	assert.match(await run("--help"), /boathook/);
	assert.match(await run("--version"), /^boathook /);
	assert.match(
		await run("help", "snapshot"),
		/boathook \[--json\] --session NAME snapshot/,
	);
	assert.ok((await run("help", "help")).includes("boathook help [COMMAND]"));
	assert.match(await run("help", "version"), /boathook version/);
	assert.match(await run("help", "plugin"), /boathook plugin install SOURCE/);
	const flowHelp = await run("help", "flow");
	assert.ok(flowHelp.includes("flow init <template> [name] [--force]"));
	assert.match(flowHelp, /login-smoke/);
	for (const help of [flowHelp, await run("help", "test-matrix")]) {
		for (const format of ["tap", "allure", "html"]) {
			assert.ok(help.includes(format), format);
		}
	}
	assert.match(await run("restart", "qa", "--help"), /--idle-timeout/);
	assert.match(await run("completions", "bash"), /--idle-timeout/);
	const discovered = JSON.parse(await run("--json", "--llms-full")).data;
	for (const name of [
		"click",
		"snapshot",
		"batch",
		"plugin install",
		"restart",
		"stop",
	]) {
		assert(
			discovered.commands.some(
				(command: { name: string }) => command.name === name,
			),
			name,
		);
	}
	for (const name of ["quit", "ping", "repl", "boathook:shutdown"]) {
		assert(
			!discovered.commands.some(
				(command: { name: string }) => command.name === name,
			),
		);
	}
	assert.deepEqual(JSON.parse(await run("--format=json", "ls")).data, []);
	const lateFormat = await command(["ls", "--format", "json"]);
	assert.equal(lateFormat.code, 2);
	assert.match(lateFormat.err, /^INVALID_ARGUMENTS:/);
	const missingName = await command(["--json", "start"]);
	assert.equal(missingName.code, 2);
	assert.equal(JSON.parse(missingName.out).error.code, "VALIDATION_ERROR");
	assert.equal(await readFile(occupied, "utf8"), "occupied");
	assert.deepEqual((await readdir(scratch)).sort(), ["run"]);
}

async function clickCheck(session: string): Promise<void> {
	const snapshot = await run("--session", session, "snapshot", "-i");
	const ref = snapshot.match(/(@e\d+) \[button\] "Run check"/)?.[1];
	assert.ok(ref, snapshot);
	await run("--session", session, "click", ref);
}

async function checkSessions(url: string) {
	const [one, two] = await Promise.all([
		run("--json", "start", "qa", "--url", url),
		run("--json", "start", "qa", "--url", url),
	]);
	const first = JSON.parse(one).data;
	assert.equal(first.state, "running");
	assert.equal(first.idleTimeout, defaultIdleSeconds);
	assert.equal(first.pid, JSON.parse(two).data.pid);
	assert.equal(
		await run("--session", "qa", "eval", "document.body.dataset.display"),
		"block",
	);
	await clickCheck("qa");
	assert.equal(await run("--session", "qa", "title"), "Smoke clicked");
	await run("start", "qb", "--url", url);
	assert.equal(await run("--session", "qb", "title"), "Smoke ready");
	await run("stop", "qa");
	const stopped = await command(["--json", "--session", "qa", "title"]);
	assert.equal(stopped.code, 2);
	assert.equal(JSON.parse(stopped.out).error.code, "SESSION_STOPPED");
	await run("start", "qa");
	assert.equal(await run("--session", "qa", "title"), "Smoke restored");
	assert.equal(await run("--session", "qb", "title"), "Smoke ready");
	await writeFile(
		join(scratch, "commands.json"),
		JSON.stringify([
			{ cmd: "title", args: [] },
			{ cmd: "url", args: [] },
			{ cmd: "status" },
		]),
	);
	const batch = JSON.parse(
		await run("--json", "--session", "qa", "batch", "commands.json"),
	);
	const status = JSON.parse(await run("--json", "status", "qa")).data;
	assert.deepEqual(
		batch.data.batch.map((item: { data: unknown }) => item.data),
		[{ text: "Smoke restored" }, { text: url }, status],
	);
}

async function checkIdleShutdown(url: string) {
	const restarted = JSON.parse(
		await run("--json", "restart", "qa", "--idle-timeout", "2"),
	).data;
	assert.equal(restarted.idleTimeout, 2);
	assert.equal(
		await run(
			"--session",
			"qa",
			"page-eval",
			"await Bun.sleep(2200); return page.title();",
		),
		"Smoke restored",
	);

	const status = async () =>
		JSON.parse(await run("--json", "status", "qa")).data;
	let current = await status();
	const deadline = Date.now() + 8_000;
	while (current.state === "running" && Date.now() < deadline) {
		await Bun.sleep(100);
		current = await status();
	}
	assert.equal(current.state, "stopped");
	assert.equal(current.activeUrl, url);

	await run("start", "qa", "--idle-timeout", String(defaultIdleSeconds));
	assert.equal(await run("--session", "qa", "title"), "Smoke restored");
}

async function checkDispatch() {
	const scoped = ["--session", "qa"];
	const batchPath = join(scratch, "dispatch.json");
	for (const invalid of [
		{ cmd: "session", args: ["list"] },
		{ cmd: "quit", args: [] },
		{ cmd: "ping", args: [] },
		{ cmd: "url", args: [], session: "qb" },
		{ cmd: "click", args: [1] },
	]) {
		await writeFile(
			batchPath,
			JSON.stringify([
				{
					cmd: "eval",
					args: ['document.body.dataset.rejected = "unexpected"'],
				},
				invalid,
			]),
		);
		const result = await command(["--json", ...scoped, "batch", batchPath]);
		assert.equal(result.code, 2, result.out);
		assert.equal(JSON.parse(result.out).error.code, "INVALID_ARGUMENTS");
	}
	assert.equal(
		await run(...scoped, "eval", "document.body.dataset.rejected"),
		"undefined",
	);

	const release = join(scratch, "complete-operation");
	const started = join(scratch, "started-operation");
	const code = `await Bun.write(${JSON.stringify(started)}, "started");
		while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(20);
		await page.evaluate(() => { document.body.dataset.late = "completed"; }); return true;`;
	await writeFile(
		batchPath,
		JSON.stringify({
			continueOnError: true,
			batch: [
				{ cmd: "page-eval", args: [code], timeout: 250 },
				{ cmd: "eval", args: ['document.body.dataset.next = "unexpected"'] },
			],
		}),
	);
	try {
		const timeout = await command(["--json", ...scoped, "batch", batchPath]);
		assert.equal(timeout.code, 3, timeout.out);
		const receipt = JSON.parse(timeout.out);
		assert.equal(receipt.ok, false);
		assert.equal(receipt.error.code, "BATCH_FAILED");
		const { batch, stoppedEarly } = receipt.data;
		assert.equal(batch[0].error.code, "COMMAND_OUTCOME_UNKNOWN");
		assert.equal(batch.length, 1);
		assert.equal(stoppedEarly, true);
		assert.equal(await Bun.file(started).text(), "started");
		const queued = await command([
			"--json",
			...scoped,
			"--timeout",
			"50",
			"eval",
			'document.body.dataset.queued = "unexpected"',
		]);
		assert.equal(queued.code, 3, queued.out);
		assert.equal(JSON.parse(queued.out).error.code, "COMMAND_NOT_STARTED");
	} finally {
		await writeFile(release, "done");
	}
	const details = await run(
		...scoped,
		"eval",
		"JSON.stringify({ late: document.body.dataset.late, next: document.body.dataset.next, queued: document.body.dataset.queued })",
	);
	assert.deepEqual(JSON.parse(details), { late: "completed" });
}

async function checkPaths() {
	const directory = join(scratch, "another directory");
	await mkdir(directory);
	const caller = await realpath(directory);
	const scoped = ["--session", "qa"];
	const screenshot = await command(
		[...scoped, "screenshot", "--selector", "body", "relative.png"],
		undefined,
		caller,
	);
	assert.equal(screenshot.code, 0, screenshot.err);
	assert.equal(screenshot.out, join(caller, "relative.png"));
	await writeFile(
		join(caller, "paths.json"),
		JSON.stringify([{ cmd: "screenshot", args: ["--viewport", "batch.png"] }]),
	);
	const batch = await command(
		["--json", ...scoped, "batch", "paths.json"],
		undefined,
		caller,
	);
	assert.equal(batch.code, 0, batch.out);
	assert.equal(
		JSON.parse(batch.out).data.batch[0].data.text,
		join(caller, "batch.png"),
	);
	for (const file of ["relative.png", "batch.png"]) {
		assert(await Bun.file(join(caller, file)).exists());
		assert(!(await Bun.file(join(scratch, file)).exists()));
	}
	const ci = await command(["--json", "ci-init"], undefined, caller);
	assert.equal(ci.code, 0, ci.out);
	assert.equal(
		JSON.parse(ci.out).data.path,
		join(caller, ".github/workflows/boathook-qa.yml"),
	);
	assert(
		!(await Bun.file(
			join(scratch, ".github/workflows/boathook-qa.yml"),
		).exists()),
	);
}

async function checkFlow(): Promise<void> {
	const scoped = ["--session", "qb"];
	assert.match(await run(...scoped, "flow", "list"), /fixture/);
	const output = await run(...scoped, "flow", "fixture", "--reporter", "json");
	const directory = join(
		state,
		"sessions",
		storageId("qb"),
		"artifacts",
		"screenshots",
	);
	assert.match(output, /flow-fixture-step2-/);
	assert.ok(
		(await readdir(directory)).some((file) =>
			file.startsWith("flow-fixture-step2-"),
		),
	);
}

async function checkCommandConfig(url: string): Promise<void> {
	const name = "configured";
	const dir = join(scratch, "configured-project");
	await mkdir(join(dir, "flows"), { recursive: true });
	const healthcheckPage = {
		name: "Smoke page",
		url,
		assertions: [{ visible: "button" }],
	};
	const settings = {
		url,
		timeout: 60_000,
		healthcheck: { pages: [healthcheckPage] },
		permissions: {
			check: {
				page: url,
				granted: { visible: "button" },
				denied: { textContains: "Denied" },
			},
		},
		artifacts: { retention: { screenshots: "1d" } },
		environments: Object.fromEntries(
			["admin", "viewer"].map((role) => [
				role,
				{
					loginUrl: new URL("/signin", url).href,
					userEnvVar: "BOATHOOK_SMOKE_USERNAME",
					passEnvVar: "BOATHOOK_SMOKE_PASSWORD",
					successCondition: { elementVisible: "main" },
				},
			]),
		),
		flows: {
			"login-fixture": { steps: [{ login: "admin" }] },
			"signed-in-fixture": { steps: [{ assert: { visible: "main" } }] },
		},
	};
	await Bun.write(
		join(dir, "flows", "local.json"),
		JSON.stringify({ steps: [{ assert: { visible: "button" } }] }),
	);
	const validated = JSON.parse(
		await run(
			"--json",
			"config",
			"validate",
			"--config-json",
			JSON.stringify(settings),
		),
	).data;
	assert.equal(validated.valid, true);
	sessions.add(name);
	const started = await command(
		["start", name, "--config-json", "-"],
		JSON.stringify(settings),
		dir,
	);
	assert.equal(started.code, 0, started.out + started.err);
	const equivalent = {
		...settings,
		flows: Object.fromEntries(Object.entries(settings.flows).reverse()),
	};
	const unchanged = await command(
		["start", name, "--config-json", JSON.stringify(equivalent)],
		undefined,
		dir,
	);
	assert.equal(unchanged.code, 0, unchanged.out + unchanged.err);
	const scoped = ["--session", name];
	const longCommand = await run(
		...scoped,
		"page-eval",
		'await Bun.sleep(36000); return "long command completed";',
	);
	assert.equal(longCommand, "long command completed");
	console.log("PASS: session timeout applies to the CLI and daemon");
	const healthcheck = () => run(...scoped, "healthcheck", "--no-screenshots");
	assert.match(await healthcheck(), /Smoke page/);
	assert.match(
		await run(...scoped, "assert", "permission", "check", "granted"),
		/PASS: permission/,
	);
	assert.match(await run(...scoped, "flow", "list"), /local.*\[file:/);
	assert.match(await run(...scoped, "flow", "local"), /1\/1 steps completed/);
	await run(...scoped, "flow", "init", "smoke", "generated");
	assert.match(await run(...scoped, "flow", "list"), /generated.*\[file:/);
	assert.match(
		await run(
			...scoped,
			"flow",
			"generated",
			"--var",
			`url=${url}`,
			"--var",
			"expected_text=Run check",
		),
		/3\/3 steps completed/,
	);
	for (const args of [
		["login", "--env", "admin"],
		["flow", "login-fixture"],
		[
			"test-matrix",
			"--roles",
			"admin,viewer",
			"--flow",
			"local",
			"--reporter",
			"json",
		],
	]) {
		const result = await command(["--json", ...scoped, ...args]);
		assert.notEqual(result.code, 0, result.out);
		assert.match(result.out, /BOATHOOK_TRUST_PROJECT_CONFIG/);
	}
	const screenshots = join(
		state,
		"sessions",
		storageId(name),
		"artifacts",
		"screenshots",
	);
	await mkdir(screenshots, { recursive: true });
	const expired = join(screenshots, "expired.png");
	await Bun.write(expired, "old artifact");
	await utimes(expired, new Date(0), new Date(0));
	await run(...scoped, "screenshot", "--viewport");
	assert.equal(await Bun.file(expired).exists(), false);

	healthcheckPage.name = "Updated smoke page";
	const next = JSON.stringify(settings);
	const rejected = await command(
		["--json", "start", name, "--config-json", next],
		undefined,
		dir,
	);
	assert.equal(JSON.parse(rejected.out).error.code, "RESTART_REQUIRED");
	assert.match(await healthcheck(), /Smoke page/);
	const restarted = await command(
		["restart", name, "--config-json", next],
		undefined,
		dir,
	);
	assert.equal(restarted.code, 0, restarted.out + restarted.err);
	assert.match(await healthcheck(), /Updated smoke page/);
	await run("stop", name);
	env.BOATHOOK_TRUST_PROJECT_CONFIG = "1";
	try {
		await run("start", name);
	} finally {
		env.BOATHOOK_TRUST_PROJECT_CONFIG = "0";
	}
	assert.match(await healthcheck(), /Updated smoke page/);
	assert.match(
		await run(...scoped, "login", "--env", "admin"),
		/Logged in to admin/,
	);
	assert.equal(await run(...scoped, "title"), "Smoke signed in");
	assert.match(
		await run(...scoped, "flow", "login-fixture"),
		/1\/1 steps completed/,
	);
	assert.match(
		await run(
			...scoped,
			"test-matrix",
			"--roles",
			"admin,viewer",
			"--flow",
			"signed-in-fixture",
		),
		/viewer: 1\/1 steps passed/,
	);
	await run("stop", name);
	console.log(
		"PASS: project settings reach browser commands and persist across restart and reopen",
	);
}

async function checkRun() {
	const dir = join(scratch, "project scripts");
	const pkg = join(dir, "node_modules", "smoke-helper");
	await mkdir(pkg, { recursive: true });
	await writeFile(
		join(pkg, "package.json"),
		'{"type":"module","exports":"./index.js"}',
	);
	await writeFile(join(pkg, "index.js"), 'export default "installed package";');
	await writeFile(
		join(dir, "helper.ts"),
		'export const marker: string = "relative import";',
	);
	const source = [
		'import pkg from "smoke-helper";',
		'import { marker } from "./helper.ts";',
		"export default async ({ page, input, args }) => ({ title: await page.title(), pkg, marker, input, args });",
	].join("\n");
	const script = join(dir, "script.ts");
	await writeFile(script, source);
	const input = { filter: [true, null, "筛选"] };
	const result = await command(
		[
			"--json",
			"--session",
			"qa",
			"run",
			script,
			"--input",
			"-",
			"--",
			"--json",
			"two words",
		],
		JSON.stringify(input),
	);
	assert.equal(result.code, 0, JSON.stringify(result));
	assert.deepEqual(JSON.parse(result.out).data, {
		title: "Smoke restored",
		pkg: "installed package",
		marker: "relative import",
		input,
		args: ["--json", "two words"],
	});
	await writeFile(
		script,
		source.replace("title: await page.title()", 'title: "updated script"'),
	);
	const edited = JSON.parse(
		await run(
			"--json",
			"--session",
			"qa",
			"run",
			script,
			"--input-json",
			"null",
		),
	);
	assert.equal(edited.data.title, "updated script");
	assert.equal(edited.data.input, null);
	const batchFile = join(dir, "batch.json");
	await writeFile(
		batchFile,
		JSON.stringify([
			{
				cmd: "run",
				args: [script, "--input-json", JSON.stringify(input), "--", "one"],
			},
		]),
	);
	const { batch } = JSON.parse(
		await run("--format=json", "--session=qa", "batch", batchFile),
	).data;
	assert.deepEqual(batch[0].data, { ...edited.data, input, args: ["one"] });
}

async function checkTabs() {
	const session = ["--session", "qb"];
	const [first] = JSON.parse(
		await run("--json", ...session, "tab", "list"),
	).data;
	await run(
		...session,
		"tab",
		"new",
		"data:text/html,<title>Second tab</title><button>Other</button>",
	);
	const [, second] = JSON.parse(
		await run("--json", ...session, "tab", "list"),
	).data;
	const one = [...session, "--tab", first.tabId];
	const two = [...session, "--tab", second.tabId];
	const { data: snapshot } = JSON.parse(
		await run("--json", ...one, "snapshot", "-i"),
	);
	assert.equal(snapshot.tabId, first.tabId);
	const button = snapshot.nodes.find(
		({ name }: { name: string }) => name === "Run check",
	);
	assert(button?.ref);
	await run("--json", ...two, "snapshot", "-i");
	await run(...one, "--snapshot-id", snapshot.snapshotId, "click", button.ref);
	assert.equal(await run(...one, "title"), "Smoke clicked");
	assert.equal(await run(...session, "title"), "Second tab");
	const stale = await command([
		"--json",
		...one,
		"--snapshot-id",
		snapshot.snapshotId,
		"click",
		button.ref,
	]);
	assert.equal(JSON.parse(stale.out).error.code, "STALE_REF");
	await run("stop", "qb");
	await run("start", "qb");
	assert.equal(await run(...two, "title"), "Second tab");
	await run(...session, "tab", "close", second.tabId);
	const gone = await command(["--json", ...two, "title"]);
	assert.equal(JSON.parse(gone.out).error.code, "TAB_GONE");
	await run(
		...one,
		"page-eval",
		`const popup = page.waitForEvent("popup");
		await page.getByRole("button", { name: "Open popup" }).click();
		await (await popup).waitForLoadState("domcontentloaded"); return true;`,
	);
	const tabs = JSON.parse(await run("--json", ...session, "tab", "list")).data;
	const popup = tabs.find(
		({ url }: { url: string }) => new URL(url).pathname === "/popup",
	);
	assert(popup?.tabId);
	const script = join(scratch, "new-tab.ts");
	await writeFile(
		script,
		`export default async ({ context }) => {
		const page = await context.newPage();
		await page.goto("data:text/html,<title>Script tab</title>");
	};`,
	);
	await run(...session, "run", script);
	await run(...session, "benchmark", "--iterations", "1");
	const opened = JSON.parse(
		await run("--json", ...session, "tab", "list"),
	).data;
	assert.equal(opened.length, 3);
	assert(opened.some(({ title }: { title: string }) => title === "Script tab"));
	await run("stop", "qb");
	await run("start", "qb");
	const popupTarget = [...session, "--tab", popup.tabId];
	assert.equal(new URL(await run(...popupTarget, "url")).pathname, "/popup");
	await run(...popupTarget, "page-eval", "page.close()");
	const remaining = JSON.parse(
		await run("--json", ...session, "tab", "list"),
	).data;
	assert.equal(remaining.length, 2);
	assert(
		!remaining.some(({ tabId }: { tabId: string }) => tabId === popup.tabId),
	);
}

async function checkTemplate(url: string) {
	const login = JSON.parse(
		await run("--json", "template", "login", "saved", "--url", url),
	).data;
	assert.equal(login.state, "in_progress");
	sessions.add(login.loginSession);
	await clickCheck(login.loginSession);
	await run(
		"--session",
		login.loginSession,
		"eval",
		'document.cookie = "boathook_import=fixture; Max-Age=3600; Path=/"',
	);
	const saved = JSON.parse(
		await run(
			"--json",
			"template",
			"save",
			"saved",
			"--from-session",
			login.loginSession,
		),
	).data;
	assert.equal(saved.state, "unchecked");
	const listed = JSON.parse(await run("--json", "template", "ls")).data;
	assert.equal(listed[0].version, saved.version);
	sessions.add("derived");
	const failed = await command([
		"--json",
		"start",
		"derived",
		"--template",
		"saved",
		"--config-json",
		'{"login":{"check":"./missing-check.ts"}}',
	]);
	assert.equal(JSON.parse(failed.out).error.code, "LOGIN_CHECK_NOT_FOUND");
	const failedStatus = await command(["--json", "status", "derived"]);
	assert.equal(JSON.parse(failedStatus.out).error.code, "SESSION_NOT_FOUND");
	assert(
		!(await Bun.file(
			join(state, "sessions", storageId("derived"), "profile", "Local State"),
		).exists()),
	);
	const derived = JSON.parse(
		await run(
			"--json",
			"start",
			"derived",
			"--template",
			"saved",
			"--url",
			new URL("/chosen", url).href,
			"--config-json",
			JSON.stringify({ url: new URL("/configured", url).href }),
		),
	).data;
	assert.equal(derived.templateVersion, saved.version);
	assert.equal(await run("--session", "derived", "title"), "Smoke restored");
	assert.equal(await run("--session", "qb", "title"), "Smoke ready");
	await run("stop", "derived");
	await run("session", "reseed", "derived", "--template", "saved", "--yes");
	await run("start", "derived");
	assert.equal(await run("--session", "derived", "title"), "Smoke restored");
	assert.equal(
		await run("--session", "derived", "url"),
		new URL("/chosen", url).href,
	);
	await run("stop", "derived");
	await run("session", "rm", "derived", "--yes");
	assert.equal((await command(["status", "derived"])).code, 2);
}

function loginConfig(expected = "yes") {
	return JSON.stringify({
		login: { check: "./login-check.ts", input: { expected } },
	});
}

async function checkVerifiedTemplate(url: string) {
	const failed = await command([
		"--json",
		"template",
		"login",
		"verified",
		"--config-json",
		loginConfig(),
		"--url",
		url,
	]);
	assert.equal(JSON.parse(failed.out).error.code, "LOGIN_CHECK_NOT_FOUND");
	const missing = await command(["--json", "template", "status", "verified"]);
	assert.equal(JSON.parse(missing.out).error.code, "TEMPLATE_NOT_FOUND");
	await writeFile(
		join(scratch, "login-check.ts"),
		`
		export default async ({ page, input }) => ({
			state: await page.evaluate(() => localStorage.clicked) === input.expected ? "ready" : "needs_user_auth"
		});`,
	);
	const task = JSON.parse(
		await run(
			"--json",
			"template",
			"login",
			"verified",
			"--config-json",
			loginConfig(),
			"--url",
			url,
		),
	).data;
	sessions.add(task.loginSession);
	assert.equal(task.state, "needs_user_auth");
	const save = [
		"--json",
		"template",
		"save",
		"verified",
		"--from-session",
		task.loginSession,
	];
	const pending = await command(save);
	assert.equal(JSON.parse(pending.out).error.code, "NEEDS_LOGIN");
	await clickCheck(task.loginSession);
	assert.equal(
		JSON.parse(await run("--json", "template", "status", "verified")).data
			.state,
		"ready",
	);
	assert.equal(JSON.parse(await run(...save)).data.state, "ready");
	sessions.add("verified-derived");
	await run(
		"start",
		"verified-derived",
		"--template",
		"verified",
		"--config-json",
		loginConfig(),
	);
	assert.equal(
		await run("--session", "verified-derived", "title"),
		"Smoke restored",
	);
	await run("template", "rm", "verified", "--yes");
	assert.equal(
		await run("--session", "verified-derived", "title"),
		"Smoke restored",
	);
}

async function checkImportedTemplate(url: string) {
	function profilePath(name: string, version: string) {
		return join(
			state,
			"templates",
			storageId(name),
			"versions",
			version,
			"profile",
		);
	}
	const { data: saved } = JSON.parse(
		await run("--json", "template", "status", "saved"),
	);
	const seed = profilePath("saved", saved.version);
	const directory = "chrome profile copy";
	const source = join(scratch, directory);
	const named = "Profile 2";
	await mkdir(join(source, named), { recursive: true });
	await writeFile(join(source, named, "Preferences"), "{}");
	await cp(join(seed, "Default"), join(source, "Default"), { recursive: true });
	await mkdir(join(source, "Default", "Cache"), { recursive: true });
	await writeFile(join(source, "Default", "Cache", "fixture"), "cached");
	const sourceState = JSON.parse(
		await readFile(join(seed, "Local State"), "utf8"),
	);
	const localState = JSON.stringify({
		...sourceState,
		profile: {
			...sourceState.profile,
			last_used: named,
			last_active_profiles: ["Default", named],
		},
	});
	await writeFile(join(source, "Local State"), localState);

	const save = ["template", "save", "imported", "--from", directory];
	for (const [args, expected] of [
		[
			["template", "save", "invalid", "--from", join(directory, "Default")],
			"INVALID_PROFILE",
		],
		[[...save, "--from-session", "qa"], "INVALID_OPTIONS"],
	] as const) {
		const result = await command(["--json", ...args]);
		assert.equal(JSON.parse(result.out).error.code, expected, result.out);
	}
	const withUrl = [...save, "--url", url];
	const { data: imported } = JSON.parse(
		await run("--json", ...withUrl, "--config-json", loginConfig()),
	);
	assert.equal(imported.state, "ready");
	assert.equal(imported.url, url);
	const snapshot = profilePath("imported", imported.version);
	assert.deepEqual((await readdir(snapshot)).sort(), [
		"Default",
		"Local State",
	]);
	const files = await readdir(join(snapshot, "Default"));
	assert(files.includes("Local Storage"));
	assert(!files.includes("Cache"));
	assert(!files.includes("History"));
	assert.equal(await readFile(join(source, "Local State"), "utf8"), localState);

	const session = "imported-derived";
	sessions.add(session);
	await run("start", session, "--template", "imported");
	assert.equal(await run("--session", session, "url"), url);
	assert.equal(await run("--session", session, "title"), "Smoke restored");
	assert.match(
		await run("--session", session, "eval", "document.cookie"),
		/boathook_import=fixture/,
	);
	await run("stop", session);

	const rejected = await command([
		"--json",
		...withUrl,
		"--replace",
		"--config-json",
		loginConfig("missing"),
	]);
	assert.equal(JSON.parse(rejected.out).error.code, "NEEDS_LOGIN");
	const { data: current } = JSON.parse(
		await run("--json", "template", "status", "imported"),
	);
	assert.equal(current.version, imported.version);

	const { data: noUrl } = JSON.parse(
		await run("--json", "template", "save", "no-url", "--from", directory),
	);
	assert.equal(noUrl.state, "unchecked");
	assert.equal(noUrl.url, undefined);
	console.log(
		"PASS: Chrome profile import copies Default login files, restores login and the template URL, and keeps the previous template on verification failure",
	);
}

async function checkPlugin(url: string) {
	const cleanupReceipt = join(scratch, "fixture-cleanup.txt");
	const imports = join(scratch, "fixture-imports.txt");
	await writeFile(
		join(scratch, "observer-plugin.ts"),
		`export default {
			name: "observer", version: "0.1.0", apiVersion: 1,
			hooks: {
				async beforeCommand(_command, { sessionState }) { sessionState.label = "observer"; },
				async afterCommand(command) { if (command === "title") throw new Error("observer failed"); },
			},
		};`,
	);
	await writeFile(
		join(scratch, "fixture-plugin.ts"),
		`import { appendFileSync } from "node:fs";
		appendFileSync(${JSON.stringify(imports)}, String(process.pid) + ${JSON.stringify("\n")});
 export default {
			name: "fixture", version: "0.1.0", apiVersion: 1,
			validateRuntime(options) { if (options.fail) throw new Error("candidate rejected"); },
			hooks: {
				async init(_config, { options, capabilities, sessionState }) {
					Object.assign(sessionState, { label: options.label, capabilities, before: 0, after: 0 });
				},
				async prepareContext(context, options, { url, sessionState }) {
					sessionState.ready = true;
					await context.addInitScript(({ label, url }) => {
						window.bcContext = label;
						window.bcEntry = url;
					}, { label: options.label, url });
				},
				async preparePage(page) {
					await page.addInitScript(() => { window.bcPage = "page prepared"; });
				},
				async beforeCommand(command, { sessionState }) {
					if (command === "title") sessionState.before++;
				},
				async afterCommand(command, { sessionState }) {
					if (command === "title") sessionState.after++;
				},
				async cleanup({ sessionState }) {
					await Bun.write(${JSON.stringify(cleanupReceipt)}, String(sessionState.before));
				},
			},
			commands: [{
				name: "show page", summary: "Read the title", usage: "boathook plugin fixture show page",
				async handler({ page }) { return { ok: true, data: await page.title() }; },
			}, {
				name: "scope", summary: "Read plugin state", usage: "boathook plugin fixture scope",
				async handler({ sessionState, capabilities, options }) {
					const { label, before, after, ready } = sessionState;
					const shared = sessionState.capabilities === capabilities
						&& Boolean(capabilities?.networkRules) && label === options.label;
					return { ok: true, data: JSON.stringify({ label, before, after, ready, shared }) };
				},
			}],
		};`,
	);
	await writeFile(
		join(scratch, "report-plugin.ts"),
		`import { defineCommand } from ${JSON.stringify(join(repo, "packages/plugin-sdk/src/index.ts"))};
		import { z } from ${JSON.stringify(Bun.resolveSync("incur", repo))};
		export default {
			name: "report", version: "0.1.0", apiVersion: 1,
			commands: [defineCommand({
				name: "export", summary: "Select a report format",
				usage: "boathook --session NAME plugin report export --format xml|json",
				flags: z.object({ format: z.enum(["xml", "json"]) }),
				run: ({ input }) => ({ format: input.options.format }),
			})],
		};`,
	);
	const settings = {
		url,
		plugins: [
			{ id: "observer", entry: "./observer-plugin.ts" },
			{ id: "report", entry: "./report-plugin.ts" },
			{
				id: "fixture",
				entry: "./fixture-plugin.ts",
				options: { label: "context prepared" },
			},
		],
	};
	const config = JSON.stringify(settings);
	sessions.add("with-plugin");
	await run("start", "with-plugin", "--config-json", config);
	const bootImports = await readFile(imports, "utf8");
	assert.equal(bootImports.trim().split("\n").length, 1);
	await run("start", "with-plugin", "--config-json", config);
	assert.equal(await readFile(imports, "utf8"), bootImports);
	const invalid = JSON.stringify({
		plugins: [
			{
				id: "fixture",
				entry: "./fixture-plugin.ts",
				options: { fail: true },
			},
		],
	});
	const beforeRestart = JSON.parse(
		await run("--json", "status", "with-plugin"),
	).data;
	const rejected = await command([
		"--json",
		"restart",
		"with-plugin",
		"--config-json",
		invalid,
	]);
	assert.notEqual(rejected.code, 0);
	assert.match(rejected.out, /candidate rejected/);
	const afterRestart = JSON.parse(
		await run("--json", "status", "with-plugin"),
	).data;
	assert.equal(afterRestart.pid, beforeRestart.pid);
	assert.equal(afterRestart.state, "running");
	const scoped = ["--session", "with-plugin"];
	const exportReport = ["plugin", "report", "export", "--format"];
	assert.deepEqual(
		JSON.parse(
			await run(...scoped, "--format", "json", ...exportReport, "xml"),
		),
		{
			ok: true,
			command: "plugin report export",
			session: "with-plugin",
			data: { format: "xml" },
		},
	);
	const invalidTimeout = await command([
		...scoped,
		"--timeout",
		"bad",
		...exportReport,
		"json",
	]);
	assert.equal(invalidTimeout.code, 2);
	assert.equal(invalidTimeout.out, "");
	assert.match(invalidTimeout.err, /^INVALID_ARGUMENTS:/);
	assert.deepEqual(JSON.parse(await run(...scoped, ...exportReport, "json")), {
		format: "json",
	});
	console.log("PASS: host and plugin output formats are parsed independently");
	const discovered = JSON.parse(
		await run("--json", ...scoped, "--llms-full"),
	).data;
	assert(
		discovered.commands.some(
			({ name }: { name: string }) => name === "plugin fixture show page",
		),
	);
	const stale = await command([
		"--json",
		...scoped,
		"--snapshot-id",
		"stale",
		"plugin",
		"fixture",
		"show",
		"page",
	]);
	assert.equal(stale.code, 2, stale.out);
	assert.equal(JSON.parse(stale.out).command, "plugin fixture show page");
	assert.equal(JSON.parse(stale.out).error.code, "STALE_REF");
	async function scope(session: string) {
		return JSON.parse(
			await run("--json", "--session", session, "plugin", "fixture", "scope"),
		).data;
	}
	assert.equal(
		await run(...scoped, "plugin", "fixture", "show", "page"),
		"context prepared/page prepared",
	);
	await run(...scoped, "tab", "new", url);
	assert.equal(await run(...scoped, "title"), "context prepared/page prepared");
	await run(...scoped, "title");
	const observed = {
		label: "context prepared",
		before: 2,
		after: 2,
		ready: true,
		shared: true,
	};
	assert.deepEqual(await scope("with-plugin"), observed);
	sessions.add("with-plugin-peer");
	await run("start", "with-plugin-peer", "--config-json", config);
	assert.deepEqual(await scope("with-plugin-peer"), {
		...observed,
		before: 0,
		after: 0,
	});
	await run("--session", "with-plugin-peer", "title");
	assert.deepEqual(await scope("with-plugin-peer"), {
		...observed,
		before: 1,
		after: 1,
	});
	assert.deepEqual(await scope("with-plugin"), observed);
	const enabled = JSON.parse(
		await run("--json", ...scoped, "plugin", "ls"),
	).data;
	assert.deepEqual(
		enabled.map(({ id }: { id: string }) => id),
		["observer", "report", "fixture"],
	);
	const isolated = JSON.parse(
		await run("--json", "--session", "qb", "plugin", "ls"),
	).data;
	assert.deepEqual(isolated, []);
	const oldTabs = JSON.parse(
		await run("--json", ...scoped, "tab", "list"),
	).data;
	const nextUrl = new URL("/updated-entry", url).href;
	const nextConfig = JSON.stringify({ ...settings, url: nextUrl });
	const restarted = JSON.parse(
		await run("--json", "restart", "with-plugin", "--config-json", nextConfig),
	).data;
	assert.equal(restarted.activeUrl, nextUrl);
	assert.equal(await Bun.file(cleanupReceipt).text(), "2");
	assert.deepEqual(await scope("with-plugin"), {
		...observed,
		before: 0,
		after: 0,
	});
	assert.equal(
		await run(...scoped, "eval", "document.body.dataset.entry"),
		nextUrl,
	);
	const tabs = JSON.parse(await run("--json", ...scoped, "tab", "list")).data;
	assert.equal(tabs[0].url, url);
	assert.equal(tabs[1].url, nextUrl);
	assert.equal(tabs[1].active, true);
	assert.deepEqual(
		tabs.map(({ tabId }: { tabId: string }) => tabId),
		oldTabs.map(({ tabId }: { tabId: string }) => tabId),
	);
}

async function checkRollback(url: string) {
	const name = "rollback-test";
	const entry = join(scratch, "rollback-plugin.ts");
	await writeFile(
		entry,
		`
		let value;
		export default { name: "rollback-fixture", version: "0.1.0", apiVersion: 1,
			hooks: {
				async init(_config, { options }) {
					if (options.value === "fail-init") throw Error("test restart init failure");
					value = options.value;
				},
				async updateOptions(_context, options) {
					if (options.value === "reject") throw Error("test update rejection");
					const previous = value;
					value = options.value;
					return async () => { value = previous; };
				}
			},
			commands: [{ name: "value", summary: "Read value", usage: "value",
				async handler() { return { ok: true, data: JSON.stringify(value) }; }
			}, { name: "set", summary: "Set value", usage: "set VALUE",
				async configure([value]) { return { options: { value }, data: value }; }
			}],
		};`,
	);
	const config = JSON.stringify({
		url,
		plugins: [{ id: "rollback-fixture", entry, options: { value: "old" } }],
	});
	sessions.add(name);
	await run("start", name, "--config-json", config);
	const scoped = ["--session", name];
	const plugin = [...scoped, "plugin", "rollback-fixture"];
	const inspect = async () =>
		JSON.parse(await run("--json", ...scoped, "config", "inspect")).data;
	const original = await inspect();
	const value = async () =>
		JSON.parse(await run("--json", ...plugin, "value")).data;
	assert.equal(await value(), "old");
	await run(...plugin, "set", "saved");
	assert.equal(await value(), "saved");
	const saved = await inspect();
	assert.notEqual(saved.revision, original.revision);
	const persisted = await Bun.file(saved.path).text();
	const failed = await command(["--json", ...plugin, "set", "reject"]);
	assert.notEqual(failed.code, 0);
	assert.match(failed.out, /test update rejection/);
	assert.equal(await value(), "saved");
	assert.equal(await Bun.file(saved.path).text(), persisted);
	await run("restart", name);
	assert.equal(await value(), "saved");

	await run(...scoped, "tab", "new", new URL("/saved-tab", url).href);
	await run(...scoped, "eval", 'localStorage.setItem("restart-test", "kept")');
	const tabs = async () =>
		JSON.parse(await run("--json", ...scoped, "tab", "list")).data;
	const savedTabs = await tabs();
	const badRestart = await command([
		"--json",
		"restart",
		name,
		"--config-json",
		JSON.stringify({
			url: new URL("/failed-replacement", url).href,
			plugins: [
				{ id: "rollback-fixture", entry, options: { value: "fail-init" } },
			],
		}),
	]);
	assert.equal(badRestart.code, 1, badRestart.out);
	const { error } = JSON.parse(badRestart.out);
	assert.equal(error.code, "PLUGIN_INIT_FAILED");
	assert.match(error.message, /已用原配置恢复会话/);
	const recovered = await inspect();
	assert.equal(recovered.state, "running");
	assert.equal(recovered.revision, saved.revision);
	assert.deepEqual(await tabs(), savedTabs);
	assert.equal(await value(), "saved");
	assert.equal(
		await run(...scoped, "eval", 'localStorage.getItem("restart-test")'),
		"kept",
	);
	await run(
		...scoped,
		"page-eval",
		"await Promise.all(page.context().pages().map(tab => tab.close())); return true;",
	);
	const missingTab = await command(["--json", ...scoped, "title"]);
	assert.equal(JSON.parse(missingTab.out).error.code, "TAB_GONE");
	const enabled = JSON.parse(
		await run("--json", ...scoped, "plugin", "ls"),
	).data;
	assert.equal(enabled[0].id, "rollback-fixture");
	await run(...plugin, "set", "changed-without-page");
	const inspected = JSON.parse(
		await run(
			"--json",
			...scoped,
			"config",
			"inspect",
			"--plugin",
			"rollback-fixture",
		),
	).data;
	assert.deepEqual(inspected.plugin.options, { value: "changed-without-page" });
	console.log(
		"PASS: plugin configuration is persisted and a failed restart restores the previous session",
	);
}

async function checkInstalledPlugin(url: string) {
	for (const source of ["demo@bad^range", "demo@npm:other@1.0.0"]) {
		const invalid = await command(["--json", "plugin", "install", source]);
		assert.equal(JSON.parse(invalid.out).error.code, "INVALID_PLUGIN_SOURCE");
	}
	const importTrace = join(scratch, "installed-plugin-imports.txt");
	const directory = join(scratch, "fixture-package");
	await mkdir(directory);
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			name: "boathook-smoke-package",
			version: "0.1.0",
			type: "module",
			exports: "./index.js",
		}),
	);
	await writeFile(
		join(directory, "probe.js"),
		'export const prefix = "Bundled dependency";',
	);
	await writeFile(
		join(directory, "index.js"),
		`
		import { appendFileSync } from "node:fs";
		import { prefix } from "./probe.js";
		appendFileSync(${JSON.stringify(importTrace)}, "loaded ");
		export default {
			name: "installed-fixture", version: "0.1.0", apiVersion: 1,
			commands: [{ name: "title", summary: "Read the title", usage: "plugin installed-fixture title",
				async handler({ page }) { return { ok: true, data: prefix + ": " + await page.title() }; }
			}]
		};`,
	);
	const installed = JSON.parse(
		await run("--json", "plugin", "install", directory),
	).data;
	assert.equal(installed.id, "installed-fixture");
	assert.equal(installed.version, "0.1.0");
	await rename(directory, join(scratch, "moved-fixture-package"));
	const missingEntry = {
		id: "stale-fixture",
		version: "0.1.0",
		entry: join(scratch, "missing-plugin.js"),
		source: "stale-fixture",
		commands: [],
	};
	const index = join(state, "plugins", "installed.json");
	const records = await Bun.file(index).json();
	await writeFile(index, JSON.stringify([...records, missingEntry]));
	const beforeDiscovery = await Bun.file(importTrace).text();
	const listed = JSON.parse(await run("--json", "plugin", "ls")).data;
	assert(listed.some(({ id }: { id: string }) => id === "installed-fixture"));
	assert(listed.some(({ id }: { id: string }) => id === missingEntry.id));
	const help = JSON.parse(
		await run("--json", "plugin", installed.id, "help", "title"),
	).data;
	assert.deepEqual(
		help.commands.map(({ path }: { path: string[] }) => path),
		[["title"]],
	);
	assert.equal(await Bun.file(importTrace).text(), beforeDiscovery);
	sessions.add("global-plugin");
	await run(
		"start",
		"global-plugin",
		"--url",
		url,
		"--config-json",
		JSON.stringify({ plugins: [{ id: installed.id }] }),
	);
	const scoped = ["--session", "global-plugin"];
	assert.equal(
		await run(...scoped, "plugin", "installed-fixture", "title"),
		"Bundled dependency: Smoke ready",
	);
	await run("restart", "global-plugin", "--config-json", "{}");
	const updated = JSON.parse(
		await run("--json", ...scoped, "plugin", "ls"),
	).data;
	assert.deepEqual(updated, []);
	await rename(installed.entry, `${installed.entry}.moved`);
	assert.deepEqual(
		JSON.parse(await run("--json", "plugin", installed.id, "help", "title"))
			.data,
		help,
	);
}

try {
	await checkOfflineQueries();
	const flows = join(state, "flows");
	await mkdir(flows, { recursive: true });
	await writeFile(
		join(flows, "fixture.json"),
		JSON.stringify({
			steps: [{ assert: { visible: "button" } }, { screenshot: true }],
		}),
	);
	await checkSessions(fixture.url.href);
	await checkIdleShutdown(fixture.url.href);
	await checkDispatch();
	await checkPaths();
	await checkFlow();
	await checkCommandConfig(fixture.url.href);
	await checkRun();
	await checkTemplate(fixture.url.href);
	await checkVerifiedTemplate(fixture.url.href);
	await checkImportedTemplate(fixture.url.href);
	await checkPlugin(fixture.url.href);
	await checkRollback(fixture.url.href);
	await checkInstalledPlugin(fixture.url.href);
	await checkTabs();
	console.log(
		"PASS: offline queries, sessions, idle shutdown, deadlines, tabs, templates, scripts, config rollback, plugin scopes and discovery",
	);
} catch (error) {
	const dirs = await readdir(join(state, "sessions")).catch(() => []);
	for (const dir of dirs) {
		const log = await readFile(
			join(state, "sessions", dir, "daemon.log"),
			"utf8",
		).catch(() => "");
		if (log) console.error(log.slice(-2500));
	}
	throw error;
} finally {
	const stopped = await Promise.all(
		[...sessions].map((name) => command(["--json", "stop", name])),
	);
	fixture.stop(true);
	if (
		stopped.every(
			({ code, out }) => code === 0 || out.includes('"SESSION_NOT_FOUND"'),
		)
	) {
		await rm(scratch, { recursive: true, force: true });
	} else {
		console.error(`测试会话仍在关闭，保留诊断目录 ${scratch}`);
		process.exitCode = 1;
	}
}
