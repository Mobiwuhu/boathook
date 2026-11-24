# boathook

[English](README.md) · 简体中文

boathook 是面向开发者和 Agent 的 Chrome 自动化命令行工具。每个具名会话有独立的浏览器资料（profile），换个终端也能继续操作。页面命令、TypeScript 脚本和插件可以在同一个会话中使用。

## 安装并启动会话

在 Linux x86-64 上，解压发行包并运行 `bash install.sh`。脚本使用包里的 CLI 和 Bun，并准备发行清单锁定的 Chrome for Testing。用 `bash install.sh --dry-run` 预览安装路径。

从源码安装时，请使用 `.bun-version` 指定的 Bun 版本，然后在仓库中运行 `bash setup.sh`。如果想用已安装的 Chrome，在运行 `setup.sh` 前把 `BOATHOOK_CHROME_EXECUTABLE` 设为它的可执行文件路径。也可以用已安装的 Chrome 在仓库中编译并检查可执行文件。

```bash
bun install --frozen-lockfile
bun run build
./dist/boathook doctor --json
```

下面的命令假设 `boathook` 已在 PATH 中。启动会话后，可以用快照查看交互元素，再用快照中的元素引用点击或填表。

```bash
boathook start qa --url https://example.com
boathook --session qa snapshot -i
boathook --session qa screenshot
boathook stop qa
boathook start qa
```

新会话默认空闲 24 小时后关闭。空闲关闭和 `stop` 都会保存浏览器资料和标签页地址，用同一个名字启动即可恢复。默认状态目录为 `~/.boathook`。可以设置 `BOATHOOK_STATE_DIR` 隔离运行数据，用 `BOATHOOK_CHROME_EXECUTABLE` 为新会话选定 Chrome。[会话生命周期](docs/sessions-and-tabs.md)

用 `boathook --help` 查看命令列表，用 `boathook help snapshot` 查看单个页面命令的参数。Agent 可以用 `boathook --llms-full --json` 获取命令目录。加上 `--json` 可以获取结构化的命令结果。[命令指南](docs/commands.md)

## 升级已安装的版本

```bash
boathook upgrade --check
boathook upgrade
```

Linux x86-64 发行包会记录来源 GitHub 仓库。升级命令检查最新稳定版本并校验下载的发行包。安装脚本检查 Chrome 后，将命令入口切换到新版本。重启会话即可用新版本和原来保存的浏览器资料继续工作。

用 `boathook upgrade --repo OWNER/REPO` 指定发行仓库，或者用 `boathook upgrade --archive ./boathook-linux-x64-0.2.0.tar.gz` 从本地发行包升级。加上 `--check --json` 可以查询已安装版本和可用版本。

## 登录模板与脚本

用 `boathook template login work --url URL --json` 创建登录会话，在回执中的 `loginSession` 完成登录，再用 `boathook template save work --from-session LOGIN_SESSION` 保存模板。已有导出的 Chrome 用户数据目录时，可以用 `boathook template save work --from ./chrome-user-data` 导入。加上 `--url` 可以指定从该模板启动会话时打开的页面。

```bash
boathook start regression --template work
boathook --session regression run ./check.ts --input-json '{"case":"smoke"}' --json
```

脚本默认导出一个函数，参数为 `{ page, context, input, args }`。函数可以调用 Playwright API 并导入项目依赖。[浏览器登录指南](docs/authentication.md)

## 会话配置与插件

用 `boathook plugin install SPEC` 安装可选插件。在启动 JSON 中列出要启用的插件和选项。插件配置命令会保存目标会话的配置，并将其应用到正在运行的浏览器。[会话配置](docs/configuration.md) · [插件指南](docs/plugins.md)

下面的示例使用 `headers` 插件，通过 `--with-plugins` 构建的发行包包含这个插件。

~~~bash
boathook start qa-headers --config-json '{"plugins":[{"id":"headers"}]}'
boathook --session qa-headers plugin headers set x-debug-mode preview
boathook --session qa-headers config inspect --json
~~~

## 验证源码构建

```bash
bun run check
bun test
bun run build
bun run test:integration
bun run test:network
```

最后两条命令使用编译版 CLI、Chrome、独立 profile 和本地测试服务。网络测试还需要 OpenSSL。仓库的复用型 GitHub Action 位于 `.github/actions/boathook`，接收 JSON 数组形式的命令参数。[开发与发行](docs/development.md) · [架构](docs/architecture.md)

## 许可证

boathook 按 MIT 许可证发行。[MIT 许可证](LICENSE)
