# Sessions and tabs

```bash
boathook start worker-1 --url https://example.com
boathook start worker-2 --url https://example.com
boathook ls
boathook --session worker-1 snapshot -i --json
boathook --session worker-2 tab list --json
```

Each session has a persistent Chrome profile, daemon, and private Unix socket. The CLI selects a session with `--session NAME` or `BOATHOOK_SESSION`. Calls from a new terminal address the same running browser.

Create another page in a session with `boathook --session worker-1 tab new URL`. Tabs share the session profile. Agents can use the tab ID from `tab list --json` with `--tab ID`. For an element action based on a snapshot, pass its `--snapshot-id ID` with the tab ID.

```bash
boathook stop worker-1
boathook start worker-1
```

Stopping closes Chrome and saves the active tab and tab URLs. Starting the same name opens the saved profile and restores the tabs. Use `boathook restart NAME --config-json JSON` to apply a different plugin set to the same profile. Use `boathook ls --running` to see active daemons.

New sessions close after 24 idle hours by default. A command in progress keeps the browser alive, and the idle timer resets when it finishes. Automatic closure saves the profile and tab URLs just like `stop`. Set a timeout in seconds with `boathook start NAME --idle-timeout SECONDS` or change an existing session's timeout with `boathook restart NAME --idle-timeout SECONDS`. Use `boathook status NAME --json` to read the session's `idleTimeout`.

To create a session with a saved sign-in, run `boathook start worker-1 --template LOGIN` with a new name. The profile is copied on the first launch. Use two names with the same template to test in two independent profiles.
