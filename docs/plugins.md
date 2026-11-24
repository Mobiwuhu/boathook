# boathook plugins

A plugin default-exports a `BoathookPlugin` with a unique name, version, and `apiVersion: 1`. Author plugins against `@boathook/plugin-sdk`. The SDK can be packed from `packages/plugin-sdk` for use in a separate project.

```ts
import { type BoathookPlugin, defineCommand } from "@boathook/plugin-sdk";

export default {
  name: "page-info",
  version: "0.1.0",
  apiVersion: 1,
  commands: [
    defineCommand({
      name: "title",
      summary: "Read the active tab title",
      usage: "boathook --session NAME plugin page-info title",
      run: ({ page }) => page.title(),
    }),
  ],
} satisfies BoathookPlugin;
```

A session can load a local plugin by entry. Relative entries resolve from the working directory that supplied the startup JSON.

```json
{
  "plugins": [{ "id": "page-info", "entry": "./page-info.ts" }]
}
```

```bash
boathook start qa --url https://example.com \
  --config-json '{"plugins":[{"id":"page-info","entry":"./page-info.ts"}]}'
boathook --session qa plugin page-info help
boathook --json --session qa plugin page-info title
```

Install a plugin with `boathook plugin install SPEC`. The install catalog provides offline command help. Session help describes the loaded plugins. `boathook --json --session qa --llms-full` includes their commands in the same catalog as the built-ins. To change the set of loaded plugins, pass new startup JSON to `boathook restart NAME --config-json JSON`.

## Commands, hooks, and capabilities

Put host options before `plugin` and plugin options after the full command path. For a `report export` plugin command that declares `--format`, this invocation selects a JSON receipt and passes `xml` to the command.

```bash
boathook --session qa --format json \
  plugin report export --format xml
```

`defineCommand()` uses one argument schema for parsing and command help. A browser command can use `page`, `context`, `input`, and per-session `sessionState`. A configuration command supplies `configure` to compute the next options and a result. The host validates the options, calls the plugin lifecycle hook, and saves the session record.

Use `prepareContext` for browser-wide setup before navigation. Use `preparePage` for tab setup. Hooks and commands for the same plugin receive shared options and capabilities. `afterCommand` observes a result and the host proceeds through later hooks if an observer throws.

`capabilities.networkRules.replace(rules)` atomically replaces the caller's set of HTTP and WebSocket rules. Use `updateOptions` to apply new options to a running browser and return an undo function. If saving fails, the host calls the undo function before reporting the error.

Use `validateRuntime` for checks that can be performed on options alone. The host calls it for configuration validation, candidate startup, and live updates. Throw a `CommandError` to return a stable error code and exit status. Configuration commands and plugin discovery can run even when the active tab is unavailable.
