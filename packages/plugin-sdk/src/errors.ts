export class CommandError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly exitCode = 2,
	) {
		super(message);
	}
}

export function isCommandError(error: unknown): error is CommandError {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		"exitCode" in error &&
		typeof error.exitCode === "number"
	);
}
