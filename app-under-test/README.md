# App Under Test

This is test scaffolding, not a product—it exists to be deliberately broken in order to test the self-healing system.

## How to run

```sh
npm run start:app
```

The app is served at http://localhost:3100.

## Selector inventory

| Element | Selector | Purpose |
| --- | --- | --- |
| Email input | `#email` | interactive |
| Password input | `#password` | interactive |
| Remember-me checkbox | `#remember-me` | interactive |
| Submit button | `#login-btn` | interactive; text "Sign In" |
| Add-to-cart button | `.add-to-cart` | interactive; no id |
| Nav home link | `#nav-home` | interactive |
| Nav products link | `#nav-products` | interactive |
| Nav cart link | `#nav-cart` | interactive |
| Price | `#product-card > .product-card__price` | direct child |
| Cart counter | `#cart-count` | reserved hook; initial text `0` |
| Login status | `#login-status` | reserved hook; initially empty |
| Cart status | `#cart-status` | reserved hook; initially empty |
| Product title | `.product-card__title` | reserved hook reference |

## Reserved hooks

The following selectors are wired to `app.js`. Any drift scenario must preserve **all** of the following, or the seeded failure stops being selector drift and becomes an application failure — the exact category this system is required to refuse to heal:

- `#login-form`, `#login-status`, `#product-card`, `#cart-count`, `#cart-status` keep their `id` attributes.
- `#login-form` still contains one `input[type="email"]` and one `input[type="password"]` descendant.
- `#product-card` still contains exactly one `<button>` descendant.

Non-behavioural descendants of these elements **may** be re-parented — Task 1.3 scenario 3 does exactly that to `.product-card__price`. What is forbidden is breaking the relationships listed above.

## No `data-*` attributes

No attribute beginning with `data-` appears anywhere in `index.html`. This is a hard rule: a `data-testid` would give baseline tests a selector that never drifts, which would silently invalidate the entire self-healing test phase.

## Breakage

The committed `index.html` file is always in its pristine state. Selector-drift scenarios for testing are applied by swapping the file at runtime with two committed variants:

- `npm run break:on` — swaps `index.html` with the broken variant, enabling the five seeded drift scenarios
- `npm run break:off` — restores the pristine variant and resets the app to working order

The variants and toggle script live in `breakage/`; see `breakage/README.md` for details on the toggle mechanism and the five scenarios:

| # | Scenario | Drift |
| --- | --- | --- |
| 1 | renamed `id` | `#login-btn` → `#signin-button` |
| 2 | renamed class | `.add-to-cart` → `.purchase-button` |
| 3 | DOM restructure | `.product-card__price` wrapped in `<div class="product-card__meta">` |
| 4 | text changed | `Sign In` → `Log In` |
| 5 | element removed | `<label class="field field--inline">` block with `#remember-me` deleted |
