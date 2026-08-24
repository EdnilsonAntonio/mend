# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository currently contains **only planning scaffolding** — no application code has
been written yet. It holds:

- `spec/` — the spec for a project called **Self-Healing E2E Tests**
  (`REQUIREMENTS.md`, `DESIGN.md`, `TASKS.md`)
- `.claude/agents/` — three custom subagents (`architect`, `builder`, `reviewer`) that
  implement tasks from the spec
- `.claude/commands/mend_tasks.md` — the `/mend_tasks <task-id>` slash command that
  orchestrates those three subagents

There is no `package.json`, no source tree, and no test runner configured yet. Directories
referenced by the spec (`agent/`, `runner/`, `dashboard/`, `tests/`, `app-under-test/`) do
not exist until the corresponding tasks in `spec/TASKS.md` are built.

## What the target project is

**Self-Healing E2E Tests** is a CI-oriented tool that repairs Playwright end-to-end tests
broken by selector drift (renamed id/class, DOM restructure, changed text). An OpenAI
tool-calling agent investigates a DOM snapshot, proposes a corrected selector, and — this is
the core design constraint — **never accepts a fix without actually re-executing the test
against a temp copy of the spec file and seeing it pass**. Verified high-confidence fixes are
opened as PRs; a human always merges. Full details are in `spec/REQUIREMENTS.md` (product
scope, explicit out-of-scope list) and `spec/DESIGN.md` (stack, architecture, data schema,
pipeline).

Planned stack (from `spec/DESIGN.md`, not yet present in the repo):
TypeScript (strict) / Node.js, Playwright, OpenAI API with a hand-rolled tool-calling loop
(no agent framework), PostgreSQL, Next.js (App Router, Server Components read PostgreSQL
directly) for the dashboard, GitHub REST API via Octokit for PR creation.

### Non-negotiable invariants of the target system

These hold regardless of what any individual plan or review says, and any subagent work
that violates them should be treated as a failure even if other checks pass:

- A proposed selector fix is never accepted without the test being re-executed
  (`run_single_test`) and passing. Model confidence alone is never sufficient.
- The agent can never make a test pass by removing, weakening, or skipping (`.skip`,
  `.only`) an assertion — enforced via a diff check before execution.
- The original spec file is never mutated during investigation; only temp copies are edited.
- The healing loop has a hard cap on tool calls (5), enforced in the failure path too, not
  just the happy path.
- Confidence (`high` / `low` / `none`) is derived from observable signals (DOM match count,
  tool-call count) — never from asking the model how sure it is. Only `high` opens a PR;
  `low` routes to human review; `none` is recorded as failed. The tool never auto-merges.
- Every heal attempt is persisted (including failures), with the full tool-call transcript
  stored as `jsonb`.

## Working on this project: the ABR loop

Implementation work is driven by three custom subagents run in strict sequence — **Architect
→ Builder → Reviewer** — orchestrated by the `/mend_tasks <task-id>` slash command
(`.claude/commands/mend_tasks.md`). Do not build ahead of this workflow when the user invokes
it; each task in `spec/TASKS.md` gets exactly one pass through the loop.

1. **Architect** (`.claude/agents/architect.md`, opus) reads all three spec files and one
   task from `spec/TASKS.md`, then writes `plans/<task-id>.md` (Goal / Files /
   Implementation steps / Interfaces / Acceptance criteria / Out of scope / Risks). It never
   writes production code and only ever plans one task at a time. Ambiguity is escalated to
   the human, never silently resolved.
2. **Human approval gate.** The orchestrator stops and shows the plan's Goal, Files, and
   Acceptance Criteria before the Builder is invoked.
3. **Builder** (`.claude/agents/builder.md`, haiku) implements exactly what the approved
   plan specifies — no design decisions, no scope expansion, no renaming. If the plan is
   silent or ambiguous it stops and reports "Blocked / unclear" rather than guessing. Reports
   back in a fixed format: Implemented / Verification / Deviations / Blocked.
4. **Reviewer** (`.claude/agents/reviewer.md`, sonnet) audits the Builder's work against the
   plan's acceptance criteria and against `spec/REQUIREMENTS.md`, by actually running the
   build and tests (not just reading code). Returns PASS or FAIL with a fix list. It never
   edits code.
5. **On FAIL:** the Builder gets only the Reviewer's fix list (not the original plan) and the
   loop returns to review. After **3 failed review rounds**, the loop stops and escalates
   back to the Architect for a fresh planning pass — three failures means the plan is wrong,
   not the code.
6. **On PASS:** present the final summary and ask the human before marking the task done in
   `spec/TASKS.md` — task status is a project record, never updated silently.

Plans are written once per task id to `plans/<task-id>.md` (this directory does not exist
yet — it is created by the Architect on first use).

## Task roadmap

`spec/TASKS.md` defines the build order, deliberately riskiest/most-interesting work first:

```
Phase 1  Target and Breakage   — scaffold app-under-test/, baseline Playwright suite, seed 5 breakage scenarios
Phase 2  Tools                 — get_dom_snapshot, query_selector, run_single_test (deterministic, no model)
Phase 3  Agent Loop            — failure classifier, OpenAI tool-calling loop, confidence gate
Phase 4  Persistence           — Postgres schema/migrations, persist runs and attempts
Phase 5  Delivery               — GitHub PR creation via Octokit
Phase 6  Dashboard              — Next.js list/detail views
Phase 7  Evidence               — heal-rate and cost metrics
```

The dashboard (Phase 6) is deliberately last — it's the most visually satisfying part and the
least technically risky, so building it early would mask unsolved hard problems in the agent
loop and verification gate (Phases 2–3).

Scenario 5 in Phase 1 (an element genuinely removed) is intentionally unfixable — the
expected agent outcome is "no fix found." This is a hard requirement in Task 3.3, not an
edge case to relax: it's the proof that the agent knows when to stop.
