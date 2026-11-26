# Session configuration

Pass the starting settings as JSON when creating a session.

~~~bash
boathook start qa --config-json '{"url":"https://example.com"}'
boathook --json --session qa config inspect
~~~

Use `--config-json -` to read the JSON from standard input. A session can also be started with `--url` and the other individual launch flags. boathook keeps the settings in its private `sessions/<id>/session.json` under `~/.boathook/`. The inspection command shows the actual path and revision. Stopping and reopening a session restores its saved settings.

## Plugins

An installed plugin can be selected by ID in the starting JSON.
When a requested plugin is missing or its entry cannot be resolved, boathook warns on stderr and continues with the plugins it finds. After installing a skipped plugin, resubmit the startup JSON with `restart NAME --config-json JSON` to load it.

~~~bash
boathook start qa --config-json '{"plugins":[{"id":"headers"}]}'
boathook --session qa plugin headers set x-debug-mode preview
boathook --json --session qa config inspect --plugin headers
~~~

A plugin configuration command validates and applies the new options to the active browser, then saves them. A failed update retains the previous settings. Browser actions and queries use their own command handlers. Each session keeps its own copy of the options. [Plugins](plugins.md)

Use `config inspect --plugin ID` to read the saved settings for one enabled plugin, including when the session is stopped. For a running session, the result includes the Unix socket path. The usual socket location is `run/<id>/daemon.sock` under the state directory.

To change Chrome launch settings or the plugins loaded by a session, submit the complete configuration to `restart NAME --config-json JSON`. The candidate validates the options of the plugins it finds before stopping the current browser. If startup fails after shutdown, the supervisor attempts to restore the previous session and reports the outcome.

The revision identifies the saved configuration. Object property order has no effect on it, while array order is preserved. The effective startup URL is recorded on the session. `flow init` writes a project flow file that is immediately available in the running session.

## Fields

All top-level fields are optional. The JSON below can be passed as the starting configuration.

~~~json
{
  "url": "https://staging.example.com/",
  "timeout": 30000,
  "healthcheck": {
    "pages": [{ "url": "https://staging.example.com/" }]
  },
  "artifacts": { "retention": { "screenshots": "2d" } }
}
~~~

- `url` is the initial page. An explicit `--url` takes precedence.
- `timeout` is the default command timeout in milliseconds. The CLI uses the same setting to allow for queueing and execution. The current command can override it with `--timeout`.
- `browser.proxy` configures a fixed Chrome proxy using a `server` URL. Optional fields include `enabled`, `bypass`, `username`, and `password`.
- `login.check` points to a script to verify a login template. Optional `login.input` is the JSON passed to the script.
- `environments` declares login targets for `login --env`, flow login steps, and `test-matrix`. The daemon inherits the credential variables and `BOATHOOK_TRUST_PROJECT_CONFIG=1` at startup. [Authentication](authentication.md)
- `flows` contains inline named flows. boathook also discovers JSON files in the project's `flows/` and `~/.boathook/flows/`. [Flows and healthchecks](#flows-and-healthchecks)
- `permissions` maps names to target pages and assertions for `assert permission`.
- `healthcheck.pages` lists URLs, screenshot preferences, console severity, and page assertions for `healthcheck`.
- `artifacts.retention` accepts `default`, `screenshots`, `traces`, and `videos`. Durations such as `7d`, `24h`, and `30m` set the retention period for managed artifacts.
- `plugins` lists enabled plugins by `id` and their `options`. A local `entry` resolves from the working directory where the JSON is supplied. Relative login check paths use the same directory.

## Flows and healthchecks

A flow runs a sequence of browser steps. A healthcheck visits configured pages and checks their console and assertions. Save this example to `session.json`.

```json
{
  "flows": {
    "smoke": {
      "steps": [
        { "goto": "{{url}}" },
        { "assert": { "textContains": "{{expected_text}}" } },
        { "screenshot": true }
      ]
    }
  },
  "healthcheck": {
    "pages": [
      {
        "url": "{{url}}",
        "console": "error",
        "assertions": [{ "textContains": "Example Domain" }]
      }
    ]
  }
}
```

```bash
boathook start qa --config-json - < session.json
boathook --session qa flow smoke --var url=https://example.com \
  --var 'expected_text=Example Domain'
boathook --json --session qa healthcheck --var url=https://example.com
```

Put a flow definition in `flows/NAME.json` to run it by filename. Inline flows take precedence over project files, which take precedence over global files. Use `boathook --session qa flow list` to see the source and `flow init smoke page-smoke` to generate a starter in the project directory. Restart a session after editing files outside boathook to load the changes. [Flow and healthcheck schemas](../packages/core/src/config/schema.ts)
