# Dashboard

A read-only Next.js application that displays every recorded heal attempt from the Self-Healing E2E Tests runner.

## What this is

A read-only Next.js App Router dashboard. Server Components read PostgreSQL directly using `pg` and render a single-page HTML table. There is no API layer, and the dashboard never writes to the database.

## Install and run

First, install the dashboard's dependencies:

```bash
npm run dashboard:install
```

Then start the development server:

```bash
npm run dashboard:dev
```

The dashboard runs on **http://localhost:3200**.

Alternatively, for production:

```bash
npm run dashboard:build
npm run dashboard:start
```

Note: `dashboard/` is its own npm package with its own `package-lock.json`. The root package does not depend on React or Next.js. Running `npm run dashboard:install` inside this directory installs a separate `node_modules/` tree.

## Environment

### `DATABASE_URL`

PostgreSQL connection string pointing to the database the runner writes to. Example:

```
postgres://postgres:mend@localhost:5433/mend
```

When `DATABASE_URL` is unset, the dashboard renders a help panel instead of crashing. The connection string is never printed: pg error messages pass through `redactConnectionUrls` to strip usernames and passwords.

## Tests

Run the dashboard test suite:

```bash
npm run test:dashboard
```

The suite includes:

- **Pure tests** (`format.spec.ts`, `attempts.spec.ts`, `transcript.spec.ts`, `attempt-detail.spec.ts`): always run, no database required.
- **Integration tests** (`attempts.integration.spec.ts`, `attempt-detail.integration.spec.ts`): skip unless `MEND_TEST_DATABASE_URL` is set.

See `db/README.md` for how to set up a test database.

## What it shows

### List view (`/`)

A table of every heal attempt, newest first, capped at 200 rows. Each row displays:

- **Attempt ID** (first 8 characters, no dashes)
- **Created (UTC)** — timestamp in `YYYY-MM-DD HH:MM:SS UTC` format
- **Spec file** — e.g., `specs/app.spec.ts`
- **Test** — the test name, truncated to 80 characters
- **Status badge** — `Investigating`, `Healed`, `Needs review`, or `Failed`
- **Confidence badge** — `High`, `Low`, or `None`
- **Selector change** — original selector → proposed selector (or — if no fix found)
- **Tool calls** — how many tool invocations the agent used (0–5)
- **PR link** — hyperlink to the GitHub PR (or — if no PR, or the URL is invalid)

When a heal attempt has a `failure_reason`, it is rendered immediately below the row as a second table row, spanning all nine columns. This makes failed and investigating attempts as legible as healed ones.

### Detail view (`/attempts/<id>`)

Clicking an attempt ID in the list view opens a detail page that replays the complete heal investigation. Every attempt shows seven sections, always all seven, filled with an explicit sentence when underlying data is absent:

1. **Outcome** — attempt metadata and stored verdicts (status, confidence, proposed selector).
2. **Verification** — the result of running `run_single_test` against the proposed selector, or an explanation if verification never ran.
3. **Confidence gate** — the signals that determined confidence (DOM match count, tool call count), measurement, and any downgrade reasons.
4. **What the agent saw first** — the DOM snapshot and spec source that were fed to the model on the first request.
5. **Transcript replay** — every tool call the model made in order, with their tool arguments, results, and detailed outputs (DOM snapshots, selector query previews, test run output).
6. **Model turns** — metadata for each model request (turn number, finish reason, tokens, a preview of the model's text).
7. **Record** — transcript envelope metadata (schema version, model name, run timestamps, whether the transcript was reduced).

Every section renders for every attempt — a failed or investigating attempt shows the same headings as a healed one, with the absence explained explicitly ("no fix could be accepted", "no confidence signals were recorded", etc.). Failed attempts are exactly as legible as successful ones.

The DOM snapshot and all stored text are rendered as **escaped plain text inside `<pre>` tags**, never as HTML. The page contains no `dangerouslySetInnerHTML`, no HTML preview pane, no iframe.

**Render caps** prevent a huge or pathological DOM snapshot from making the page unusable:

- DOM snapshot HTML: 20,000 characters
- Test output: 10,000 characters
- Spec source: 10,000 characters
- Spec diff table: 50 changed lines shown; remaining count displayed
- Selector query preview table: 10 matching elements shown; remaining count displayed

Every clamp is announced in the UI ("Showing the first 20,000 of 250,000 characters…").

The stored `status` and `confidence` columns are the authoritative verdict. When the transcript envelope records a different (earlier) confidence — which happens after a failed PR delivery attempt — a warning note explains that the row columns take precedence.

## What it deliberately does not do

- **No writes.** The dashboard is a read-only reporting surface. All writes go through `db/repository.ts`.
- **Transcript is read only by the detail route.** The transcript JSONB field can reach 2 MB per row and is not selected by the list view. Only the detail route (`/attempts/<id>`) reads transcript, one row at a time, with UUID validation before any query.
- **Raw message list is not rendered.** `transcript.messages` is the full OpenAI conversation (with the DOM snapshot embedded a second time and every tool result verbatim). The detail view renders the message count instead, and reconstructs the reasoning from the tool calls with structured results and the model turn table.
- **No join to test_runs.** The `test_run_id` is rendered as text so it can be correlated by eye or hand-written SQL, but no join is added and no grouping by run is shown.
- **No metrics, rates, or cost.** No percentages, heal rates, false-fix rates, average tool calls, or cost-per-heal. See Task 7.1 for analytics.
- **No pagination, filtering, sorting, search, or date ranges.** One bounded query, one order: `ORDER BY created_at DESC, id DESC LIMIT 200`. Newest first, always.
- **No auto-refresh, polling, or websockets.** Refresh the browser to reload.
- **No auth, sessions, or multi-tenancy.** The dashboard is local and read-only (`REQUIREMENTS.md`).
- **No approval, rejection, re-running, or merging.** The only action is clicking a PR link to see the pull request. There is no "apply this fix", "re-run", or "approve" affordance, not even a disabled one.
- **No design system, Tailwind, CSS-in-JS, or responsive breakpoints.** One hand-written CSS file.
- **No browser tests of the dashboard UI.** The test suite is Node-level only; HTTP behavior is verified with `curl`.
