# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
bunx opensrc <package>           # npm package (e.g., bunx opensrc zod)
bunx opensrc pypi:<package>      # Python package (e.g., bunx opensrc pypi:requests)
bunx opensrc crates:<package>    # Rust crate (e.g., bunx opensrc crates:serde)
bunx opensrc <owner>/<repo>      # GitHub repo (e.g., bunx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Development

- **Greenfield project:** boathook is unreleased. Maintain one current contract for CLI commands, configuration, plugin APIs and on-disk state. When a contract changes, update its callers, plugins, docs and tests together and remove the superseded path. Do not add aliases, migrations, dual reads or compatibility fallbacks for superseded contracts.
- **Bun-first:** Use the Bun version in `.bun-version` for the CLI, daemon, project-owned scripts, dependency installation, tests, lint and release builds. Use `bun install --frozen-lockfile` for dependencies, `bun test` for tests and `bun x --bun` for package binaries. The `--bun` flag also runs tools whose executable uses a Node shebang. Product development and installation must work without a separate Node.js or npm installation.
- **Workspace dependencies:** Declare direct dependencies in the consuming package. Store third-party versions in the root `workspaces.catalog` and use `catalog:` in package manifests. Use `workspace:*` for local packages. Maintain a single root `bun.lock`.
- Prefer Bun APIs when they simplify the implementation. Bun-compatible `node:*` standard library imports are fine for portability, file locking, atomic filesystem operations and existing integrations. Commands configured by users for their own projects may use their project's runtime.
- **Lint and format:** Run `bun run check:fix` before committing to auto-fix lint and formatting issues.
- **Git hooks:** Run `bun run hooks:install` to install the repository hooks when Git uses its default hooks directory. With a managed `core.hooksPath`, run the repository's Lefthook checks explicitly.
- **Tests:** `bun test`
- **Build binary:** `bun run build` writes `dist/boathook`.

## boathook Browser QA Tool

boathook is a CLI for browser automation in named, persistent sessions. Use `boathook` for the product name in documentation and user-facing text.

- **Binary:** Build with `bun run build` and run `dist/boathook`.
- **Tool choice:** Prefer boathook for browser QA in this project.
- **Browser QA:** Start with `boathook start NAME --url URL`, then use `boathook --session NAME snapshot -i` and other page commands.
- **Help:** Run `boathook --help` for the command list and `boathook help COMMAND` for usage.
- **Session workflow:** See `docs/sessions-and-tabs.md` for CLI target selection, tabs, and restoration.
- **Independent checkout:** The product repository supplies build and verification inputs. Use `bun run test:integration` and `bun run test:network` to verify the compiled CLI.

### Plugins

The startup JSON selects the plugins for each session. For the inherited hooks and invocation types, see `docs/plugins.md`.

- **Types:** `@boathook/plugin-sdk` provides `BoathookPlugin`, `PluginCommand`, `CommandContext` and `PluginHooks`.
- **Loader:** `packages/core/src/plugins/loader.ts` and `packages/core/src/plugins/registry.ts` handle validation, registration, and session state.
- **Session configuration:** Pass `--config-json JSON` when starting. Plugin configuration commands apply and save new options to the target session. Keep one authoritative configuration in the session record.
- **Plugin API and examples:** See `packages/plugin-sdk/` and `packages/headers/`.
