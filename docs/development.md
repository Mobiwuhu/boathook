# Developing boathook

## Build and verify a checkout

Use Chrome and the Bun version in `.bun-version` on Linux or macOS. Run these commands from the boathook repository.

```bash
bun install --frozen-lockfile
bun run check
bun test
bun run build
bun run test:integration
bun run test:network
```

`bun run check` runs Biome, checks package boundaries, and checks the plugin SDK types. The build writes `dist/boathook`. The browser tests use temporary state directories and loopback servers. The network suite also needs OpenSSL. Set `BOATHOOK_CHROME_EXECUTABLE` if Chrome is outside the default location. Set `BOATHOOK_SMOKE_BINARY` to exercise a compiled executable moved outside the checkout.

Run `bash setup.sh` from a checkout to build the current source and install the command. On Linux x86-64, run `bash install.sh` from an unpacked release to verify its files and install the bundled CLI and Bun with the matching Chrome. Both use `~/.local/bin` by default and accept `BOATHOOK_BIN_DIR` and `BOATHOOK_STATE_DIR`.

Run `bun run build:docker` to build an optional image with the compiled CLI and Chrome. It uses the Bun version in `.bun-version`.

`bun install --frozen-lockfile` installs from the root lockfile. On Linux x86-64, `bun run release --with-plugins` produces an archive that includes the optional headers plugin. Install separately maintained plugins with `boathook plugin install`.

Declare each direct dependency in the workspace that uses it. Set external dependency versions in root `package.json` under `workspaces.catalog` and reference them with `catalog:`. Reference packages from this repository with `workspace:*`. Update the root `bun.lock` when a dependency changes.

On Linux x86-64, run `bun run test:release dist/boathook-linux-x64-*.tar.gz` after packaging. This installs each archive, runs `doctor`, and opens a session with the bundled plugins. Set `BOATHOOK_CHROME_ARCHIVE` to reuse a local Chrome ZIP with the checksum in the release manifest.

## Publish and verify upgrades

Set the version in `apps/cli/package.json` and push its matching `vMAJOR.MINOR.PATCH` tag. The release workflow builds and installs the Linux archive before publishing it to GitHub Releases. The artifact records the workflow repository. Set `BOATHOOK_RELEASE_REPO=OWNER/REPO` when building a distribution outside GitHub Actions.

The archive includes the project license and Bun license in `licenses/`. The release build uses the compiler's module list to collect notices for bundled dependencies and writes their versions, licenses, and MPL source links in `licenses/THIRD-PARTY.md`. Bundled plugin packages carry their notices alongside their compiled entry points.

With two locally built versions on Linux, run `bun run test:upgrade OLD.tar.gz NEW.tar.gz`. The smoke test checks availability, rejects a damaged archive with the previous installation still active, switches the CLI and its bundled runtimes, then reopens a saved browser profile.

## Browser checks in GitHub Actions

Run `boathook ci-init` from the project checkout to generate `.github/workflows/boathook-qa.yml`. In GitHub Actions variables, set `BOATHOOK_RELEASE_URL` to the URL of a boathook Linux archive. Optionally set `BOATHOOK_QA_URL` to the page to check. The workflow opens that page and takes a snapshot on pushes and pull requests. Use `boathook ci-init --force` to replace the file.

The repository's Benchmarks workflow runs `bun run bench:regression` and `bun run bench:workloads`. It uploads measurements for startup, navigation, snapshots, batches, and other browser workloads so developers can compare changes across runs.

## Working on commands and plugins

Incur handles product command groups in `apps/cli/src/cli/`. Page command handlers are in `packages/core/src/commands/`. The command catalog supplies names and flags for socket validation and shell completions. Use `boathook help COMMAND` to check page command help.

CLI imports Core through its package exports. Plugin packages import the public SDK. Release packaging discovers workspaces with the `boathook-plugin` keyword and resolves their built entry through Bun. [Architecture](architecture.md) · [Plugin SDK](plugins.md)

Run `bun run check:fix` for formatting and import sorting. Install the repository hooks with `bun run hooks:install`.

## Tested runtime

For a quick product check, run `./dist/boathook doctor --json`. The session suite covers CLI help, session reopen, login templates, command deadlines, tabs, scripts, and plugin installation. The network suite observes HTTP, HTTPS, WebSocket, and secure WebSocket handshake headers on its local servers.
