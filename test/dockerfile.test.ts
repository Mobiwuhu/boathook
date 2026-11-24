import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("docker optimisation", () => {
	test("uses multi-stage build with runtime image", () => {
		const dockerfile = readFileSync("Dockerfile", "utf8");
		const manifest = JSON.parse(readFileSync("package.json", "utf8"));
		expect(dockerfile).toMatch(/^ARG BUN_VERSION$/m);
		expect(manifest.scripts["build:docker"]).toContain(
			"BUN_VERSION=$(cat .bun-version)",
		);
		expect(dockerfile).toMatch(/FROM oven\/bun:\$\{BUN_VERSION\} AS deps/);
		expect(dockerfile).toContain("FROM deps AS build");
		expect(dockerfile).toMatch(
			/FROM oven\/bun:\$\{BUN_VERSION\}-debian AS runtime/,
		);
		expect(dockerfile).toContain(
			"--mount=from=deps,source=/app,target=/app bun /app/node_modules/playwright/cli.js install chrome --with-deps",
		);
		expect(dockerfile).toContain('ENTRYPOINT ["boathook"]');
	});

	test("copies only dependency and build inputs into the image", () => {
		const dockerfile = readFileSync("Dockerfile", "utf8");
		expect(dockerfile).toContain("COPY package.json bun.lock bunfig.toml ./");
		expect(dockerfile).toContain("COPY patches ./patches");
		expect(dockerfile).toContain("COPY apps ./apps");
		expect(dockerfile).toContain("COPY packages ./packages");
		expect(dockerfile).not.toContain("COPY . .");
	});

	test("uses a cached Bun install layer", () => {
		const dockerfile = readFileSync("Dockerfile", "utf8");
		expect(dockerfile).toContain(
			"RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile",
		);
	});

	test("keeps bulky development paths out of the Docker build context", () => {
		const dockerignore = readFileSync(".dockerignore", "utf8");
		expect(dockerignore).toContain(".git");
		expect(dockerignore).toContain(".worktrees");
		expect(dockerignore).toContain("docs");
		expect(dockerignore).toContain("test");
		expect(dockerignore).toContain("dist");
		expect(dockerignore).toContain("node_modules");
	});
});
