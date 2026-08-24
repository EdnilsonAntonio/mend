# DESIGN.md

## Purpose

This document defines the technical decisions, stack, and architecture of the
Self-Healing E2E Tests system.

---

# Tech Stack

## Language and runtime

**TypeScript (strict) on Node.js**

* Playwright is a first-class TypeScript library — no language boundary between the
  orchestrator and the tests it repairs.
* Strict typing matters here because the system juggles three loosely-shaped payloads:
  Playwright JSON results, DOM snapshots, and OpenAI tool-call arguments.

## Browser automation

**Playwright**

* Runs the test suite and produces machine-readable JSON results.
* Provides the live DOM snapshot the agent investigates.
* Executes the verification re-run. This is the component that makes verification real
  rather than asserted.

## AI orchestration

**OpenAI API with native tool calling**

* No agent framework. The loop is ~100 lines of explicit control flow.
* Deliberate choice: a hand-rolled loop makes the cap, the verification gate, and the
  transcript logging visible and auditable. A framework would hide exactly the parts
  that are the point of this project.

## Relational database

**PostgreSQL**

* Test runs, heal attempts, confidence, status, PR links.
* Full agent transcripts stored as `jsonb`.

## Dashboard

**Next.js (App Router)**

* Server Components read directly from PostgreSQL — no separate API layer needed for a
  read-only reporting surface.

## Version control integration

**GitHub REST API (Octokit)**

* Branch creation, commit, pull request opening.
* v1 authenticates with a Personal Access Token; a GitHub App is future work.

## Test target

**`app-under-test/`** — a minimal static app existing purely to be broken. It is
scaffolding, not a product.

---

# System Architecture

```text
┌──────────────────┐
│  npm run heal    │  (stands in for CI in v1)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│     Runner       │  orchestrates the whole flow
└────────┬─────────┘
         │
   ┌─────┼──────────────┬────────────────┐
   │     │              │                │
   ▼     ▼              ▼                ▼
Playwright  Heal Agent  PostgreSQL   GitHub API
(execute)   (investigate)  (persist)   (open PR)
              │
       ┌──────┼──────────┐
       │      │          │
       ▼      ▼          ▼
   get_dom  query_    run_single
   _snapshot selector   _test
              │
              ▼
          OpenAI
       (tool calling)
```

---

# Data Schema

## test_runs

| Field | Type |
| --- | --- |
| id | uuid |
| started_at | timestamp |
| finished_at | timestamp |
| total | int |
| passed | int |
| failed | int |

---

## heal_attempts

| Field | Type |
| --- | --- |
| id | uuid |
| test_run_id | uuid |
| spec_file | text |
| test_name | text |
| original_selector | text |
| proposed_selector | text (nullable) |
| confidence | enum(high, low, none) |
| tool_call_count | int |
| status | enum(investigating, healed, needs_review, failed) |
| failure_reason | text (nullable) |
| pr_url | text (nullable) |
| transcript | jsonb |
| created_at | timestamp |

`transcript` holds the ordered list of tool calls, their arguments, and their results.
It is what the dashboard detail view replays.

---

# The Healing Pipeline

## 1. Detection

```text
Playwright run
 ↓
JSON results
 ↓
Filter failures
 ↓
Classify: selector drift vs application failure
 ↓
Selector-drift failures only → heal queue
```

Classification is rule-based, not model-based: selector-drift failures produce
identifiable Playwright error signatures (strict mode violation, element not found,
timeout waiting for selector). Non-matching failures are skipped and recorded.

## 2. Investigation

```text
Failure context + DOM snapshot
 ↓
OpenAI agent loop (max 5 tool calls)
 ↓
   get_dom_snapshot()   → what does the page look like now
   query_selector(cand) → match count + text preview, no commitment
   run_single_test(cand)→ real execution against a temp spec copy
 ↓
Candidate selector OR give up
```

### Tool contracts

| Tool | Input | Output |
| --- | --- | --- |
| `get_dom_snapshot` | — | pruned HTML of the page at failure point |
| `query_selector` | candidate selector | `{ matchCount, previews[] }` |
| `run_single_test` | candidate selector | `{ passed, output }` |

`get_dom_snapshot` returns *pruned* HTML — scripts, styles, and inline data stripped —
to keep token cost bounded and the signal high.

## 3. Verification

```text
Candidate selector
 ↓
Copy spec file to temp
 ↓
Replace ONLY the failing selector
 ↓
Diff temp vs original → assertion integrity check
 ↓
Execute single test
 ↓
Passed AND assertions intact → valid fix
```

### Rules

* A fix is valid only if the test **executed and passed**. Model confidence is never a
  substitute for execution.
* The diff between original and proposed spec must contain **no** assertion removal,
  weakening, or `.skip`. A test that passes because the assertion disappeared is a
  failure, not a heal.
* The original spec file is never mutated during investigation.
* The tool-call cap is enforced in the failure path. Hitting the cap is a normal,
  recorded outcome.

## 4. Confidence Gate

Confidence is derived from observable signals, not from asking the model how sure it is.

| Level | Conditions | Action |
| --- | --- | --- |
| **high** | verified pass, exactly 1 DOM match, ≤ 2 tool calls | open PR |
| **low** | verified pass, but ambiguous match or > 2 tool calls | needs_review, no PR |
| **none** | no verified pass within the cap | failed, no PR |

This rule is intentionally simple and explainable. A model-scored confidence would be
harder to defend and no more accurate at this scale.

## 5. Delivery

```text
high confidence fix
 ↓
Create branch
 ↓
Commit patched spec file
 ↓
Open PR with diff + agent reasoning summary
 ↓
Store pr_url
```

Humans merge. The tool never does.

---

# Design Decisions Worth Defending

**Why no agent framework?** The verification gate, the tool-call cap, and the transcript
are the substance of this project. A framework abstracts exactly those away.

**Why rule-based failure classification?** Sending every failure to the model would
multiply cost for a decision that error strings answer deterministically. Use the model
where judgment is required, not where matching suffices.

**Why store failed attempts?** They are the evidence base for the headline metric
("X% of selector-drift failures healed without human intervention"). A system that only
logs successes cannot report a rate.

**Why a temp copy instead of in-place edit + revert?** Revert-on-failure is one crash
away from leaving the repository in a corrupted state. Temp copies fail safe.

---

# Future Scalability

## Short term
* GitHub Action packaging.
* Parallel healing of independent failures.
* Cost and latency per heal surfaced on the dashboard.

## Medium term
* Approve/reject feedback loop into few-shot examples.
* Failure clustering to detect systemic drift.
* Cypress adapter.

## Long term
* Multi-repo tenancy.
* Healing beyond selectors (assertion drift, timing).
* Self-evaluation harness measuring heal quality over time.