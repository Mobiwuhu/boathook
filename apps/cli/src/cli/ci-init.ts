import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CommandError } from "@boathook/plugin-sdk";
import { z } from "incur";

export const ciOptions = z.object({
	force: z.boolean().optional().describe("Overwrite the generated CI file"),
});

const qaSteps = [
	"set -euo pipefail",
	`: "\${BOATHOOK_RELEASE_URL:?Set BOATHOOK_RELEASE_URL to a boathook Linux release archive}"`,
	'BOATHOOK_STATE_DIR="$(mktemp -d)"',
	'export BOATHOOK_STATE_DIR BOATHOOK_BIN_DIR="$BOATHOOK_STATE_DIR/bin"',
	"cleanup() {",
	'  if [[ -x "$BOATHOOK_BIN_DIR/boathook" ]]; then "$BOATHOOK_BIN_DIR/boathook" stop qa || true; fi',
	'  rm -rf -- "$BOATHOOK_STATE_DIR"',
	"}",
	"trap cleanup EXIT",
	'curl -fLsS "$BOATHOOK_RELEASE_URL" -o "$BOATHOOK_STATE_DIR/release.tar.gz"',
	'tar -xzf "$BOATHOOK_STATE_DIR/release.tar.gz" -C "$BOATHOOK_STATE_DIR"',
	'bash "$BOATHOOK_STATE_DIR/boathook-linux-x64/install.sh"',
	'export PATH="$BOATHOOK_BIN_DIR:$PATH"',
	`boathook start qa --url "\${BOATHOOK_QA_URL:-about:blank}"`,
	"boathook --session qa snapshot -i",
];

const workflowPath = ".github/workflows/boathook-qa.yml";
const workflow = [
	"name: boathook QA",
	"on: [push, pull_request]",
	"jobs:",
	"  qa:",
	"    runs-on: ubuntu-latest",
	"    env:",
	`      BOATHOOK_RELEASE_URL: \${{ vars.BOATHOOK_RELEASE_URL }}`,
	`      BOATHOOK_QA_URL: \${{ vars.BOATHOOK_QA_URL }}`,
	"    steps:",
	"      - uses: actions/checkout@v4",
	"      - name: Run browser QA",
	"        shell: bash",
	"        run: |",
	...qaSteps.map((step) => `          ${step}`),
	"",
].join("\n");

export async function initCI(
	{ force }: z.infer<typeof ciOptions>,
	projectDir = process.cwd(),
): Promise<{ path: string; text: string }> {
	const output = join(projectDir, workflowPath);
	await mkdir(dirname(output), { recursive: true });
	try {
		await writeFile(output, workflow, {
			flag: force ? "w" : "wx",
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			throw new CommandError(
				"CI_FILE_EXISTS",
				`${workflowPath} 已存在。如需覆盖，请使用 --force。`,
			);
		throw error;
	}
	return {
		path: output,
		text: `已生成 ${workflowPath}。请在 GitHub Actions 中设置 BOATHOOK_RELEASE_URL，可用 BOATHOOK_QA_URL 指定检查页面。`,
	};
}
