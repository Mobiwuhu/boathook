// Usage: bun run test:network
// Build the CLI and headers plugin first. Requires Chrome and openssl.
// BOATHOOK_SMOKE_CHROME selects a Chrome executable. All traffic is loopback.
import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const launcher =
	process.env.BOATHOOK_SMOKE_BINARY ?? join(repo, "dist/boathook");
const scratch = await mkdtemp(join(tmpdir(), "bc-network-smoke-"));
const probe = join(scratch, "probe.ts");
const peer = join(scratch, "network-peer.ts");
const env = {
	...process.env,
	BOATHOOK_STATE_DIR: join(scratch, "state"),
	BOATHOOK_CHROME_EXECUTABLE:
		process.env.BOATHOOK_SMOKE_CHROME ?? process.env.BOATHOOK_CHROME_EXECUTABLE,
};
const sessions = ["plain", "qa", "qb"];
const headers = ["x-qa-route", "x-qa-enabled", "x-qa-peer"];
const initial = ["preview_fixture", "1", "peer"];
const other = ["alternate_fixture", null, "peer"];
const empty = [null, null, null];
const visits = new Map<string, (string | null)[]>();
type ReceivedHeaders = (string | null)[];

function fixture(tls?: { cert: Bun.BunFile; key: Bun.BunFile }) {
	return Bun.serve<ReceivedHeaders>({
		hostname: "127.0.0.1",
		port: 0,
		tls,
		fetch(request, server) {
			const received = headers.map((name) => request.headers.get(name));
			const { pathname } = new URL(request.url);
			if (pathname === "/socket" && server.upgrade(request, { data: received }))
				return;
			if (pathname.startsWith("/page/")) {
				visits.set(pathname, received);
				return new Response("<!doctype html><title>Network fixture</title>", {
					headers: { "content-type": "text/html" },
				});
			}
			return Response.json(received, {
				headers: { "access-control-allow-origin": "*" },
			});
		},
		websocket: {
			open(socket) {
				socket.send(JSON.stringify(socket.data));
			},
			message(socket, message) {
				socket.send(message);
			},
		},
	});
}

async function command(...args: string[]) {
	const child = Bun.spawn([launcher, ...args], {
		cwd: scratch,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function run(...args: string[]) {
	const result = await command(...args, "--json");
	assert.equal(result.code, 0, JSON.stringify({ args, ...result }));
	return JSON.parse(result.stdout).data;
}

const plain = fixture();
let secure: ReturnType<typeof fixture> | undefined;
try {
	const key = join(scratch, "fixture.key");
	const cert = join(scratch, "fixture.crt");
	const generated = Bun.spawnSync([
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-keyout",
		key,
		"-out",
		cert,
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost,IP:127.0.0.1",
	]);
	assert.equal(generated.exitCode, 0, generated.stderr.toString());
	secure = fixture({ cert: Bun.file(cert), key: Bun.file(key) });
	const ports = { http: plain.port, https: secure.port };
	await Bun.write(
		peer,
		`
export default {
  name: "network-peer", version: "1.0.0", apiVersion: 1,
  hooks: {
    async prepareContext(_context, _options, { capabilities }) {
      await capabilities.networkRules.replace([{
        condition: { resourceTypes: ["main_frame", "xmlhttprequest", "websocket"] },
        action: { type: "modifyHeaders", requestHeaders: [
          { header: "x-qa-peer", operation: "set", value: "peer" },
        ] },
      }]);
    },
  },
  commands: [{
    name: "clear", summary: "Clear this plugin's rules", usage: "plugin network-peer clear",
    async handler({ capabilities }) {
      await capabilities.networkRules.replace([]);
      return { ok: true, data: "true" };
    },
  }],
};
`,
	);
	await Bun.write(
		probe,
		`
export default async ({ page, context, input }) => {
  const cdp = await context.newCDPSession(page);
  const errors = [];
  try {
    await context.grantPermissions(["local-network-access"], { origin: new URL(page.url()).origin });
    await cdp.send("Security.setIgnoreCertificateErrors", { ignore: true });
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketFrameError", ({ errorMessage }) => errors.push(errorMessage));
    cdp.on("Network.loadingFailed", ({ errorText }) => errors.push(errorText));
    return await page.evaluate(async ({ ports, host, path }) => {
      const url = (scheme, port, path) => scheme + "://" + host + ":" + port + path;
      const fetchHeaders = async (scheme, port) => (await fetch(url(scheme, port, path))).json();
      const handshake = (scheme, port) => new Promise((resolve, reject) => {
        const socket = new WebSocket(url(scheme, port, "/socket"));
        const timeout = setTimeout(() => { socket.close(); reject(new Error("Handshake timed out")); }, 4000);
        socket.onmessage = ({ data }) => { clearTimeout(timeout); socket.close(); resolve(JSON.parse(data)); };
        socket.onerror = () => { clearTimeout(timeout); reject(new Error("Handshake failed for " + scheme + "://" + host)); };
      });
      return Promise.all([
        fetchHeaders("http", ports.http), fetchHeaders("https", ports.https),
        handshake("ws", ports.http), handshake("wss", ports.https),
      ]);
    }, input);
  } catch (error) {
    throw new Error(error.message + " " + errors.join(", "));
  } finally {
    await cdp.detach();
  }
};
`,
	);
	const config = JSON.stringify({
		plugins: [
			{
				id: "headers",
				entry: join(repo, "packages/headers/dist/index.js"),
				options: {
					set: { "x-qa-route": "preview_fixture", "x-qa-enabled": "1" },
				},
			},
			{ id: "network-peer", entry: peer },
		],
	});
	const start = (name: string, ...args: string[]) =>
		run(
			"start",
			name,
			"--url",
			`http://127.0.0.1:${ports.http}/page/${name}`,
			...args,
		);
	const session = (name: string, ...args: string[]) =>
		run("--session", name, ...args);
	const changed = (...args: string[]) =>
		session("qa", "plugin", "headers", ...args);
	async function verifyTraffic(
		name: string,
		host: string,
		expected: ReceivedHeaders,
	) {
		const data = await session(
			name,
			"run",
			probe,
			"--input-json",
			JSON.stringify({ ports, host, path: "/headers/localhost" }),
		);
		assert.deepEqual(
			data,
			[expected, expected, expected, expected],
			`HTTP/HTTPS/WS/WSS on ${name} to ${host}`,
		);
	}

	await start("plain");
	assert.deepEqual(visits.get("/page/plain"), empty);
	await start("qa", "--config-json", config);
	assert.deepEqual(visits.get("/page/qa"), initial);
	const invalid = JSON.parse(config);
	invalid.plugins[0].options.scope = { hostRegex: ["(?=localhost)"] };
	const badConfig = JSON.stringify(invalid);
	const active = await session("qa", "status");
	for (const args of [
		["config", "validate"],
		["restart", "qa"],
	]) {
		const rejected = await command(
			...args,
			"--config-json",
			badConfig,
			"--json",
		);
		assert.notEqual(rejected.code, 0);
		assert.equal(
			JSON.parse(rejected.stdout).error.code,
			"HEADER_REGEX_UNSUPPORTED",
		);
	}
	assert.equal((await session("qa", "status")).pid, active.pid);
	console.log(
		"PASS: invalid header regex is rejected before stopping the existing daemon",
	);
	await verifyTraffic("qa", "127.0.0.1", initial);
	await verifyTraffic("plain", "127.0.0.1", empty);
	const diagnostics = await Promise.all(
		["http", "ws"].map((transport) =>
			command(
				"--session",
				"qa",
				"plugin",
				"headers",
				"verify",
				"--host",
				"127.0.0.1",
				"--transport",
				transport,
				"--json",
			),
		),
	);
	await changed("scope", "add", "--host", "127.0.0.1");
	await changed("replace", "--header", "x-qa-route=alternate_fixture");
	await verifyTraffic("qa", "127.0.0.1", other);
	await verifyTraffic("qa", "localhost", [null, null, "peer"]);
	const before = await changed("list");
	const savedBefore = await session("qa", "config", "inspect");
	const result = await command(
		"--session",
		"qa",
		"plugin",
		"headers",
		"scope",
		"add",
		"--regex",
		"(?=localhost)",
		"--json",
	);
	assert.equal(
		JSON.parse(result.stdout).error.code,
		"HEADER_REGEX_UNSUPPORTED",
		JSON.stringify(result),
	);
	assert.deepEqual(await changed("list"), before);
	assert.equal(
		(await session("qa", "config", "inspect")).revision,
		savedBefore.revision,
	);
	await changed("scope", "add", "--regex", "(^|\\.)localhost$");
	await changed("scope", "remove", "--host", "127.0.0.1");
	await verifyTraffic("qa", "127.0.0.1", [null, null, "peer"]);
	await verifyTraffic("qa", "localhost", other);
	await start("qb", "--config-json", config);
	assert.deepEqual(visits.get("/page/qb"), initial);
	await session("qa", "plugin", "network-peer", "clear");
	await verifyTraffic("qa", "localhost", ["alternate_fixture", null, null]);
	await verifyTraffic("qb", "localhost", initial);
	await changed("replace", "--header", "x-qa-route=saved_fixture");
	const current = await session(
		"qa",
		"config",
		"inspect",
		"--plugin",
		"headers",
	);
	const { path } = current;
	const saved = await Bun.file(path).json();
	assert.deepEqual(
		current.plugin,
		saved.config.plugins.find((spec) => spec.id === "headers"),
	);
	assert.deepEqual(current.plugin.options.set, {
		"x-qa-route": "saved_fixture",
	});
	assert.equal(current.state, "running");
	assert((await lstat(current.socketPath)).isSocket());
	await verifyTraffic("qa", "localhost", ["saved_fixture", null, null]);
	await verifyTraffic("qb", "localhost", initial);
	await run("stop", "qa");
	const stopped = await session(
		"qa",
		"config",
		"inspect",
		"--plugin",
		"headers",
	);
	assert.equal(stopped.state, "stopped");
	assert.equal(stopped.path, path);
	assert.equal(stopped.socketPath, undefined);
	assert.deepEqual(stopped.plugin, current.plugin);
	await run("start", "qa");
	await verifyTraffic("qa", "localhost", ["saved_fixture", null, "peer"]);
	for (const result of diagnostics)
		assert.equal(result.code, 0, JSON.stringify(diagnostics));
	console.log(
		"PASS: first navigation, HTTP/HTTPS/WS/WSS scope, header replacement, saved session options, atomic failure, shared plugin rules, and session reopen",
	);
} catch (error) {
	const directory = join(scratch, "state/sessions");
	for (const id of await readdir(directory).catch(() => [])) {
		const log = await Bun.file(join(directory, id, "daemon.log"))
			.text()
			.catch(() => "");
		if (log.trim()) console.error(log.trim());
	}
	throw error;
} finally {
	await Promise.all(sessions.map((name) => command("stop", name)));
	await plain.stop(true);
	await secure?.stop(true);
	await rm(scratch, { recursive: true, force: true });
}
