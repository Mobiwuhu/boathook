# Command guide

```bash
boathook --help
boathook help snapshot
boathook --json --llms-full
```

Place global options before the command and command options after its name. Include `--session NAME` before `--llms-full` to include the plugins loaded in a running session.

## Operate a page

```bash
boathook start qa --url https://example.com
boathook --session qa snapshot -i
boathook --session qa click @e1
boathook --session qa snapshot -i
boathook --session qa screenshot ./qa.png
```

Use the ref from the latest snapshot of the tab you want to operate. `snapshot -i` includes named structural elements, and `snapshot -f` includes every node. Refresh the snapshot after navigation or a page update that changes your target.

For agents working across tabs, `boathook --json --session qa snapshot` includes the tab and snapshot IDs. Pass both IDs with the element action to ensure it uses the intended snapshot. [Sessions and tabs](sessions-and-tabs.md)

```bash
boathook --session qa --tab TAB_ID --snapshot-id SNAPSHOT_ID click @e1
```

## Inspect browser activity

```bash
boathook --session qa console --level error
boathook --json --session qa network --all
boathook --json --session qa a11y --standard wcag2aa
boathook --session qa trace start --screenshots --snapshots
boathook --session qa goto https://example.com
boathook --session qa trace stop --out ./qa-trace.zip
```

Accessibility audit results include violations and affected nodes. Use the JSON results to enforce a threshold in CI. Use `boathook help trace` for recording and viewing options.

## Automate a session

Run a TypeScript or JavaScript file against the active tab. The default export receives `page`, `context`, `input`, and `args`.

```bash
boathook --json --session qa run ./check.ts --input-json '{"case":"smoke"}'
```

Use `run --input PATH` for a JSON file or `run --input -` for standard input. Use `batch` to send a JSON array of commands together. Use `flow` and `healthcheck` for browser checks that use saved session settings. [Session configuration](configuration.md#flows-and-healthchecks)

```bash
boathook help batch
boathook --session qa flow list
boathook help healthcheck
```

## Read results

Use `--json` or `--format json` before the command for a JSON receipt. Successful replies contain `ok: true` and `data`. Failures include `error.code` and `error.message` and return a nonzero exit code.

- Use `--session NAME` or the `BOATHOOK_SESSION` environment variable to select a session.
- Use `--tab ID` to select a tab.
- Use `--timeout MS` to set the deadline for a browser command.

See [browser login](authentication.md) for templates, [plugins](plugins.md) for extension commands, and [release upgrades](../README.md#upgrade-an-installation) for update commands.
