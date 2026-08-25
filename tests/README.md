# Baseline Playwright Test Suite

This is the baseline test suite for the Self-Healing E2E Tests project. It must be green (5/5 passing) against the pristine `app-under-test/` application. Each spec file is the designated victim of exactly one Task 1.3 drift scenario.

## How to run

```sh
npm run test:e2e
```

Playwright will automatically start the application via `webServer` configuration.

## Spec → drift target → scenario mapping

| Spec file | Drift-target locator | Task 1.3 scenario | Expected failure signature |
| --- | --- | --- | --- |
| `tests/login-submit.spec.ts` | `#login-btn` | 1 — renamed `id` | action timeout waiting for `locator('#login-btn')` |
| `tests/cart-add.spec.ts` | `.add-to-cart` | 2 — renamed class | action timeout waiting for `locator('.add-to-cart')` |
| `tests/product-price.spec.ts` | `#product-card > .product-card__price` | 3 — DOM restructure | `toBeVisible` failed, locator resolved to 0 elements |
| `tests/login-validation.spec.ts` | `button:has-text("Sign In")` | 4 — text changed | `toBeVisible` failed, locator resolved to 0 elements |
| `tests/remember-preference.spec.ts` | `#remember-me` | 5 — element removed | `toBeVisible` failed, locator resolved to 0 elements; no valid replacement exists |

## JSON results contract

- `npm run test:e2e` writes Playwright JSON results to `test-results/results.json`
- Playwright artifacts (traces, etc.) go to `test-results/artifacts/`
- Both directories are gitignored

## Suite invariants

Rules for anyone editing these specs:

- One `test()` per file; no `test.describe`
- No `.only` or `.skip`
- No `page.waitForTimeout`
- No `getByRole`, `getByText`, `getByLabel`, `getByTestId`, or `getByPlaceholder` locator builders
- Every drift-target selector is a single string literal occurring exactly once in its file
- No `data-*` attribute selectors
