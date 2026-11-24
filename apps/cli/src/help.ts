import { FLOW_REPORTER_HELP } from "@boathook/core";

type CommandHelp = {
	summary: string;
	usage: string;
};

export const COMMANDS: Record<string, CommandHelp> = {
	goto: {
		summary: "Navigate to URL, return page title",
		usage: `boathook --session NAME goto <url> [--viewport <WxH>] [--device <name>] [--preset <name>]

Flags:
  --viewport <WxH>   Set viewport before navigating (e.g. 320x568)
  --device <name>    Use a Playwright device (e.g. "iPhone SE")
  --preset <name>    Use a preset: mobile (375x667), tablet (768x1024), desktop (1440x900)`,
	},
	text: {
		summary: "Return visible text content",
		usage: "boathook --session NAME text",
	},
	snapshot: {
		summary: "Show page elements with refs",
		usage: `boathook --session NAME snapshot [-i] [-f] [--json]

Flags:
  -i       Include structural nodes with names (inclusive mode)
  -f       Include all nodes in tree (full mode)
  --json   Output as JSON

Default mode shows only interactive elements.`,
	},
	click: {
		summary: "Click an element by ref",
		usage: "boathook --session NAME click <@ref>",
	},
	hover: {
		summary: "Hover over an element by ref",
		usage: `boathook --session NAME hover <@ref> [--duration <ms>]

Flags:
  --duration <ms>   Hold the hover for the given duration (useful for delayed tooltips)`,
	},
	fill: {
		summary: "Fill an input by ref",
		usage: `boathook --session NAME fill <@ref> <value>

Fills a text input field. Supported roles: textbox, searchbox, spinbutton, combobox.`,
	},
	select: {
		summary: "Select a dropdown option by ref",
		usage: `boathook --session NAME select <@ref> <option>

Selects an option in a dropdown. Supported roles: combobox, listbox.`,
	},
	scroll: {
		summary: "Scroll the page or an element into view",
		usage: `boathook --session NAME scroll down               Scroll down one viewport height
boathook --session NAME scroll up                 Scroll up one viewport height
boathook --session NAME scroll top                Scroll to top of page
boathook --session NAME scroll bottom             Scroll to bottom of page
boathook --session NAME scroll <@ref>             Scroll element into view
boathook --session NAME scroll <x> <y>            Scroll to coordinates`,
	},
	press: {
		summary: "Send keyboard key presses",
		usage: `boathook --session NAME press <key> [key ...]

Press one or more keys sequentially. Supports single keys, combinations
with +, and multiple keys in one command.

Examples:
  boathook --session NAME press Tab                 Single key
  boathook --session NAME press Tab Tab Tab         Multiple sequential keys
  boathook --session NAME press Shift+Tab           Key combination
  boathook --session NAME press Escape              Close modals/popovers
  boathook --session NAME press Enter               Submit/activate
  boathook --session NAME press ArrowDown           Navigate within menus
  boathook --session NAME press Control+a           Select all

Key names follow Playwright conventions (Tab, Enter, Escape, ArrowDown, etc.).`,
	},
	screenshot: {
		summary: "Take a screenshot",
		usage: `boathook --session NAME screenshot [path] [--viewport] [--selector <css-selector>] [--diff <baseline>] [--threshold <n>]

Flags:
  --viewport              Screenshot only the viewport (not full page)
  --selector <selector>   Screenshot only the element matching the selector
  --diff <baseline.png>   Compare against a baseline image and produce a diff image + similarity score
  --threshold <n>         Per-channel diff threshold (0-255, default: 10). Pixels with all channel diffs below this are considered identical.

If no path is given, saves to the session artifacts/screenshots directory with a timestamp.
With --diff, outputs similarity percentage, diff pixel count, and path to the diff image.`,
	},
	console: {
		summary: "Show console messages",
		usage: `boathook --session NAME console [--level <level>] [--keep] [--json]

Flags:
  --level <level>   Filter by level: log, info, warning, error, debug
  --keep            Peek at messages without draining buffer
  --json            Output as JSON`,
	},
	network: {
		summary: "Show network requests",
		usage: `boathook --session NAME network [--all] [--keep] [--json]

Flags:
  --all    Show all requests (default: status >= 400 only)
  --keep   Peek at requests without draining buffer
  --json   Output as JSON`,
	},
	"auth-state": {
		summary: "Save or load auth state",
		usage: `boathook --session NAME auth-state save <path>   Save cookies and localStorage to file
boathook --session NAME auth-state load <path>   Load cookies and localStorage from file`,
	},
	login: {
		summary: "Log in using configured environment",
		usage: `boathook --session NAME login --env <environment>

Flags:
  --env <environment>   Required. Environment name from the session configuration

Set the credential variables and BOATHOOK_TRUST_PROJECT_CONFIG=1 when starting the session.`,
	},
	tab: {
		summary: "Manage browser tabs",
		usage: `boathook --session NAME tab list              List open tabs
boathook --session NAME tab new [url]         Open new tab (optionally at URL)
boathook --session NAME tab switch <index>    Switch to tab (1-indexed)
boathook --session NAME tab close [index]     Close tab (closes active tab if no index)`,
	},
	flow: {
		summary: "Execute or scaffold flows",
		usage: `boathook --session NAME flow list                          List defined flows
boathook --session NAME flow init <template> [name] [--force]
boathook --session NAME flow <name> [--var k=v ...] [--continue-on-error] [--reporter <format>] [--junit-property key=value ...] [--dry-run] [--stream] [--webhook <url>]

Flags:
  --force              Overwrite an existing generated flow when using init
  --var key=value       Pass variables to flow (repeatable)
  --continue-on-error   Continue running steps even if one fails
  --reporter <format>   Output format: ${FLOW_REPORTER_HELP}, or a plugin-provided reporter name
  --junit-property k=v  Add JUnit testsuite metadata (repeatable, requires --reporter junit)
  --dry-run             Preview step plan without executing
  --stream              Emit step results as NDJSON as they complete
  --webhook <url>       POST a JSON result payload to the URL on completion

Flows can be defined in the startup JSON or as files in the project flows/ directory. Global flows in ~/.boathook/flows/
are also loaded. Inline flows take precedence over file-based flows.
Flows support conditional logic (if/else) and loops (while) with condition
expressions.

Built-in templates:
  smoke        Open a URL and verify expected text
  login-smoke  Sign in to an environment and verify a post-login cue`,
	},
	assert: {
		summary: "Assert a condition (PASS/FAIL)",
		usage: `boathook --session NAME assert <type> <args...> [--json]

Types:
  visible <selector|@ref>              Element is visible
  not-visible <selector|@ref>          Element is not visible
  text-contains <text>                 Page contains text
  text-not-contains <text>             Page does not contain text
  url-contains <substring>             URL contains substring
  url-pattern <regex>                  URL matches regex
  element-text <selector|@ref> <text>  Element text contains value
  element-count <selector|@ref> <n>    Element count matches
  permission <name> granted|denied [--var k=v ...]

Flags:
  --json   Output as JSON`,
	},
	healthcheck: {
		summary: "Run healthcheck across configured pages",
		usage: `boathook --session NAME healthcheck [--var k=v ...] [--no-screenshots] [--reporter <format>] [--junit-property key=value ...] [--parallel] [--concurrency N] [--webhook <url>]

Flags:
  --var key=value       Pass variables for URL interpolation (repeatable)
  --no-screenshots      Skip screenshot capture
  --reporter <format>   Output format: junit (JUnit XML), json (structured JSON), markdown (human-readable Markdown)
  --junit-property k=v  Add JUnit testsuite metadata (repeatable, requires --reporter junit)
  --parallel            Check pages concurrently using separate browser tabs
  --concurrency <N>     Max pages to check in parallel (default: 5, requires --parallel)
  --webhook <url>       POST a JSON result payload to the URL on completion

Pages are defined in the session configuration.`,
	},
	wipe: {
		summary: "Clear all session data",
		usage:
			"boathook --session NAME wipe\n\nClears cookies, localStorage, sessionStorage, tabs, and buffers without stopping the daemon.",
	},
	benchmark: {
		summary: "Measure command latency",
		usage: `boathook --session NAME benchmark [--iterations N] [--json]

Flags:
  --iterations N   Number of iterations (default: 10)
  --json           Emit structured benchmark output for automation`,
	},
	viewport: {
		summary: "Get or set browser viewport size",
		usage: `boathook --session NAME viewport                  Show current viewport size
boathook --session NAME viewport <width> <height>  Set viewport (e.g. 320 568)
boathook --session NAME viewport <WxH>            Set viewport (e.g. 320x568)

Flags:
  --device <name>    Use a Playwright device (e.g. "iPhone SE", "iPad (gen 7)")
  --preset <name>    Use a preset: mobile (375x667), tablet (768x1024), desktop (1440x900)`,
	},
	eval: {
		summary: "Run JavaScript in the page context",
		usage: `boathook --session NAME eval <expression>

Evaluates a JavaScript expression in the browser page context using page.evaluate().
Returns the result as a string (objects are JSON-stringified).

Examples:
  boathook --session NAME eval "document.title"
  boathook --session NAME eval "document.querySelector('h1').textContent"
  boathook --session NAME eval "window.innerWidth"
  boathook --session NAME eval "getComputedStyle(document.body).backgroundColor"`,
	},
	"page-eval": {
		summary: "Run Playwright page-level operations",
		usage: `boathook --session NAME page-eval <expression>

Evaluates an expression with access to the Playwright \`page\` object.
Supports async/await. Returns the result as a string.

Examples:
  boathook --session NAME page-eval "await page.title()"
  boathook --session NAME page-eval "page.url()"
  boathook --session NAME page-eval "page.viewportSize()"
  boathook --session NAME page-eval "await page.evaluate(() => document.title)"`,
	},
	wait: {
		summary: "Wait for a condition before proceeding",
		usage: `boathook --session NAME wait url <substring>        Wait until URL contains substring
boathook --session NAME wait text <string>          Wait until page text contains string
boathook --session NAME wait visible <selector|@ref>    Wait until element is visible
boathook --session NAME wait hidden <selector|@ref>     Wait until element disappears
boathook --session NAME wait network-idle           Wait until no pending network requests
boathook --session NAME wait <ms>                   Wait for a fixed delay (last resort)

Respects --timeout flag. Polls at 100ms intervals.`,
	},
	url: {
		summary: "Print the current page URL",
		usage: "boathook --session NAME url",
	},
	back: {
		summary: "Navigate back in history",
		usage: "boathook --session NAME back",
	},
	forward: {
		summary: "Navigate forward in history",
		usage: "boathook --session NAME forward",
	},
	reload: {
		summary: "Reload the current page",
		usage: `boathook --session NAME reload [--hard]

Flags:
  --hard   Clear browser cache before reloading`,
	},
	attr: {
		summary: "Read element attributes by ref",
		usage: `boathook --session NAME attr <@ref> [attribute]

Examples:
  boathook --session NAME attr @e1 href              Get a single attribute value
  boathook --session NAME attr @e1 aria-current      Check ARIA attributes
  boathook --session NAME attr @e1 class             Get class list
  boathook --session NAME attr @e1                   Show all attributes as key=value pairs`,
	},
	upload: {
		summary: "Set file(s) on a file input by ref",
		usage: `boathook --session NAME upload <@ref> <file> [file ...]

Sets one or more files on an <input type="file"> element using Playwright's setInputFiles().

Examples:
  boathook --session NAME upload @e5 /path/to/file.pdf
  boathook --session NAME upload @e5 /path/to/a.jpg /path/to/b.jpg`,
	},
	a11y: {
		summary: "Run accessibility audit (axe-core)",
		usage: `boathook a11y [options] [@ref]

Flags:
  --standard <std>   WCAG standard: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice
  --json             Output results as JSON (for CI)
  --include <sel>    Scope audit to a CSS selector
  --exclude <sel>    Exclude a CSS selector from audit

Scoping:
  boathook a11y @e5                    Audit a specific element by ref
  boathook a11y --include ".main"      Audit a CSS selector region
  boathook a11y --exclude ".ads"       Exclude a region

Examples:
  boathook a11y                        Full page audit
  boathook a11y --standard wcag2aa     WCAG 2.0 AA only
  boathook a11y --standard wcag21aa    WCAG 2.1 AA
  boathook a11y --json                 Machine-readable output`,
	},
	dialog: {
		summary: "Handle browser dialogs (alert, confirm, prompt)",
		usage: `boathook --session NAME dialog accept [text]      Accept pending dialog (optional input text)
boathook --session NAME dialog dismiss            Dismiss pending dialog
boathook --session NAME dialog status             Show pending dialog info and auto-mode
boathook --session NAME dialog auto-accept        Automatically accept all future dialogs
boathook --session NAME dialog auto-dismiss       Automatically dismiss all future dialogs
boathook --session NAME dialog auto-off           Disable auto-mode (queue dialogs)`,
	},
	download: {
		summary: "Wait for and save file downloads with optional verification",
		usage: `boathook --session NAME download wait [--save-to <path>] [--timeout <ms>]
  [--expect-type <mime>] [--expect-min-size <bytes>] [--expect-max-size <bytes>]

Flags:
  --save-to <path>           Save downloaded file to this path
  --timeout <ms>             Timeout for waiting (default: 30000)
  --expect-type <mime>       Validate file MIME type (e.g. application/pdf)
  --expect-min-size <bytes>  Minimum file size in bytes
  --expect-max-size <bytes>  Maximum file size in bytes

Response includes: filename, path, url, size, and MIME type.
Returns an error if the download fails or validation checks do not pass.`,
	},
	frame: {
		summary: "Navigate and inspect iframes",
		usage: `boathook --session NAME frame list                 List all frames
boathook --session NAME frame switch <target>     Switch to frame by index, name, or URL substring
boathook --session NAME frame main                Show main frame info`,
	},
	intercept: {
		summary: "Mock or block network requests",
		usage: `boathook --session NAME intercept add <pattern> [--status N] [--body data] [--content-type type]
boathook --session NAME intercept remove <pattern>
boathook --session NAME intercept list
boathook --session NAME intercept clear

Flags:
  --status <N>            HTTP status code (default: 200)
  --body <data>           Response body (default: "")
  --content-type <type>   Content type (default: application/json)

Examples:
  boathook --session NAME intercept add "**/api/users" --body '{"users":[]}'
  boathook --session NAME intercept add "**/analytics/**" --status 204
  boathook --session NAME intercept clear`,
	},
	cookies: {
		summary: "Inspect browser cookies",
		usage: `boathook --session NAME cookies [--domain <domain>] [--json]

Flags:
  --domain <domain>   Filter cookies by domain substring
  --json              Output as JSON`,
	},
	storage: {
		summary: "Inspect localStorage or sessionStorage",
		usage: `boathook --session NAME storage local [--json]      Show localStorage entries
boathook --session NAME storage session [--json]  Show sessionStorage entries

Flags:
  --json   Output as JSON`,
	},
	html: {
		summary: "Get page or element HTML",
		usage: `boathook --session NAME html [selector|@ref]

Without arguments, returns full page HTML.
With a selector or ref, returns outerHTML of that element.`,
	},
	title: {
		summary: "Get the page title",
		usage: "boathook --session NAME title",
	},
	pdf: {
		summary: "Export page as PDF",
		usage: `boathook --session NAME pdf [path]

If no path given, saves to the session artifacts/exports directory with a timestamp.`,
	},
	"element-count": {
		summary: "Count elements matching a selector",
		usage: `boathook --session NAME element-count <selector|@ref>

Returns the number of elements matching the selector.`,
	},
	trace: {
		summary: "Record, view, and manage Playwright traces",
		usage: `boathook --session NAME trace start [--screenshots] [--snapshots]   Start recording
boathook --session NAME trace stop [--out <path>]                   Stop and save trace
boathook --session NAME trace view [<path>] [--latest] [--port <n>] Open trace in viewer
boathook --session NAME trace list                                  List saved traces
boathook --session NAME trace clean [--older-than <duration>] [--dry-run]  Delete saved traces
boathook --session NAME trace status                                Check recording status

Flags:
  --screenshots   Capture screenshots during recording
  --snapshots     Capture DOM snapshots during recording
  --out <path>    Output path for trace file (default: the session artifacts/traces directory)
  --latest        View the most recent trace
  --port <n>      Serve trace viewer on a specific port
  --older-than    Delete only traces older than the given duration
  --dry-run       Preview cleanup candidates without deleting them`,
	},
	screenshots: {
		summary: "Manage screenshot files",
		usage: `boathook --session NAME screenshots list                    List all screenshots
boathook --session NAME screenshots clean [--older-than <duration>] [--dry-run]   Delete screenshots
boathook --session NAME screenshots count                  Show count and total size

Flags:
  --older-than <duration>   Only delete screenshots older than duration (e.g. 7d, 24h, 30m)
  --dry-run                 Show what would be deleted without removing files

Automatic retention can also be set in the session configuration:
  "artifacts": { "retention": { "screenshots": "7d" } }`,
	},
	report: {
		summary: "Generate an HTML QA report",
		usage: `boathook --session NAME report --out <path> [--title <title>] [--screenshots <dir>]

Flags:
  --out <path>          Output path for the HTML report (required)
  --title <title>       Report title (default: "boathook QA Report")
  --screenshots <dir>   Directory containing screenshots (default: the session artifacts/screenshots directory)`,
	},
	form: {
		summary: "Bulk fill form fields in one command",
		usage: `boathook --session NAME form --data '{"field":"value",...}' [--auto-snapshot]

Fills multiple form fields in a single command by matching field names/labels
to data keys. Supports text inputs, selects, checkboxes, and radio buttons.

Flags:
  --data <json>        JSON object mapping field names to values (required)
  --auto-snapshot      Take a snapshot after filling to refresh refs

Examples:
  boathook --session NAME form --data '{"Email":"test@example.com","Password":"secret"}'
  boathook --session NAME form --data '{"Name":"John","Country":"US","Newsletter":true}'`,
	},
	"test-matrix": {
		summary: "Run same flow across multiple roles in parallel",
		usage: `boathook --session NAME test-matrix --roles <role1,role2,...> --flow <flow-name> [--env <env>] [--reporter <format>] [--junit-property key=value ...]

Runs the same flow simultaneously across isolated sessions with different
authentication (roles/environments) and diffs the results. Each role maps
to an environment in the session configuration.

Flags:
  --roles <roles>      Comma-separated list of role names (required)
  --flow <name>        Flow to run for each role (required)
  --env <env>          Environment prefix (e.g., staging → looks for staging-admin, staging-viewer)
  --reporter <format>  Output format: ${FLOW_REPORTER_HELP}, or a plugin-provided reporter name
  --junit-property k=v Add JUnit testsuite metadata (repeatable, requires --reporter junit)

Examples:
  boathook --session NAME test-matrix --roles admin,viewer,guest --flow checkout
  boathook --session NAME test-matrix --roles admin,viewer --flow dashboard --reporter junit`,
	},
	"assert-ai": {
		summary: "AI-powered visual assertion using a vision model",
		usage: `boathook --session NAME assert-ai "<assertion>" [--model <model>] [--provider <anthropic|openai>] [--base-url <url>]

Takes a viewport screenshot and sends it to a vision model to evaluate
whether the assertion holds. Returns structured PASS/FAIL with reasoning.

Flags:
  --model <model>        Model to use (default: claude-sonnet-4-20250514 for Anthropic, gpt-4o for OpenAI)
  --provider <provider>  AI provider: anthropic (default), openai
  --base-url <url>       Custom API base URL for OpenAI-compatible providers
                         (OpenRouter, Groq, Ollama, Together, etc.)
                         Auto-selects openai provider when set.

Environment variables:
  ANTHROPIC_API_KEY      Required for Anthropic provider (default)
  OPENAI_API_KEY         Required for OpenAI provider (and compatible providers)
  OPENAI_BASE_URL        Custom base URL (alternative to --base-url flag)

Examples:
  boathook --session NAME assert-ai "the page should show a dashboard with 3 charts"
  boathook --session NAME assert-ai "there should be no error banners visible"
  boathook --session NAME assert-ai "the login form has email and password fields" --provider openai
  boathook --session NAME assert-ai "page looks correct" --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4-20250514`,
	},
	replay: {
		summary: "Generate interactive session replay HTML",
		usage: `boathook --session NAME replay [--out <path>]     Generate replay from screenshots
boathook --session NAME replay list               List available replay recordings

Generates a standalone HTML page with an interactive timeline of the session,
including embedded screenshots, navigation controls, and keyboard shortcuts.

Flags:
  --out <path>   Output path for the HTML file (default: the session artifacts/replays directory)

Keyboard shortcuts in the viewer:
  ← / →          Navigate between events
  Space           Auto-play / pause`,
	},
	diff: {
		summary: "Visual diff between two deployments",
		usage: `boathook --session NAME diff --baseline <url> --current <url> [--flow <name>] [--threshold <n>]

Takes screenshots at each page on both deployments and produces a visual
diff report showing what changed. Useful for PR review workflows.

Flags:
  --baseline <url>     Base deployment URL (e.g., https://main.example.com)
  --current <url>      Current deployment URL (e.g., http://localhost:3000)
  --flow <name>        Flow defining which pages to compare (uses goto steps)
  --threshold <n>      Pixel diff threshold 0-255 (default: 10)
  --var key=value      Pass variables for URL interpolation
  --no-screenshots     Skip saving individual screenshots

Examples:
  boathook --session NAME diff --baseline https://staging.app --current http://localhost:3000
  boathook --session NAME diff --baseline https://main.app --current https://feature.app --flow smoke`,
	},
	video: {
		summary: "Record browser session as video",
		usage: `boathook --session NAME video start [--size <WxH>]               Start recording the active tab
boathook --session NAME video stop [--out <path>]                 Stop and save the video file
boathook --session NAME video status                              Check recording status
boathook --session NAME video list                                List saved videos
boathook --session NAME video clean [--older-than <duration>] [--dry-run]  Delete saved videos

Flags:
  --size <WxH>   Video resolution (default: current viewport or 1280x720)
  --out <path>   Output path for the video file (default: the session artifacts/videos directory)
  --older-than   Delete only videos older than the given duration
  --dry-run      Preview cleanup candidates without deleting them

When recording starts, a new browser context is created with video capture
enabled. Cookies are copied from the current session. The recording page
replaces the active tab, so all subsequent commands are captured.

On stop, the video is saved as WebM and the original page is restored.`,
	},
	"flow-share": {
		summary: "Export, import, and share flow definitions",
		usage: `boathook --session NAME flow-share export <name>              Export a flow to .flow.json
boathook --session NAME flow-share import <path>              Import a .flow.json file
boathook --session NAME flow-share list                       List installed shared flows
boathook --session NAME flow-share install <user/repo/flow>   Install from GitHub
boathook --session NAME flow-share publish <name>             Publish to local registry

Examples:
  boathook --session NAME flow-share export checkout
  boathook --session NAME flow-share import ./checkout.flow.json
  boathook --session NAME flow-share install acme/qa-flows/checkout
  boathook --session NAME flow-share list`,
	},
	perf: {
		summary: "Measure page performance (Core Web Vitals)",
		usage: `boathook --session NAME perf [--budget <spec>] [--json]

Collects Core Web Vitals and performance timing metrics for the current page.

Metrics: TTFB, FCP, LCP, CLS, DOM Content Loaded, Page Load, resource count, transfer size.

Flags:
  --budget <spec>   Performance budget check. Comma-separated metric=threshold pairs.
                    Metrics: ttfb, fcp, lcp (ms), cls (score), dcl, load (ms).
  --json            Output as JSON

Examples:
  boathook --session NAME perf
  boathook --session NAME perf --budget lcp=2500,cls=0.1,fcp=1800
  boathook --session NAME perf --json`,
	},
	security: {
		summary: "Run security audit (headers, cookies, mixed content)",
		usage: `boathook --session NAME security [--json]

Audits the current page for common security issues:
  - Security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
  - Cookie security flags (Secure, HttpOnly, SameSite)
  - Mixed content detection (HTTP resources on HTTPS pages)

Flags:
  --json   Output as JSON

Examples:
  boathook --session NAME security
  boathook --session NAME security --json`,
	},
	responsive: {
		summary: "Capture screenshots across viewport breakpoints",
		usage: `boathook --session NAME responsive [--breakpoints <spec>] [--url <url>] [--out <dir>] [--json]

Captures full-page screenshots at multiple viewport sizes for responsive testing.

Default breakpoints: mobile (375x667), tablet (768x1024), desktop (1440x900), wide (1920x1080).

Flags:
  --breakpoints <spec>   Custom breakpoints as comma-separated WxH (e.g. 320x568,768x1024,1920x1080)
  --url <url>            URL to test (defaults to current page, reloading at each breakpoint)
  --out <dir>            Output directory (default: the session artifacts/responsive directory)
  --json                 Output as JSON

Examples:
  boathook --session NAME responsive
  boathook --session NAME responsive --breakpoints 320x568,768x1024,1920x1080
  boathook --session NAME responsive --url https://example.com --out ./screenshots`,
	},
	record: {
		summary: "Record browser interactions as a flow JSON file",
		usage: `boathook --session NAME record <subcommand> [args]

Subcommands:
  start [--output file.flow.json] [--name "flow-name"]   Start recording interactions
  stop                                                    Stop recording and save flow JSON
  pause                                                   Pause event capture
  resume                                                  Resume event capture

Flags:
  --output <path>   Output file path (default: recording.flow.json)
  --name <name>     Flow name/description (default: recorded-flow)

Captures clicks, fills, selects, and navigations. Collapses rapid keystrokes
into single fill steps. Converts absolute URLs to {{base_url}} variables.

Examples:
  boathook --session NAME record start --output checkout.flow.json --name "checkout flow"
  boathook --session NAME record pause
  boathook --session NAME record resume
  boathook --session NAME record stop`,
	},
	extract: {
		summary: "Extract structured data from the page",
		usage: `boathook --session NAME extract <subcommand> [args] [--json]

Subcommands:
  table <selector|@ref>              Extract HTML table as structured data
  links [--filter <pattern>]         Extract all links with href and text
  meta                               Extract meta tags, Open Graph, Twitter Card, JSON-LD
  select <selector> [--attr <name>]  Extract matching elements' text or attribute

Flags:
  --json              Output as JSON
  --csv               Output table as CSV (table subcommand only)
  --filter <pattern>  Filter links by URL pattern (links subcommand only)
  --attr <name>       Extract specific attribute (select subcommand only)

Examples:
  boathook --session NAME extract table "table.results"
  boathook --session NAME extract links --filter "example\\.com"
  boathook --session NAME extract meta --json
  boathook --session NAME extract select "h2" --attr id`,
	},
	throttle: {
		summary: "Simulate network throttling via CDP",
		usage: `boathook --session NAME throttle <preset|off|status> [--download KB/s] [--upload KB/s] [--latency ms]

Presets:
  slow-3g   50 KB/s ↓, 25 KB/s ↑, 2000ms latency
  3g        187 KB/s ↓, 75 KB/s ↑, 400ms latency
  4g        1500 KB/s ↓, 750 KB/s ↑, 60ms latency
  wifi      3750 KB/s ↓, 1500 KB/s ↑, 20ms latency
  cable     6250 KB/s ↓, 3125 KB/s ↑, 5ms latency

Subcommands:
  boathook --session NAME throttle <preset>         Apply a named preset
  boathook --session NAME throttle off              Disable throttling
  boathook --session NAME throttle status           Show current throttle settings
  boathook --session NAME throttle --download 200 --upload 50 --latency 100   Custom values (KB/s)

Flags:
  --download <KB/s>   Download throughput in KB/s (default: 500)
  --upload <KB/s>     Upload throughput in KB/s (default: 100)
  --latency <ms>      Added latency in ms (default: 0)

Examples:
  boathook --session NAME throttle 3g
  boathook --session NAME throttle slow-3g
  boathook --session NAME throttle --download 100 --upload 50 --latency 500
  boathook --session NAME throttle off`,
	},
	offline: {
		summary: "Simulate offline network conditions via CDP",
		usage: `boathook --session NAME offline <on|off>

Enables or disables offline mode using Chrome DevTools Protocol.
When enabled, all network requests will fail as if the device has no connection.

Examples:
  boathook --session NAME offline on     Enable offline mode
  boathook --session NAME offline off    Disable offline mode`,
	},
	crawl: {
		summary: "Multi-page crawl and scrape pipeline",
		usage: `boathook --session NAME crawl <url> [options]

Crawl multiple pages starting from a URL, extracting data from each page.
Uses BFS traversal with configurable depth, rate limiting, and filtering.
Discovered links stay on the starting origin by default.

Flags:
  --depth <N>              Max link-follow depth (default: 1)
  --extract <type>         Data to extract: text, links, table, meta (default: text)
  --paginate <selector>    CSS selector for pagination element (click to advance)
  --max-pages <N>          Maximum pages to visit (default: 100)
  --rate-limit <N/s>       Max requests per second (e.g., 2/s)
  --output <file>          Write JSON results to file
  --include <pattern>      Only crawl URLs matching glob pattern (repeatable)
  --exclude <pattern>      Skip URLs matching glob pattern (repeatable)
  --same-origin            Only follow links to the same origin (default)
  --allow-external         Allow following links to other public origins
  --allow-private-network  Allow external links to private-network hosts
  --dry-run                Collect URLs without extracting data
  --json                   Output as JSON

Examples:
  boathook --session NAME crawl https://example.com
  boathook --session NAME crawl https://example.com --depth 2 --extract links
  boathook --session NAME crawl https://example.com --depth 2 --allow-external
  boathook --session NAME crawl https://example.com --paginate ".next-page" --max-pages 10
  boathook --session NAME crawl https://example.com --rate-limit 2/s --output results.json
  boathook --session NAME crawl https://example.com --include "*blog*" --exclude "*admin*"
  boathook --session NAME crawl https://example.com --depth 3 --dry-run`,
	},
	do: {
		summary: "Natural language browser automation via LLM",
		usage: `boathook --session NAME do "<instruction>" [--dry-run] [--provider <anthropic|openai>] [--model <model>] [--base-url <url>] [--verbose] [--env <name>]

Translates a natural language instruction into a sequence of boathook commands
using an LLM, then returns the planned commands for execution.

Flags:
  --dry-run              Show planned commands without executing
  --provider <provider>  AI provider: anthropic (default), openai
  --model <model>        Model to use (default: claude-sonnet-4-20250514 for Anthropic, gpt-4o for OpenAI)
  --base-url <url>       Custom API base URL for OpenAI-compatible providers
  --verbose              Show additional details
  --env <name>           Environment name for login steps

Environment variables:
  ANTHROPIC_API_KEY      Required for Anthropic provider (default)
  OPENAI_API_KEY         Required for OpenAI provider

Examples:
  boathook --session NAME do "go to example.com and click the login button"
  boathook --session NAME do "fill in the search box with hello and press Enter" --dry-run
  boathook --session NAME do "log in and navigate to settings" --env staging
  boathook --session NAME do "take a screenshot of the homepage" --provider openai`,
	},
	vrt: {
		summary: "Visual regression testing workflow",
		usage: `boathook --session NAME vrt <init|baseline|check|update|list>

Subcommands:
  init                  Initialize VRT directory structure and config
  baseline [--url ...]  Capture baseline screenshots for configured pages
  check [--threshold N] Compare current screenshots against baselines
  update [--all]        Accept current screenshots as new baselines
  list                  List current baseline screenshots

Flags:
  --url <url>        URL to capture (repeatable, for baseline)
  --threshold <n>    Diff threshold percentage (default: from config, typically 5)
  --all              Update all baselines (for update)
  --only <names>     Update specific baselines (for update)
  --json             Output results as JSON (for check)

Configuration is stored in .boathook/vrt/config.json.

Examples:
  boathook --session NAME vrt init
  boathook --session NAME vrt baseline --url https://example.com
  boathook --session NAME vrt check --threshold 3
  boathook --session NAME vrt update --all
  boathook --session NAME vrt list`,
	},
	watch: {
		summary: "Watch a flow file and re-run on changes",
		usage: `boathook --session NAME watch <flow-file.json> [--var key=value]

Watches a flow file for changes and re-runs it automatically.`,
	},
	seo: {
		summary: "Run SEO audit on the current page",
		usage: `boathook --session NAME seo [url] [--check <categories>] [--score] [--json]

Audits: meta tags, headings, images, links, structured data, Open Graph.

Flags:
  --check <list>   Audit specific categories (meta,headings,images,links)
  --score          Include a numeric score
  --json           Output as JSON

Examples:
  boathook --session NAME seo
  boathook --session NAME seo https://example.com --json`,
	},
	subscribe: {
		summary: "Subscribe to real-time browser events",
		usage: `boathook --session NAME subscribe [--events <types>] [--level <level>] [--idle-timeout <s>]

Streams browser events as NDJSON.

Event types: navigation, console, network, dialog, download, error

Flags:
  --events <types>       Comma-separated event types (default: navigation,console,network)
  --level <level>        Filter console events by level
  --idle-timeout <s>     Stop after N seconds of silence (default: 60)`,
	},
	dev: {
		summary: "Manage dev server lifecycle",
		usage: `boathook --session NAME dev <start|stop|status> [--flow <name>]

Configure in the session configuration:
  { "devServer": { "command": "npm run dev", "url": "http://localhost:3000" } }

Subcommands:
  start    Start the dev server and wait for readiness
  stop     Stop the dev server
  status   Check if dev server is running`,
	},
	compliance: {
		summary: "Run cookie consent and privacy compliance audit",
		usage: `boathook --session NAME compliance [url] [--standard <gdpr|ccpa|eprivacy>] [--json]

Checks: pre-consent cookies, consent banner, third-party trackers, privacy policy links.

Flags:
  --standard <std>   Compliance standard (default: gdpr)
  --json             Output as JSON

Examples:
  boathook --session NAME compliance https://example.com
  boathook --session NAME compliance --standard gdpr --json`,
	},
	"security-scan": {
		summary: "Run active security scans (XSS, CSRF, clickjacking)",
		usage: `boathook --session NAME security-scan [--checks <types>] [--verbose] [--json]

Active security testing: XSS probing, CSP analysis, clickjacking, form security.

Flags:
  --checks <types>   Comma-separated scan types: xss,redirect,clickjack,csp,forms
  --verbose          Show every payload tested
  --json             Output as JSON

Note: Only run against applications you have permission to test.`,
	},
	i18n: {
		summary: "Multi-locale testing and translation checks",
		usage: `boathook i18n [subcommand] --locales <en,fr,de,...> [--url <url>] [--json]

Subcommands:
  check-keys --url <url> --pattern <regex>   Check for untranslated strings
  rtl-check --url <url> --locale <locale>    Verify RTL layout

Flags:
  --locales <list>     Comma-separated locale codes
  --url <url>          URL to test
  --pattern <regex>    Regex for untranslated keys (default: UPPER_SNAKE_CASE)
  --json               Output as JSON`,
	},
	"api-assert": {
		summary: "Assert on API request/response from the browser",
		usage: `boathook --session NAME api-assert <url-pattern> [--status <code>] [--timing "<Nms"] [--schema <path>] [--json]

Waits for a matching network request and validates assertions.

Flags:
  --status <code>            Expected HTTP status code
  --method <method>          Match HTTP method
  --schema <path>            JSON Schema file for response validation
  --timing "<Nms"            Max response time
  --body-contains <string>   Response must contain string
  --max-size <size>          Max response size (e.g., 500kb)
  --header <name: value>     Expected response header
  --timeout <ms>             Wait timeout (default: 10000)

Examples:
  boathook --session NAME api-assert /api/users --status 200 --timing "<500ms"
  boathook --session NAME api-assert /api/submit --method POST --status 201`,
	},
	"design-audit": {
		summary: "Compare page styles against design tokens",
		usage: `boathook --session NAME design-audit --tokens <tokens.json> [--check colors,fonts] [--selector <sel>] [--json]
boathook --session NAME design-audit --extract [--json]

Flags:
  --tokens <path>      Design tokens JSON file
  --check <list>       Audit categories (colors, fonts)
  --selector <sel>     Scope to CSS selector
  --extract            Extract styles only (no comparison)
  --json               Output as JSON`,
	},
	"doc-capture": {
		summary: "Capture annotated screenshots for documentation",
		usage: `boathook --session NAME doc-capture --flow <flow.json> --output <dir> [--markdown <file>] [--update]

Flags:
  --flow <path>        Doc-capture flow file
  --output <dir>       Output directory for screenshots
  --markdown <file>    Generate markdown with image references
  --update             Only overwrite changed screenshots
  --var key=value      Pass variables to flow`,
	},
	gesture: {
		summary: "Perform touch gestures",
		usage: `boathook --session NAME gesture <type> [args]

Types:
  swipe <direction> [@ref]     Swipe left/right/up/down
  long-press <@ref>            Long press an element
  double-tap <@ref>            Double tap an element
  drag <@ref> --to <@ref>      Drag element to another

Flags:
  --speed <fast|slow>    Swipe speed
  --duration <ms>        Long press duration (default: 500)
  --distance <px>        Swipe distance (default: 200)`,
	},
	devices: {
		summary: "List and search device profiles",
		usage: `boathook --session NAME devices <subcommand>

Subcommands:
  list                  List all available device profiles
  search <query>        Search by name (e.g., "iphone")
  info <name>           Show device details

Use with --device flag:
  boathook --session NAME goto https://example.com --device "iPhone 15 Pro"`,
	},
	monitor: {
		summary: "Scheduled site monitoring with alerts",
		usage: `boathook --session NAME monitor <check|history|status> [--config monitor.json]

Subcommands:
  check                Run all site checks once
  history [--last 24h] View recent check history
  status               Show monitor configuration

Flags:
  --config <path>      Monitor config file (default: monitor.json)
  --last <duration>    Filter history (e.g., 24h, 7d)
  --site <name>        Filter by site name
  --json               Output as JSON`,
	},
};
