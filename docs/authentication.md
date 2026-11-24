# Browser login

A named session keeps its Chrome profile. Sign in once, stop the session, and reopen it with the same name to resume using that profile. Use a login template to provision separate sessions from the same starting login. [Sessions and tabs](sessions-and-tabs.md)

## Sign in and save a template

Run `boathook template login staging --url URL`. The command returns a temporary session name. Use `boathook --session NAME snapshot -i` and the page commands to complete sign-in in that session. Save the profile with `boathook template save staging --from-session NAME`. You can then run `boathook start qa-a --template staging` and `boathook start qa-b --template staging` to use it in separate sessions. [Command guide](commands.md)

## Log in using a configured environment

The `environments` section declares login targets for the `login` command, flows, and multi-role tests. Use variable names for the credentials and supply their values in the environment you use to start the daemon.

~~~json
{
  "environments": {
    "staging": {
      "loginUrl": "https://staging.example.com/login",
      "userEnvVar": "STAGING_USER",
      "passEnvVar": "STAGING_PASS",
      "usernameField": "Email",
      "passwordField": "Password",
      "submitButton": "Sign in",
      "successCondition": { "urlContains": "/dashboard" }
    }
  }
}
~~~

You can use `urlContains`, `urlPattern`, or `elementVisible` as the success condition. Field and button names match the page's accessible labels. Set `SESSION_JSON` to the JSON above. Start the daemon with `BOATHOOK_TRUST_PROJECT_CONFIG=1` for a project whose credentials and login target you control.

~~~bash
BOATHOOK_TRUST_PROJECT_CONFIG=1 boathook start qa --config-json "$SESSION_JSON"
boathook --session qa login --env staging
~~~

## Export authentication state

Use the commands below to save or import cookies and local storage for the active session. The JSON file contains browser credentials. Keep it in a private directory.

~~~bash
boathook --session qa auth-state save /path/to/private/state.json
boathook --session qa auth-state load /path/to/private/state.json
~~~
