# boathook architecture

## Named sessions

```bash
boathook start worker-1 --url https://example.com
boathook --session worker-1 snapshot -i
boathook ls
boathook stop worker-1
boathook start worker-1
```

Each name identifies one daemon, one persistent Chrome context, a private profile, and a Unix socket. The CLI selects the daemon by name. Within a session, `tab list` shows stable tab IDs that agents can address with `--tab`. A snapshot ID binds an element reference to the tab state where it was read.

On the first launch from a login template, the supervisor copies the template profile. Later launches read that session's profile and `tabs.json`. Running sessions remain available between CLI calls. The state root defaults to `~/.boathook` and can be overridden with `BOATHOOK_STATE_DIR`.

## Source layout

```text
apps/cli/           @boathook/cli
packages/
├── core/           @boathook/core
├── plugin-sdk/     @boathook/plugin-sdk
└── headers/        @boathook/headers
```

`apps/cli/src` owns the process entry point, command arguments and output. It calls Core through `@boathook/core` and loads `@boathook/core/daemon` in daemon mode. Bun compiles both into `dist/boathook`.

`packages/core/src` holds session supervision, template persistence, Unix socket transport, browser lifecycle, page commands, flows and the plugin host. Built-in and external plugins use `@boathook/plugin-sdk` for types, commands, errors and browser capabilities.

## Lifecycle and dispatch

The supervisor holds a session lock while it prepares or stops a daemon. The candidate daemon loads its plugin declarations and validates options through a private Bun IPC channel. For a restart, the supervisor waits for a successful validation, stops the running daemon, then sends a navigation plan based on the saved tabs. The candidate opens Chrome, initializes the session, and publishes its process record after the socket is ready. If startup fails after the old daemon has stopped, the supervisor tries once to reopen the session with its prior settings, profile, and tab addresses. The command reports the startup error and the recovery outcome.

The CLI sends one command or batch to an authenticated Unix socket. The daemon schedules commands for one session and resolves the target tab for handlers that need a page. The CLI derives its socket wait from the same queue and command timeouts. A queue timeout returns `COMMAND_NOT_STARTED`. An operation that has begun can return `COMMAND_OUTCOME_UNKNOWN` while it still owns the queue.

The CLI uses `stop NAME` to close a session. The supervisor sends a private shutdown request and waits for the daemon to save tab state and close Chrome. A batch `status` reads the same session state as the standalone status command.

Starting with `--config-json` supplies the initial settings. The daemon stores them in the session record and loads local and global flow files alongside them. Plugin configuration commands validate the next options, apply them to the browser, and atomically save the session record. Startup settings can be replaced on restart. [Configuration reference](configuration.md)

The browser layer installs an internal Chrome network extension before navigation. Plugins receive capabilities scoped to their IDs. Their commands and hooks share session-local state. See [plugin authoring](plugins.md).

The repository includes the browser commands and the files needed to build and test them.
