import { chmodSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

export const MAX_SOCKET_REQUEST_BYTES = 1024 * 1024;

type Connection = {
	isOpen: () => boolean;
	send: (response: string) => Promise<void>;
	end: (response: string) => void;
};

function receiveLines(
	socket: Socket,
	receive: (line: string, connection: Connection) => Promise<void>,
): void {
	let buffer = "";
	let bufferBytes = 0;
	let queue = Promise.resolve();
	let closing = false;
	const connection: Connection = {
		isOpen: () => !closing && !socket.destroyed,
		send(response) {
			if (socket.destroyed) return Promise.resolve();
			return new Promise((resolve) => socket.write(response, () => resolve()));
		},
		end(response) {
			closing = true;
			if (!socket.destroyed) socket.end(response);
		},
	};

	socket.on("error", () => {});
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		bufferBytes += Buffer.byteLength(chunk);
		if (bufferBytes > MAX_SOCKET_REQUEST_BYTES) {
			socket.destroy();
			return;
		}
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) {
				queue = queue
					.then(async () => {
						if (connection.isOpen()) await receive(line, connection);
					})
					.catch(() => {
						socket.destroy();
					});
			}
			newline = buffer.indexOf("\n");
		}
		bufferBytes = Buffer.byteLength(buffer);
	});
}

export async function listenOnSocket(
	path: string,
	receive: (line: string, connection: Connection) => Promise<void>,
): Promise<Server> {
	const server = createServer((socket) => receiveLines(socket, receive));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			try {
				chmodSync(path, 0o600);
				resolve();
			} catch (error) {
				server.close();
				reject(error);
			}
		});
	});
	return server;
}
