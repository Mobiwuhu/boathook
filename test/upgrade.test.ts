import { expect, test } from "bun:test";
import { githubRelease, remoteArchive } from "../apps/cli/src/cli/upgrade.ts";

test("uses the Linux archive and SHA-256 from the configured GitHub Release", async () => {
	const checksum = "a".repeat(64);
	const release = await githubRelease("example/boathook", async (url) => {
		expect(url).toBe(
			"https://api.github.com/repos/example/boathook/releases/latest",
		);
		return Response.json({
			tag_name: "v0.12.0",
			assets: [
				{ name: "boathook-linux-x64-0.12.0-with-plugins.tar.gz" },
				{
					name: "boathook-linux-x64-0.12.0.tar.gz",
					digest: `sha256:${checksum}`,
				},
			],
		});
	});
	expect(remoteArchive(release)).toEqual({
		checksum,
		url: "https://github.com/example/boathook/releases/download/v0.12.0/boathook-linux-x64-0.12.0.tar.gz",
	});
});

test("rejects preview tags and assets without their digest", async () => {
	await expect(
		githubRelease("example/boathook", async () =>
			Response.json({ tag_name: "v0.12.0-beta.1", assets: [] }),
		),
	).rejects.toHaveProperty("code", "RELEASE_INVALID");
	const release = await githubRelease("example/boathook", async () =>
		Response.json({
			tag_name: "v0.12.0",
			assets: [{ name: "boathook-linux-x64-0.12.0.tar.gz" }],
		}),
	);
	expect(() => remoteArchive(release)).toThrow("SHA-256");
});
