# @boathook/plugin-sdk

[English](README.md) · 简体中文

为 boathook 浏览器自动化 CLI 编写 TypeScript 插件。插件可以为选中的 Chrome 标签页增加命令，也可以通过生命周期钩子在页面导航前准备浏览器环境。

## 快速上手

在你的插件项目里安装 SDK。

```bash
bun add @boathook/plugin-sdk
```

将下面的插件保存为项目中的 `page-info.ts`。`title` 命令会读取当前标签页的标题。

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

确认 `boathook` 已在 PATH 中，然后在项目目录运行下面的命令。JSON 回执中的 `data.title` 是页面标题。

```bash
boathook start page-info-demo --url https://example.com \
  --config-json '{"plugins":[{"id":"page-info","entry":"./page-info.ts"}]}'
boathook --json --session page-info-demo plugin page-info title
```

## 插件接口

- 默认导出一个 `BoathookPlugin`，声明唯一的 `name`、包的 `version` 和 `apiVersion: 1`。
- 用 `defineCommand()` 声明命令、参数与选项的 schema，以及处理函数。boathook 用同一份声明生成命令帮助并校验输入。
- 用 `prepareContext` 在会话范围内准备浏览器，或用 `preparePage` 在各受管标签页导航前完成设置。
- 抛出 `CommandError`，为调用方提供稳定的错误码和可读的错误信息。

分发自己的插件时，将 npm 包的入口指向插件模块。用户即可通过 `boathook plugin install PACKAGE` 安装，并在会话中按 ID 启用。

## 许可证

[MIT](https://spdx.org/licenses/MIT.html)
