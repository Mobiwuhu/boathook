# @boathook/headers

English · [简体中文](README.zh-CN.md) · [简体中文（包内文件）](https://unpkg.com/@boathook/headers/README.zh-CN.md)

Add or replace request headers in a boathook browser session. Rules apply to HTTP and HTTPS requests and to new WebSocket handshakes. Use the plugin to tag browser traffic for a test environment.

## Quick start

Install the optional plugin with the boathook CLI.

```bash
boathook plugin install @boathook/headers
```

Enable the plugin when starting a session. This example sends `x-qa-mode: preview` to `example.com` from the first navigation.

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

Inspect the active header names and scope, or change the header value while the session is running.

```bash
boathook --json --session headers-demo plugin headers list
boathook --session headers-demo plugin headers set x-qa-mode regression
```

## Scope and verification

Use `scope.hosts` for exact hostnames and `scope.hostRegex` for hostname patterns. Omitting `scope` applies the rules to all hosts in the session.

To verify the updated rule, send a fresh request from the active tab and check that the observed request matches the rule.

```bash
boathook --session headers-demo eval \
  'fetch("/?qa=regression", { cache: "no-store" }).then(r => r.status)'
boathook --json --session headers-demo \
  plugin headers verify --transport http --host example.com
```

Use `boathook --session headers-demo plugin headers help` to see the available commands, including `replace` for replacing the full set of headers and `scope` commands for editing the host filters.

## License

[MIT](https://spdx.org/licenses/MIT.html)
