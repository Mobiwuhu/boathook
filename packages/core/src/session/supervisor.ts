import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { CommandError, isCommandError } from "@boathook/plugin-sdk";
import { copyProfile } from "../browser/profile.ts";
import {
	configSummary,
	resolveConfig,
	type SessionConfig,
} from "../config/session.ts";
import { shutdownCommand } from "../ipc/protocol.ts";
import { compiledExecutable } from "../runtime.ts";
import { withTimeout } from "../timeout.ts";
import { withPathLock } from "./lock.ts";
import { requireLogin } from "./login-check.ts";
import { type NavigationPlan, planNavigation } from "./navigation.ts";
import {
	prepareSessionDirectories,
	type SessionPaths,
	sessionPaths,
} from "./paths.ts";
import { checkStalePid, DEFAULT_SESSION_IDLE_SECONDS } from "./process.ts";
import { requireSession, running, sessionRequest } from "./request.ts";
import type { StartupResult } from "./startup.ts";
import {
	listSessionRecords,
	readSession,
	type SessionRecord,
	writeRecord,
} from "./store.ts";
import { readTabSnapshot } from "./tab-state.ts";
import { deriveTemplate } from "./templates.ts";

export type StartOptions = Partial<
	Omit<SessionRecord, "name" | "templateVersion">
>;

async function withSessionLock<T>(paths: SessionPaths, run: () => Promise<T>) {
	prepareSessionDirectories(paths);
	return withPathLock(paths.run, paths.lockPath, run);
}

async function inspect(paths: SessionPaths, record: SessionRecord) {
	const active = await running(paths);
	const { config, ...session } = record;
	const snapshot = readTabSnapshot(paths.statePath);
	return {
		...session,
		activeUrl: snapshot?.tabs[snapshot.activeTabIndex]?.url,
		config: { path: paths.sessionPath, ...configSummary(config) },
		state: active ? ("running" as const) : ("stopped" as const),
		pid: active?.pid,
	};
}

async function inspectStarted(paths: SessionPaths, record: SessionRecord) {
	if (record.template && record.config?.login)
		await requireLogin(record.name, record.config.login);
	return inspect(paths, record);
}

export async function listSessions(onlyRunning: boolean) {
	const records = await listSessionRecords();
	const sessions = await Promise.all(
		records.map((record) => inspect(sessionPaths(record.name), record)),
	);
	return onlyRunning
		? sessions.filter(({ state }) => state === "running")
		: sessions;
}

export async function sessionStatus(name: string) {
	const paths = sessionPaths(name);
	return inspect(paths, await requireSession(paths, name));
}

async function launch(
	paths: SessionPaths,
	record: SessionRecord,
	navigation: () => NavigationPlan | Promise<NavigationPlan>,
): Promise<void> {
	const id = randomUUID();
	const args = compiledExecutable ? [] : [Bun.main];
	const log = openSync(paths.logPath, "a", 0o600);
	const prepared = Promise.withResolvers<StartupResult>();
	let failure: Extract<StartupResult, { ok: false }> | undefined;
	let child: Bun.Subprocess;
	try {
		child = Bun.spawn([process.execPath, ...args, "--boathook-daemon"], {
			detached: true,
			stdin: new TextEncoder().encode(JSON.stringify({ id, record })),
			stdout: log,
			stderr: log,
			env: { ...process.env, BOATHOOK_ARTIFACT_DIR: paths.artifactsPath },
			ipc(message: StartupResult) {
				if (!message.ok) failure = message;
				prepared.resolve(message);
			},
		});
		child.unref();
	} finally {
		closeSync(log);
	}
	const failed = () =>
		failure
			? new CommandError(failure.code, failure.error, failure.exitCode)
			: new CommandError(
					"START_FAILED",
					`会话 ${record.name} 启动失败。请查看 ${paths.logPath}。`,
					1,
				);
	try {
		const ready = await withTimeout(
			() =>
				Promise.race([
					prepared.promise,
					child.exited.then(() => {
						throw failed();
					}),
				]),
			30_000,
		).catch(() => {
			throw failed();
		});
		if (!ready.ok)
			throw new CommandError(ready.code, ready.error, ready.exitCode);
		const plan = await navigation();
		if (checkStalePid(paths))
			throw new CommandError(
				"SESSION_BUSY",
				"此会话的浏览器正在启动或关闭，请稍后重试。",
				3,
			);
		child.send(plan);
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline && child.exitCode === null) {
			const active = await running(paths);
			if (active?.pid === child.pid && active.id === id) {
				child.disconnect();
				return;
			}
			await Bun.sleep(75);
		}
		throw failed();
	} catch (error) {
		if (child.exitCode === null) {
			child.kill("SIGTERM");
			await withTimeout(() => child.exited, 5_000).catch(() => {});
		}
		throw error;
	}
}

async function stopRunning(
	paths: SessionPaths,
	name: string,
): Promise<boolean> {
	const active = await running(paths);
	if (active) {
		const response = await sessionRequest(name, {
			cmd: shutdownCommand,
			args: [],
			timeout: 5_000,
		});
		if (!response.ok) {
			if (response.code === "COMMAND_NOT_STARTED")
				throw new CommandError("SESSION_BUSY", response.error, 3);
			throw new CommandError("STOP_FAILED", response.error, 1);
		}
	}
	await waitForBrowserShutdown(paths);
	return active !== null;
}

async function waitForBrowserShutdown(paths: SessionPaths): Promise<void> {
	const deadline = Date.now() + 10_000;
	const lifecycle = { ...paths, idleTimeoutMs: 0 };
	while (checkStalePid(lifecycle) && Date.now() < deadline) await Bun.sleep(50);
	if (checkStalePid(lifecycle)) {
		throw new CommandError(
			"SESSION_BUSY",
			"浏览器仍在关闭，请稍后查看 status。",
			3,
		);
	}
}

async function restartSession(
	paths: SessionPaths,
	record: SessionRecord,
	navigate: () => NavigationPlan,
	inheritConfig: boolean,
): Promise<void> {
	const retry = Symbol("session config updated while restarting");
	let previous:
		| { record: SessionRecord; navigation: NavigationPlan }
		| undefined;

	async function stopAndPlan(): Promise<NavigationPlan> {
		const stopped = await stopRunning(paths, record.name);
		if (!stopped && !inheritConfig) return navigate();
		const saved = await requireSession(paths, record.name);
		if (stopped) {
			previous = {
				record: saved,
				navigation: planNavigation(paths.statePath, saved.url, false),
			};
		}
		if (inheritConfig && saved.config.revision !== record.config.revision) {
			record.config = saved.config;
			throw retry;
		}
		return navigate();
	}

	try {
		await launch(paths, record, stopAndPlan).catch((error: unknown) => {
			if (error !== retry) throw error;
			return launch(paths, record, navigate);
		});
	} catch (error) {
		if (!previous) throw error;
		const { record: saved, navigation } = previous;
		const recoveryMessage = await launch(paths, saved, () => navigation).then(
			() => "已用原配置恢复会话。",
			() => `恢复原会话失败。请查看 ${paths.logPath}。`,
		);
		const failure = isCommandError(error) ? error : undefined;
		const message = error instanceof Error ? error.message : String(error);
		throw new CommandError(
			failure?.code ?? "COMMAND_FAILED",
			`${message} ${recoveryMessage}`,
			failure?.exitCode ?? 1,
		);
	}
}

export function startSession(
	name: string,
	options: StartOptions,
	restart = false,
) {
	const paths = sessionPaths(name);
	return withSessionLock(paths, async () => {
		const previous = restart
			? await requireSession(paths, name)
			: await readSession(paths.sessionPath);
		if (
			previous &&
			options.template &&
			previous.template !== options.template
		) {
			throw new CommandError(
				"TEMPLATE_MISMATCH",
				"这个会话已有独立 profile。请用新会话名从其他模板派生。",
			);
		}
		const config =
			options.config ??
			previous?.config ??
			(await resolveConfig({ plugins: [] }));
		const record: SessionRecord = {
			name,
			url:
				options.url ??
				(previous && !options.config
					? previous.url
					: (config.url ?? previous?.url)),
			headed: options.headed ?? previous?.headed ?? false,
			idleTimeout:
				options.idleTimeout ??
				previous?.idleTimeout ??
				DEFAULT_SESSION_IDLE_SECONDS,
			template: previous?.template,
			templateVersion: previous?.templateVersion,
			config,
		};
		if (!restart && previous && (await running(paths))) {
			if (
				record.url !== previous.url ||
				record.headed !== previous.headed ||
				record.idleTimeout !== previous.idleTimeout ||
				record.config.revision !== previous.config.revision
			) {
				throw new CommandError(
					"RESTART_REQUIRED",
					`会话 ${name} 已在运行，请用 restart 修改启动设置。`,
				);
			}
			return inspectStarted(paths, await requireSession(paths, name));
		}
		if (!restart) await waitForBrowserShutdown(paths);
		const newProfile = !previous && !existsSync(paths.profilePath);
		if (!previous && options.template) {
			const template = await deriveTemplate(
				options.template,
				paths.profilePath,
			);
			record.template = template.name;
			record.templateVersion = template.version;
			record.url ??= template.url;
		}
		const useEntry =
			options.url !== undefined ||
			(previous !== null &&
				options.config !== undefined &&
				record.url !== previous.url);
		const navigate = () =>
			planNavigation(paths.statePath, record.url, useEntry);
		if (restart)
			await restartSession(
				paths,
				record,
				navigate,
				options.config === undefined,
			);
		else {
			try {
				await launch(paths, record, navigate);
			} catch (error) {
				if (newProfile && !(await readSession(paths.sessionPath))) {
					await rm(paths.profilePath, { recursive: true, force: true });
					await rm(paths.statePath, { force: true });
				}
				throw error;
			}
		}
		return inspectStarted(paths, record);
	});
}

export async function stopSession(name: string) {
	return withStoppedSession(name, inspect);
}

export async function withStoppedSession<T>(
	name: string,
	action: (paths: SessionPaths, record: SessionRecord) => Promise<T>,
): Promise<T> {
	const paths = sessionPaths(name);
	await requireSession(paths, name);
	return withSessionLock(paths, async () => {
		await stopRunning(paths, name);
		return action(paths, await requireSession(paths, name));
	});
}

export async function withProfileProbe<T>(
	profile: string,
	config: SessionConfig,
	url: string,
	probe: (session: string) => Promise<T>,
): Promise<T> {
	const record: SessionRecord = {
		name: `verify-${crypto.randomUUID()}`,
		url,
		headed: false,
		idleTimeout: 0,
		config,
	};
	const paths = sessionPaths(record.name);
	let stopped = false;
	try {
		return await withSessionLock(paths, async () => {
			try {
				await copyProfile(profile, paths.profilePath);
				await launch(paths, record, () =>
					planNavigation(paths.statePath, url, true),
				);
				return await probe(record.name);
			} finally {
				await stopRunning(paths, record.name);
				stopped = true;
				await rm(paths.dir, { recursive: true, force: true });
			}
		});
	} finally {
		if (stopped) await rm(paths.run, { recursive: true, force: true });
	}
}

function updateStoppedSession<T>(
	name: string,
	update: (paths: SessionPaths, record: SessionRecord) => Promise<T>,
): Promise<T> {
	const paths = sessionPaths(name);
	return withSessionLock(paths, async () => {
		const record = await requireSession(paths, name);
		if (checkStalePid(paths)) {
			throw new CommandError(
				"SESSION_BUSY",
				`会话 ${name} 正在运行或关闭，请先执行 stop。`,
				3,
			);
		}
		return update(paths, record);
	});
}

export function removeSession(name: string): Promise<void> {
	return updateStoppedSession(name, (paths) =>
		rm(paths.dir, { recursive: true }),
	);
}

export function reseedSession(name: string, templateName: string) {
	return updateStoppedSession(name, async (paths, previous) => {
		const stage = await mkdtemp(join(paths.dir, ".reseed-"));
		const nextProfile = join(stage, "next-profile");
		const undo: (() => Promise<void>)[] = [];
		async function move(from: string, to: string) {
			await rename(from, to);
			undo.push(() => rename(to, from));
		}
		let next: SessionRecord;
		try {
			const template = await deriveTemplate(templateName, nextProfile);
			if (existsSync(paths.profilePath))
				await move(paths.profilePath, join(stage, "previous-profile"));
			if (existsSync(paths.statePath))
				await move(paths.statePath, join(stage, "previous-tabs.json"));
			await move(nextProfile, paths.profilePath);
			next = {
				...previous,
				template: template.name,
				templateVersion: template.version,
			};
			await writeRecord(paths.sessionPath, next);
		} catch (error) {
			for (const restore of undo.reverse()) await restore();
			await rm(stage, { recursive: true, force: true });
			throw error;
		}
		await rm(stage, { recursive: true, force: true });
		return inspect(paths, next);
	});
}
