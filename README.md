# mend

**Self-Healing E2E Tests** — a CI-oriented tool that repairs Playwright end-to-end tests
broken by selector drift (renamed id/class, DOM restructure, changed text). An OpenAI
tool-calling agent investigates a DOM snapshot, proposes a corrected selector, and never
accepts a fix without re-executing the test against a temp copy of the spec file and
seeing it pass. Verified high-confidence fixes are opened as GitHub pull requests; a
human always merges.

Full product scope and design: [`spec/REQUIREMENTS.md`](spec/REQUIREMENTS.md) and
[`spec/DESIGN.md`](spec/DESIGN.md). Build order: [`spec/TASKS.md`](spec/TASKS.md).

## Prerequisites

- Node.js >= 18.17.0
- A PostgreSQL 16 instance (local Docker container, or a hosted instance such as Neon —
  see [`db/README.md`](db/README.md) for both)
- An OpenAI API key

## Setup

```bash
npm install
npm run dashboard:install
```

Create a `.env` file at the repo root (gitignored):

```
DATABASE_URL=postgres://postgres:mend@localhost:5433/mend
OPENAI_API_KEY=sk-...
```

`tsx`-run scripts (`db:migrate`, `heal`, and the test suites) load this file
automatically. The dashboard is a separate Next.js app and does **not** read the root
`.env` — see [`dashboard/README.md`](dashboard/README.md) for how to point it at the same
database.

Apply the database schema:

```bash
npm run db:migrate
```

## Quickstart: see a heal happen

The app under test starts pristine (all tests pass), so there is nothing to heal until
you deliberately break it.

```bash
npm run start:app     # terminal 1 — leave running
npm run break:on      # terminal 2 — toggles the 5 seeded breakage scenarios on
npm run test:e2e      # now 5 tests fail, writing test-results/results.json
npm run heal          # reads those failures, heals what it can, persists to PostgreSQL
```

Then, in another terminal:

```bash
npm run dashboard:start
```

Open the dashboard (default `http://localhost:3200`) to see the run: up to 5 attempts,
each with status, confidence, and — on the detail page — the full transcript replay (DOM
seen, selectors tried, the verification re-run, and why the confidence gate decided what
it decided). Scenario 5 (an element genuinely removed) is expected to come back as
`failed` — that is a hard requirement of the project, not a bug: it is the proof the
agent knows when to stop rather than guessing.

Restore the app to pristine when done:

```bash
npm run break:off
```

To have `npm run heal` open pull requests for high-confidence fixes, also set
`GITHUB_TOKEN` and `GITHUB_REPOSITORY` — see [`runner/README.md`](runner/README.md).

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

## Working on this project

Implementation work is driven by an Architect → Builder → Reviewer loop, one task from
`spec/TASKS.md` at a time, via the `/mend_tasks <task-id>` slash command. See
[`CLAUDE.md`](CLAUDE.md) for the full workflow and the project's non-negotiable
invariants (verification-before-accept, the tool-call cap, confidence derived only from
observable signals, and no auto-merge).
