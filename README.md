# boathook

English · [简体中文](README.zh-CN.md)

boathook runs named Chrome sessions for people and agents. Each session keeps its own browser profile and can be controlled from a new terminal. Page commands, TypeScript scripts, and plugins share the same session.

## Install and open a session

On Linux x86-64, unpack the release archive and run `bash install.sh`. The installer uses the CLI and Bun in the archive and prepares the Chrome for Testing version pinned in the release manifest. Use `bash install.sh --dry-run` to preview the install paths.

To install from a source checkout, use the Bun version in `.bun-version` and run `bash setup.sh`. Set `BOATHOOK_CHROME_EXECUTABLE` to the path of an installed Chrome before running `setup.sh` to use that browser. To build and check the executable in the checkout, use an installed Chrome and run these commands.

```bash
bun install --frozen-lockfile
bun run build
./dist/boathook doctor --json
```

The commands below assume `boathook` is on PATH. Start a session, inspect the interactive elements, and use the element references in the snapshot to click or fill fields.

```bash
boathook start qa --url https://example.com
boathook --session qa snapshot -i
boathook --session qa screenshot
boathook stop qa
boathook start qa
```

New sessions stay open for up to 24 hours of inactivity. Idle shutdown and `stop` save the profile and tab URLs. Start the same name to restore them. The default state directory is `~/.boathook`. Set `BOATHOOK_STATE_DIR` for isolated runs and `BOATHOOK_CHROME_EXECUTABLE` to select a Chrome binary for new sessions. [Session lifecycle](docs/sessions-and-tabs.md)

Run `boathook --help` for available commands and `boathook help snapshot` for a page command's arguments. Agents can inspect the catalog with `boathook --llms-full --json`. Pass `--json` to receive a structured command result. [Command guide](docs/commands.md)

## Upgrade an installation

```bash
boathook upgrade --check
boathook upgrade
```

On Linux x86-64, the installed release records its GitHub repository. The command checks the latest stable release, verifies the downloaded archive, and switches the command to the new release after the installer checks Chrome. Restart a session to use the new release with its saved profile.

Use `boathook upgrade --repo OWNER/REPO` to specify the source repository, or `boathook upgrade --archive ./boathook-linux-x64-0.2.0.tar.gz` to upgrade from a local release. Use `--check --json` to report the installed and available versions without installing.

## Templates and scripts

Create a login session with `boathook template login work --url URL --json`, finish the sign-in flow in the returned `loginSession`, then use `boathook template save work --from-session LOGIN_SESSION`. An exported Chrome user data directory can also be imported with `boathook template save work --from ./chrome-user-data`. Pass `--url` when the imported template should open a particular page.

```bash
boathook start regression --template work
boathook --session regression run ./check.ts --input-json '{"case":"smoke"}' --json
```

The script exports a default function that receives `{ page, context, input, args }`. It can use Playwright APIs and import project dependencies. [Browser login](docs/authentication.md)

## Session configuration and plugins

Install optional plugins with `boathook plugin install SPEC`. Pass enabled plugins and their options in the starting JSON. A plugin configuration command saves its changes for the target session and applies them to the running browser. [Session configuration](docs/configuration.md) · [Plugin guide](docs/plugins.md)

The example uses the `headers` plugin included in releases built with `--with-plugins`.

~~~bash
boathook start qa-headers --config-json '{"plugins":[{"id":"headers"}]}'
boathook --session qa-headers plugin headers set x-debug-mode preview
boathook --session qa-headers config inspect --json
~~~

## Verify a checkout

```bash
bun run check
bun test
bun run build
bun run test:integration
bun run test:network
```

The last two commands run the built CLI with Chrome, isolated profiles, and local test servers. The network suite also uses OpenSSL. The repository's composite GitHub Action lives in `.github/actions/boathook` and accepts command arguments as a JSON array. [Development and releases](docs/development.md) · [Architecture](docs/architecture.md)

## License

boathook is distributed under the MIT License. [MIT License](LICENSE)
