# Breakage scenarios

## Purpose

This directory seeds the five deliberate selector-drift scenarios of Task 1.3. The app under test is broken by swapping `index.html`, never by hand-editing it.

## Commands

| Command | Stdin | Stdout | Exit |
| --- | --- | --- | --- |
| `npm run break:on` | — | `breakage on` or `breakage already on` | 0 (or 1 if state unknown) |
| `npm run break:off` | — | `breakage off` | 0 |
| `npm run break:status` | — | one of: `pristine` \| `broken` \| `unknown` | 0 |

## How the toggle works

State is derived by byte comparison only; there is no state file. `breakage/apply.mjs` reads `app-under-test/index.html` and compares it byte-for-byte against two committed variants:
- `breakage/index.pristine.html` — the unbroken baseline (byte-identical copy of the original)
- `breakage/index.broken.html` — carries all five scenarios simultaneously

When `npm run break:on` is invoked from a pristine state, the script copies `index.broken.html` over `app-under-test/index.html`. When `npm run break:off` is invoked from any state, it copies `index.pristine.html` back unconditionally, restoring the app to working order.

**Never commit with breakage on.** Run `npm run break:off` before every commit. You can verify the committed state is pristine by checking that `git status --porcelain app-under-test/index.html` prints nothing.

## Scenario table

| # | Scenario | Spec file | Drift-target locator | Markup change | Expected agent outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | renamed `id` | `tests/login-submit.spec.ts` | `#login-btn` | `id="login-btn"` → `id="signin-button"` | healed, high confidence |
| 2 | renamed class | `tests/cart-add.spec.ts` | `.add-to-cart` | `class="add-to-cart"` → `class="purchase-button"` | healed, high confidence |
| 3 | DOM restructure | `tests/product-price.spec.ts` | `#product-card > .product-card__price` | price re-parented into `<div class="product-card__meta">` | healed, likely low confidence |
| 4 | text changed | `tests/login-validation.spec.ts` | `button:has-text("Sign In")` | button text `Sign In` → `Log In` | healed |
| 5 | element removed | `tests/remember-preference.spec.ts` | `#remember-me` | the whole `<label class="field field--inline">` block deleted | **no fix found** — confidence `none`, status `failed`, no PR |

## Failure signatures

Captured with Playwright 1.62.1.

### Scenario 1: login-submit.spec.ts

```
Error: locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('#login-btn')
```

### Scenario 2: cart-add.spec.ts

```
Error: locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('.add-to-cart')
```

### Scenario 3: product-price.spec.ts

```
Error: expect(locator).toBeVisible() failed

Locator: locator('#product-card > .product-card__price')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#product-card > .product-card__price')
```

### Scenario 4: login-validation.spec.ts

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button:has-text("Sign In")')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button:has-text("Sign In")')
```

### Scenario 5: remember-preference.spec.ts

```
Error: expect(locator).toBeVisible() failed

Locator: locator('#remember-me')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#remember-me')
```

## Why scenario 5 has no valid fix

- The entire `<label class="field field--inline">` block is deleted, taking with it both `#remember-me` and the visible text "Remember me". No text-based hook survives.
- With breakage on, the rendered page contains **zero** `input[type="checkbox"]` and **zero** `input[type="radio"]` elements.
- `tests/remember-preference.spec.ts` calls `.check()`, which Playwright rejects on any element that is not a checkbox or radio, and asserts `toBeChecked()`, which requires a checkable element.
- Therefore no selector substitution can make that test pass. The only route to green is removing or weakening an assertion, which the Task 2.3 assertion-integrity gate rejects before execution.
- The correct system outcome is confidence `none`, status `failed`, **no PR**. Reaching the tool-call cap without a verified pass is a normal, recorded result — not a bug.
