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

Run `bash setup.sh` from a checkout to build the current source and install the command. On Linux x86-64 and macOS (Apple Silicon or Intel), run `bash install.sh` from the matching unpacked release to verify its files and install boathook with Chrome. The installer and boathook reuse the Bun runtime built into the boathook executable. Both scripts use `~/.local/bin` by default and accept `BOATHOOK_BIN_DIR` and `BOATHOOK_STATE_DIR`.

Run `bun run build:docker` to build an optional image with the compiled CLI and Chrome. It uses the Bun version in `.bun-version`.

`bun install --frozen-lockfile` installs from the root lockfile. Run `bun run release --with-plugins` on the target platform to produce an archive with the optional headers plugin. Install separately maintained plugins with `boathook plugin install`.

Declare each direct dependency in the workspace that uses it. Set external dependency versions in root `package.json` under `workspaces.catalog` and reference them with `catalog:`. Reference packages from this repository with `workspace:*`. Update the root `bun.lock` when a dependency changes.

After packaging, pass the native archive to `bun run test:release`. This installs each archive twice, checks reuse, runs `doctor`, and opens a session with the bundled plugins. Set `BOATHOOK_CHROME_ARCHIVE` to reuse a local Chrome ZIP with the checksum in the release manifest.

## Publish and verify upgrades

Open **Actions → Release boathook → Run workflow**. Choose `initial` to use the current version for the first release. Choose `patch`, `minor`, or `major` to let Bun calculate the next version. The workflow applies that version to the CLI, `@boathook/plugin-sdk`, and `@boathook/headers`, then builds and installs the three artifacts for verification.

**Dry run** is enabled by default. Each platform uploads a `boathook-release-PLATFORM` Actions artifact. The Linux artifact also contains the two npm tarballs. To publish from `main`, disable **Dry run**. The workflow pushes the verified version commit and tag, publishes the npm packages, and attaches each standard CLI archive with a `boathook-PLATFORM.sha256` file. The one-command installer uses the matching checksum file to select and verify the archive. The repository must allow the workflow to push the release commit to `main`.

The publish job uses npm Trusted Publishing. Both npm packages authorize `Mobiwuhu/boathook`, workflow `release.yml`, environment `npm`, with permission to run `npm publish`. The job uses npm with OpenID Connect (OIDC) to upload the tarballs verified by the build. npm requires the first successful publish within two days of creating each trusted publisher. [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)

An existing `vMAJOR.MINOR.PATCH` tag can also trigger the same workflow when pushed. The tag must match all three package versions. After a partial publish failure, use **Re-run failed jobs** on the existing run to reuse the verified artifacts. The publisher checks the integrity of any existing npm version before skipping it.

On Linux x86-64, reproduce the release build and installation checks locally.

```bash
bun run release --npm-packages
BOATHOOK_SMOKE_NPM_DIR=dist/npm bun run test:release dist/boathook-linux-x64-X.Y.Z.tar.gz
```

Set `BOATHOOK_RELEASE_REPO=OWNER/REPO` when building a distribution outside GitHub Actions so installed CLI releases can check the correct repository for upgrades.

The archive includes the project license and Bun license in `licenses/`. The release build uses the compiler's module list to collect notices for bundled dependencies and writes their versions, licenses, and MPL source links in `licenses/THIRD-PARTY.md`. Bundled plugin packages carry their notices alongside their compiled entry points.

With two release archives on Linux, run `bun run test:upgrade OLD.tar.gz NEW.tar.gz`. The smoke test checks availability, rejects a damaged archive with the previous installation still active, switches the CLI and Chrome, then reopens a saved browser profile.

## Browser checks in GitHub Actions

Run `boathook ci-init` from the project checkout to generate `.github/workflows/boathook-qa.yml`. In GitHub Actions variables, set `BOATHOOK_RELEASE_URL` to the URL of a boathook Linux archive. Optionally set `BOATHOOK_QA_URL` to the page to check. The workflow opens that page and takes a snapshot on pushes and pull requests. Use `boathook ci-init --force` to replace the file.

The repository's Benchmarks workflow runs `bun run bench:regression` and `bun run bench:workloads`. It uploads measurements for startup, navigation, snapshots, batches, and other browser workloads so developers can compare changes across runs.

## Working on commands and plugins

Incur handles product command groups in `apps/cli/src/cli/`. Page command handlers are in `packages/core/src/commands/`. The command catalog supplies names and flags for socket validation and shell completions. Use `boathook help COMMAND` to check page command help.

CLI imports Core through its package exports. Plugin packages import the public SDK. Release packaging discovers workspaces with the `boathook-plugin` keyword and resolves their built entry through Bun. [Architecture](architecture.md) · [Plugin SDK](plugins.md)

Run `bun run check:fix` for formatting and import sorting. Install the repository hooks with `bun run hooks:install`.

## Tested runtime

For a quick product check, run `./dist/boathook --json doctor`. The session suite covers CLI help, session reopen, login templates, command deadlines, tabs, scripts, and plugin installation. The network suite observes HTTP, HTTPS, WebSocket, and secure WebSocket handshake headers on its local servers.
