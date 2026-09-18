# Self-Healing E2E Tests

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17.0-339933?logo=node.js&logoColor=white)](package.json)
[![Playwright](https://img.shields.io/badge/tested%20with-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![Status](https://img.shields.io/badge/status-7%2F7%20phases%20shipped-brightgreen)](spec/TASKS.md)

<p align="center">
  <img src="docs/media/hero-card.jpg" alt="Self-Healing E2E Tests — Verified by execution. Not vibes. A human still merges." width="760">
</p>

A CI-oriented tool that repairs Playwright end-to-end tests broken by **selector
drift** — a renamed `id`/class, a restructured DOM, changed text. An OpenAI
tool-calling agent investigates a DOM snapshot, proposes a corrected selector, and —
this is the whole point of the project — **never accepts a fix without actually
re-running the test against a temp copy of the spec file and watching it pass.**
Verified high-confidence fixes are opened as GitHub pull requests. A human always
merges.

> The interesting engineering problem here isn't "can an LLM guess a CSS selector."
> It's building the harness that refuses to trust the guess: execution-based
> verification, an assertion-integrity check, a tool-call budget, and a confidence
> score computed from what was actually observed — never from asking the model how
> sure it feels.

## Why a test suite breaks, and why that's expensive

A renamed CSS class or a restructured DOM breaks tests that were never testing
anything actually wrong. Each break costs an engineer 10–20 minutes of triage for
what is usually a one-line fix. Teams stop trusting red builds, start re-running
until green, and the suite quietly loses its diagnostic value. This tool targets
exactly that failure mode — not application bugs, not flaky timeouts, just drift.

## See it in action

![Mend healing a broken selector, end to end](docs/media/mend-demo.gif)

*A full run: breakage seeded, the agent investigates and verifies a fix by
re-executing the test, and the dashboard replays exactly what it saw and did.*

📹 [Watch the full-quality version with audio](docs/media/mend-demo.mp4)

## How a heal happens

```mermaid
flowchart LR
    A["npm run test:e2e\nfails"] --> B["Classifier:\nselector-drift vs. other"]
    B -->|selector-drift| C["Agent loop\n(OpenAI tool-calling,\ncap: 5 tool calls)"]
    C --> D["get_dom_snapshot /\nquery_selector"]
    D --> C
    C --> E["run_single_test\non a temp copy of the spec"]
    E -->|fails| C
    E -->|passes| F["Assertion-integrity diff check"]
    F -->|violates| G["Rejected — recorded as failed"]
    F -->|clean| H["Confidence gate\n(DOM match count, tool-call count)"]
    H -->|high| I["GitHub PR opened\n(human merges)"]
    H -->|low| J["Routed to human review"]
    H -->|none| G
    C -->|cap reached, no verified fix| G
```

Every attempt — healed or failed — is persisted to PostgreSQL with the full
tool-call transcript, so the dashboard can replay exactly what the agent saw and
did.

## Non-negotiable invariants

These hold regardless of what any plan, PR, or prompt says otherwise:

- A proposed selector fix is **never** accepted without `run_single_test` actually
  re-executing it and passing. Model confidence alone is never sufficient.
- The agent can never make a test pass by removing, weakening, or skipping
  (`.skip`, `.only`) an assertion — enforced via a diff check before execution.
- The original spec file is never mutated during investigation; only temp copies
  are edited.
- The healing loop has a hard cap of **5 tool calls**, enforced on the failure path
  too, not just the happy path.
- Confidence (`high` / `low` / `none`) is derived from observable signals (DOM
  match count, tool-call count) — never from asking the model how sure it is. Only
  `high` opens a PR; `low` routes to human review; `none` is recorded as failed.
- The tool **never auto-merges**. A human always reviews and merges the PR.
- Every heal attempt is persisted, including failures, with the full tool-call
  transcript stored as `jsonb`.

One seeded scenario (an element genuinely removed from the DOM) is intentionally
unfixable — the correct agent outcome is "no fix found." That's not an edge case
being tolerated; it's the proof the agent knows when to stop guessing.

## Tech stack

TypeScript (strict) on Node.js · Playwright · OpenAI API with a hand-rolled
tool-calling loop (no agent framework) · PostgreSQL · Next.js (App Router, Server
Components read PostgreSQL directly) · GitHub REST API via Octokit for PR creation.

## Prerequisites

- Node.js >= 18.17.0
- A PostgreSQL 16 instance (local Docker container, or a hosted instance such as
  Neon — see [`db/README.md`](db/README.md) for both)
- An OpenAI API key

## Setup

Install dependencies for the root package and the dashboard:

```bash
npm install
npm run dashboard:install
```

Create your environment files from the checked-in examples:

```bash
cp .env.example .env
cp dashboard/.env.local.example dashboard/.env.local
```

Fill in `.env` with your own values:

```
DATABASE_URL=postgres://postgres:mend@localhost:5433/mend
OPENAI_API_KEY=sk-...
```

`dashboard/.env.local` needs only `DATABASE_URL`, pointing at the same database —
Next.js loads that file on its own (see [`dashboard/README.md`](dashboard/README.md)).

### Recommended: let `direnv` load your environment

[`direnv`](https://direnv.net/) exports `.env` into **every** shell you open in this
repository — so `DATABASE_URL` and `OPENAI_API_KEY` are simply always there: for npm
scripts, for ad-hoc `npx tsx …` commands, for `psql`, and for the dashboard. This
repo ships a `.envrc` that does exactly that and nothing else.

```bash
brew install direnv                 # macOS; see direnv.net for other platforms
eval "$(direnv hook zsh)"           # add this line to ~/.zshrc (or ~/.bashrc)
direnv allow                        # once, from the repo root
```

With `direnv` active you can skip `dashboard/.env.local` entirely — the dashboard
inherits `DATABASE_URL` from the shell.

### Fallback: load `.env` by hand

Don't want another tool? You don't need one. Every `npm run` script that needs
`DATABASE_URL` or `OPENAI_API_KEY` already loads `.env` for you (via
`scripts/with-env.mjs`), so the Quickstart below works in any fresh terminal as-is.

The only commands that still need help are ones you run *outside* an npm script — a
direct `npx tsx …`, or `psql "$DATABASE_URL"`:

```bash
set -a && source .env && set +a
```

That has to be repeated in every new terminal, which is exactly the papercut
`direnv` removes.

**Precedence, in one line:** a variable already set in your shell always wins;
otherwise `.env` supplies it (root scripts), or `dashboard/.env.local` does (the
dashboard).

Apply the database schema:

```bash
npm run db:migrate
```

If that command prints an error instead of `Applied N migrations …`, see
[Troubleshooting](#troubleshooting).

## Quickstart: see a heal happen

The app under test starts pristine (all tests pass), so there is nothing to heal
until you deliberately break it.

```bash
npm run start:app     # terminal 1 — leave running
npm run break:on      # terminal 2 — toggles the 5 seeded breakage scenarios on
npm run test:e2e      # now 5 tests fail, writing test-results/results.json
npm run heal          # reads those failures, heals what it can, persists to PostgreSQL
```

Hit an issue? See [Troubleshooting](#troubleshooting) — it lists the exact
messages these commands print when something is missing, and the one command
that fixes each.

Then, in another terminal:

```bash
npm run dashboard:dev
```

Open the dashboard (default `http://localhost:3200`) to see the run: up to 5
attempts, each with status, confidence, and — on the detail page — the full
transcript replay (DOM seen, selectors tried, the verification re-run, and why the
confidence gate decided what it decided). The genuinely-removed-element scenario is
expected to come back as `failed` — that's a hard requirement of the project, not a
bug.

Restore the app to pristine when done:

```bash
npm run break:off
```

To have `npm run heal` open pull requests for high-confidence fixes, also fill in
`GITHUB_TOKEN` and `GITHUB_REPOSITORY` in `.env` — see [`runner/README.md`](runner/README.md).

## Troubleshooting

Every entry below is something that actually went wrong during a cold-clone run of
this README. Symptom, cause, fix — in that order.

### `npm run db:migrate` exits with no output

**Cause:** A real defect — the migration CLI swallowed connection errors. It is fixed:
`db:migrate` now always prints a headline, the connection target, the underlying
cause, and a hint before exiting non-zero.

**Fix:** If you still get a silent exit, your checkout predates the fix. Update it:

```bash
git pull
npm install
```

The message it prints from then on is decoded by the next two entries.

### `npm run db:migrate` prints `Could not reach DATABASE_URL — is Postgres running and is the database created?`

**Cause:** Nothing is listening on the host and port in your `DATABASE_URL` — usually
Postgres simply isn't running.

**Fix:** Start the local container, then re-run the migration:

```bash
docker run --rm -d --name mend-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=mend \
  -e POSTGRES_DB=mend \
  postgres:16
npm run db:migrate
```

The `target:` line in that error shows the host, port, database, and user it actually
tried (never the password) — check them against `.env`.

### `npm run db:migrate` prints `Reached the Postgres server, but database "mend" does not exist.`

**Cause:** The server is up, but the database named at the end of `DATABASE_URL` was
never created.

**Fix:** Create it, then re-run the migration:

```bash
psql "postgres://postgres:mend@localhost:5433/postgres" -c 'CREATE DATABASE mend'
npm run db:migrate
```

### `npm run heal` prints `DATABASE_URL is not set; export it before running npm run heal`

**Cause:** There is no `.env` at the repository root, or its `DATABASE_URL` line is
empty. The npm scripts load `.env` for you — they cannot invent it.

**Fix:** Create `.env` from the template (skip the copy if you already have one), fill
in `DATABASE_URL`, then confirm it is being picked up:

```bash
cp .env.example .env
MEND_ENV_DEBUG=1 npm run db:migrate:status   # prints "with-env: applied N variable(s) …"
```

### `npm run heal` prints `OPENAI_API_KEY is not set; export it before running a heal`

**Cause:** Same as above — the `OPENAI_API_KEY` line in `.env` is empty.

**Fix:** Put a real key in `.env`:

```
OPENAI_API_KEY=sk-...
```

### Every heal attempt comes back `failed`, including scenarios that should heal

**Cause:** `OPENAI_API_KEY` is still the `.env.example` placeholder (`sk-your-key-here`),
or is otherwise invalid — every OpenAI call is rejected with a 401 before the agent
gets as far as investigating. Tell-tale: every `[settled]` line reports `toolCalls=0`,
and the attempt's detail page shows stop reason `model-error`.

**Fix:** Replace the placeholder in `.env` with a real key, then re-run (Scenario 5,
the genuinely removed element, is *expected* to still fail — that's by design):

```bash
npm run heal
```

### The dashboard shows "Set `DATABASE_URL` in `dashboard/.env.local` … then reload."

**Cause:** The dashboard is a separate Next.js app and reads its own
`dashboard/.env.local`, not the repository root `.env`.

**Fix:** Create it from the template and fill in the same `DATABASE_URL`:

```bash
cp dashboard/.env.local.example dashboard/.env.local
```

`next dev` picks the new file up on its own — reload the page, no `export` and no
restart. (With `direnv` active, the dashboard inherits `DATABASE_URL` from your shell
and this file is optional.)

### The dashboard shows "The database is unreachable or has not been migrated."

**Cause:** `DATABASE_URL` is set, but the database cannot be reached or the schema was
never created.

**Fix:** Check what the database actually has, then migrate:

```bash
npm run db:migrate:status
npm run db:migrate
```

If `db:migrate` itself fails, the first three entries above decode its message.

## Repository layout

| Path | What it is |
| --- | --- |
| `app-under-test/` | Minimal static app that exists to be broken |
| `breakage/` | Toggles the 5 seeded breakage scenarios on/off |
| `tests/` | The baseline Playwright suite |
| `agent/` | DOM/selector/test-execution tools and the OpenAI tool-calling heal loop |
| `runner/` | Orchestrates classify → heal → persist → open PR |
| `db/` | PostgreSQL schema, migrations, and read/write helpers |
| `dashboard/` | Read-only Next.js dashboard (list + detail views) |
| `spec/` | Requirements, design, and task roadmap |
| `plans/` | One implementation plan per task, written by the Architect subagent |

## Project status

Built phase by phase, riskiest and most technically uncertain work first — the
dashboard is deliberately last, since it's the most visually satisfying part and
the least risky one.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Target and Breakage | App under test, baseline suite, 5 seeded breakage scenarios | ✅ Done |
| 2 — Tools | `get_dom_snapshot`, `query_selector`, `run_single_test` | ✅ Done |
| 3 — Agent Loop | Failure classifier, OpenAI tool-calling loop, confidence gate | ✅ Done |
| 4 — Persistence | PostgreSQL schema/migrations, persisted runs and attempts | ✅ Done |
| 5 — Delivery | GitHub PR creation via Octokit | ✅ Done |
| 6 — Dashboard | Next.js list/detail views | ✅ Done |
| 7 — Evidence | Heal-rate and cost metrics | ✅ Done |

## Explicitly out of scope

Called out here because knowing what a tool refuses to do is as informative as
knowing what it does:

- Not a general website tester — it needs your test source, not a pasted URL.
- Not a test generator — it repairs existing tests, it does not author new ones.
- Does not fix application bugs — a genuinely broken app correctly yields "no fix
  found," never a workaround.
- Does not auto-merge, ever.
- Does not handle non-selector failures (timeouts, flakiness, race conditions) —
  those are detected and skipped, not healed.
- No self-hosted or fine-tuned models — OpenAI API only, by design.

Full scope and rationale: [`spec/REQUIREMENTS.md`](spec/REQUIREMENTS.md). Stack and
data model: [`spec/DESIGN.md`](spec/DESIGN.md). Build order: [`spec/TASKS.md`](spec/TASKS.md).

## Working on this project

Implementation work is driven by an Architect → Builder → Reviewer loop, one task
from `spec/TASKS.md` at a time, via the `/mend_tasks <task-id>` slash command in
Claude Code. See [`CLAUDE.md`](CLAUDE.md) for the full workflow and the project's
non-negotiable invariants.

## License

[MIT](LICENSE)
