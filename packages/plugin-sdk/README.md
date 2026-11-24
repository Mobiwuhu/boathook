# @boathook/plugin-sdk

English · [简体中文](README.zh-CN.md) · [简体中文（包内文件）](https://unpkg.com/@boathook/plugin-sdk/README.zh-CN.md)

Write TypeScript plugins for the boathook browser automation CLI. A plugin can add commands that operate on the selected Chrome tab and use lifecycle hooks to prepare the browser before navigation.

## Quick start

Add the SDK to your plugin project.

```bash
bun add @boathook/plugin-sdk
```

Save this plugin as `page-info.ts` in your project. The `title` command reads the active tab's title.

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
      run: async ({ page }) => ({ title: await page.title() }),
    }),
  ],
} satisfies BoathookPlugin;
```

With the boathook CLI on your PATH, run these commands from the project directory. The JSON receipt contains the page title in `data.title`.

```bash
boathook start page-info-demo --url https://example.com \
  --config-json '{"plugins":[{"id":"page-info","entry":"./page-info.ts"}]}'
boathook --json --session page-info-demo plugin page-info title
```

## Plugin API

- Default-export a `BoathookPlugin` with a unique `name`, a package `version`, and `apiVersion: 1`.
- Use `defineCommand()` to declare a command, its argument and option schemas, and its handler. boathook uses the same declarations for CLI help and validation.
- Use `prepareContext` for session-wide setup or `preparePage` to prepare each managed tab before navigation.
- Throw a `CommandError` to give callers a stable error code and a readable message.

To distribute your own plugin, point your npm package's entry at the plugin module. Users can then install it with `boathook plugin install PACKAGE` and enable it by ID in a session.

## License

[MIT](https://spdx.org/licenses/MIT.html)
