# REQUIREMENTS.md

## Overview

**Self-Healing E2E Tests** is a CI-oriented tool that automatically repairs Playwright
end-to-end tests broken by selector drift. When a test fails because an element's `id`,
class, structure, or text changed, an AI agent investigates the live DOM, proposes a
corrected selector, **verifies the fix by actually re-running the test**, and opens a pull
request for human approval.

The core value is not that an AI proposes a fix. It is that no fix is ever accepted
without execution-based verification, and that the agent cannot cheat its way to green.

---

## The problem

E2E test suites rot. A renamed CSS class or a restructured DOM breaks tests that were
never actually testing anything wrong. Each break costs an engineer 10–20 minutes of
triage for what is usually a one-line change. Teams stop trusting red builds, start
re-running until green, and the suite loses all diagnostic value.

---

## Users

The user is a developer on a team that **already has a Playwright suite**. This tool is
installed into their repository and runs inside their CI pipeline. It is not a service
where a stranger pastes a URL — it needs the test source code, not just a live site.

---

## Current Features (v1 scope)

### Test execution and failure capture
- Runs the existing Playwright suite and captures structured results.
- Detects failures caused by selector resolution (element not found, ambiguous match,
  wrong element matched).
- Distinguishes selector-drift failures from genuine application failures.

### Agentic investigation
- Captures a DOM snapshot of the page at the point of failure.
- An OpenAI tool-calling agent investigates using three tools:
  `get_dom_snapshot`, `query_selector`, `run_single_test`.
- The agent iterates — propose, check, refine — within a hard cap on tool calls.

### Execution-based verification
- A candidate selector is applied to a **temporary copy** of the spec file and the single
  affected test is executed for real.
- A fix is only ever considered valid if that execution passes.

### Assertion integrity check
- The proposed spec diff is compared against the original.
- Any change that removes, weakens, or skips an assertion is rejected outright,
  regardless of whether the test passed.

### Confidence gating
- Each verified fix receives a confidence level derived from observable signals:
  DOM match count, number of tool calls needed, whether the first candidate worked.
- High confidence → pull request opened automatically.
- Low confidence → routed to human review, no PR.
- No verified fix → marked failed, no PR, still persisted.

### Persistence
- Every test run and every heal attempt is stored in PostgreSQL, including failures.
- The full agent tool-call transcript is stored for later inspection.

### Pull request creation
- Verified high-confidence fixes are opened as a real PR against the repository via the
  GitHub REST API, with a diff and a summary of the agent's reasoning.

### Dashboard (read-only)
- **List view:** every heal attempt with status, confidence, and PR link.
- **Detail view:** replay of one investigation — the DOM the agent saw, the selectors it
  tried, the test output at each step.

---

## Future Features (priority order)

### GitHub App / Action packaging
Run automatically on push as a proper GitHub Action instead of a manual trigger.

### Human feedback loop
Approve/reject decisions on the dashboard feed back as few-shot examples to improve
future proposals.

### Multi-framework support
Cypress and Selenium adapters alongside Playwright.

### Failure clustering
Group heal attempts by semantic similarity to surface systemic drift (e.g. an entire
design-system rename) rather than 40 individual failures.

---

## Out of Scope

The following are explicitly **not** part of this project. Implementing them is a
scope violation, not an improvement:

- **Not a general website tester.** The tool cannot test a site it has no test source
  code for. Pasting a URL is not a supported entry point.
- **Not a test generator.** v1 repairs existing tests; it does not author new ones.
- **Does not fix application bugs.** If an element is genuinely gone or the app is
  broken, the correct output is "no fix found", not a workaround.
- **Does not auto-merge.** The tool opens PRs. A human merges. Always.
- **Does not modify test files in place** during investigation.
- **Does not handle non-selector failures** (timeouts, network flakiness, race
  conditions) in v1 — these are detected and skipped, not healed.
- **No authentication, multi-tenancy, or billing** in v1. The dashboard is local and
  read-only.
- **No self-hosted or fine-tuned models.** OpenAI API only.