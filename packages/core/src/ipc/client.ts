import { connect } from "node:net";
import type { ProtocolResponse } from "./protocol.ts";

export function sendPayload(
	socketPath: string,
	payload: Record<string, unknown>,
	waitMs?: number,
): Promise<ProtocolResponse> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (fn: () => void) => {
			if (!settled) {
				settled = true;
				fn();
			}
		};

		const client = connect(socketPath, () => {
			client.write(`${JSON.stringify(payload)}\n`);
		});

		client.setEncoding("utf8");
		if (waitMs) {
			client.setTimeout(waitMs, () => {
				settle(() => reject(new Error("DAEMON_TIMEOUT")));
				client.destroy();
			});
		}

		let buffer = "";
		client.on("data", (chunk) => {
			buffer += chunk.toString();
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;
			const line = buffer.slice(0, newlineIndex).trim();
			client.end();
			settle(() => {
				try {
					resolve(JSON.parse(line));
				} catch {
					reject(new Error("Failed to parse daemon response"));
				}
			});
		});
		client.on("end", () => {
			if (!settled) {
				settle(() => reject(new Error("Failed to parse daemon response")));
			}
		});
		client.on("error", (err) => {
			settle(() => {
				if (
					(err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
					(err as NodeJS.ErrnoException).code === "ENOENT"
				) {
					reject(new Error("DAEMON_NOT_RUNNING"));
				} else {
					reject(new Error("Daemon connection lost."));
				}
			});
		});
	});
}
