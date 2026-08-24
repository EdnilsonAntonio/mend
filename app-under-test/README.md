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

The following selectors are wired to `app.js` and **must not** be renamed or restructured by any drift script:

- `#login-form`
- `#login-status`
- `#product-card`
- `#cart-count`
- `#cart-status`

## No `data-*` attributes

No attribute beginning with `data-` appears anywhere in `index.html`. This is a hard rule: a `data-testid` would give baseline tests a selector that never drifts, which would silently invalidate the entire self-healing test phase.
