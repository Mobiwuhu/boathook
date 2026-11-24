# @boathook/headers

[English](README.md) · 简体中文

在 boathook 浏览器会话中添加或覆盖请求头，支持 HTTP、HTTPS 请求和新建 WebSocket 连接的握手。可用于给浏览器发往测试环境的流量加标记。

## 快速上手

使用 boathook CLI 安装这个可选插件。

```bash
boathook plugin install @boathook/headers
```

启动会话时启用插件。下面的示例从首次导航开始，为发往 `example.com` 的请求设置 `x-qa-mode: preview`。

```bash
boathook start headers-demo --url https://example.com \
  --config-json '{
    "plugins": [{
      "id": "headers",
      "options": {
        "set": { "x-qa-mode": "preview" },
        "scope": { "hosts": ["example.com"] }
      }
    }]
  }'
```

可以查看当前生效的请求头名称和作用域，也可以在会话运行时修改请求头的值。

```bash
boathook --json --session headers-demo plugin headers list
boathook --session headers-demo plugin headers set x-qa-mode regression
```

## 作用域与验证

用 `scope.hosts` 精确匹配主机名，用 `scope.hostRegex` 按正则匹配主机名。省略 `scope` 时，规则应用于该会话访问的所有主机。

验证更新后的规则时，先从当前标签页发出一个新请求，再检查插件观察到的请求是否符合规则。

```bash
boathook --session headers-demo eval \
  'fetch("/?qa=regression", { cache: "no-store" }).then(r => r.status)'
boathook --json --session headers-demo \
  plugin headers verify --transport http --host example.com
```

用 `boathook --session headers-demo plugin headers help` 查看可用命令。`replace` 可以替换整组请求头，`scope` 子命令可以调整主机过滤条件。

## 许可证

[MIT](https://spdx.org/licenses/MIT.html)
