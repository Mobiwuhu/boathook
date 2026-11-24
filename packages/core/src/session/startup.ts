export type StartupResult =
	| { ok: true }
	| { ok: false; error: string; code: string; exitCode: number };
