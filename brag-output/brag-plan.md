# Brag Plan: Self-Healing E2E Tests

## What is this app?
A CI tool where an AI agent repairs Playwright tests broken by selector drift —
but it refuses to accept its own fix until it actually re-runs the test on a
temp copy of the spec and watches it pass.

## The angle
Most "AI agent" demos sell confidence. This one sells the opposite: an agent
that isn't allowed to be believed. It has to prove every fix by execution, its
confidence score comes from measured signals (DOM match count, tool-call
count) instead of self-reported certainty, and when it can't find a real fix
it says so — on camera, in the same dashboard, right next to the wins. The
video's job is to walk one heal end-to-end (break → investigate → verify →
pass) and then reveal the row that didn't heal, because that row is the actual
flex.

## Hook (first 2-3 seconds)
A real selector, struck through, in mono type on the app's own off-white
background: `.add-to-cart` with a hard red strike and a red FAILED badge
(the app's real badge style, `#fee2e2` / `#991b1b`) slamming in beside it.
No headline yet — just the failure, stated in the product's own visual
language.

## Key moments (the middle)
- The agent's tool calls ticking in one at a time — `get_dom_snapshot`,
  `query_selector`, `run_single_test` — ending on the real recorded diff:
  `.add-to-cart` → `.purchase-button`.
- The verification block from the actual detail view lighting up green:
  `Executed: yes` / `Passed: yes`, with the real terminal line "1 passed
  (1.1s)" underneath it. This is the whole thesis of the project, shown, not
  claimed.
- The real list-view rows arriving in sequence: four HEALED / HIGH badges,
  then a fifth row that lands different — FAILED / NONE, `#remember-me → —`,
  no fabricated fix.

## Outro / punchline
Wordmark on the app's own background: "Self-Healing E2E Tests." Beneath it,
the line the whole video has been proving: "Verified by execution. Not
vibes." One last small line fades in after a beat: "A human still merges."

## User flow worth showing
Entry → key action → result, pulled straight from the README quickstart and
the real dashboard screenshots:
1. A seeded breakage scenario fails a test (`#login-btn` type selector drift).
2. The agent investigates (DOM snapshot → selector query) and proposes a
   fix, then re-executes it on a temp copy — this is the key action, and it
   must be shown as an actual re-run with a pass/fail result, not implied.
3. The dashboard records the result: HEALED at HIGH confidence for the fixable
   cases, FAILED at NONE confidence for the one genuinely unfixable case
   (element removed from the DOM) — both outcomes visible side by side.

## Tone
- Preset: polished
- Creative direction: a rigor demo — the agent has to prove it, not claim it.
  Cold, procedural, confident because it checked.
- Interpretation: Few scenes, longer holds, restrained motion. No jokes, no
  hype language — the product's own precision (badges, diffs, verification
  lines) carries the energy. Confidence through what's shown, not how loud
  it's said.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: `#f9f9f9` (page bg), panels on `#ffffff` with `#dddddd` borders
- Accent / link: `#0066cc`
- Text: `#333333` primary, `#666666` secondary/subtitle
- Status green (healed/pass): bg `#dcfce7`, text `#166534`; confidence-high bg
  `#d1fae5`, text `#065f46`
- Status red (failed): bg `#fee2e2`, text `#991b1b`
- Status neutral (confidence none): bg `#e5e7eb`, text `#374151`
- Display font: system UI stack (-apple-system, Segoe UI, Roboto, Helvetica
  Neue, Arial) — no custom display font, keep it plain and functional
- Mono font: Monaco / Courier New — use for every selector string and code
  line, exactly as the dashboard does
- Strongest visual element: the dashboard's own badge system (HEALED/FAILED,
  HIGH/NONE) and its before/after selector diff row — real product chrome,
  not a recreation of marketing copy

## Share copy (draft)
Most AI agents tell you they're confident. This one has to prove it — it
re-runs your test and watches it pass before it believes itself. Self-healing
E2E tests, verified by execution, not vibes.

## Audio direction
- Role: sparse professional accents over a restrained corporate-tech bed
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady,
  clean, ~110 BPM) — the "polished/cinematic" pick per the bundled catalog,
  confident and understated, not celebratory
- Music treatment: enters low under the hook, stays a bed through the
  investigate/verify scene, lifts slightly into the row-reveal scene, gentle
  fade under the outro line
- Music cue guidance: preset available at
  `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (109.96 BPM, cues generated for 0-25s window). Strong cues worth targeting:
  ~8.74s (verification "Passed: yes" landing in Scene 2), ~13.11s (first
  HEALED row entrance in Scene 3), ~17.47s/18.56s (the FAILED-row beat and/or
  the outro wordmark entrance at the Scene 3→4 boundary). Beat grid is
  otherwise ~0.5-0.55s apart — usable for the tool-call ticks in Scene 2, but
  hold each line to its reading floor rather than snapping every line to a
  beat.
- Audio-reactive treatment: none — restraint is the point of this tone
- SFX posture: sparse, motion-matched, no drama. A dry low tick on the hook's
  failure; soft terminal-key ticks on the three tool-call lines; one clean
  confirm chime on "Passed: yes"; a bright short tone per HEALED row arriving,
  a distinct lower/dry tone on the FAILED row; a final soft tick on the
  outro's last line
- Audio-coupled moments: tool-call lines ticking in one by one; verification
  "yes" landing; the five dashboard rows arriving in sequence with the fifth
  deliberately sounding different
- Restraint rule: no whooshes, no risers, no victory stingers — nothing that
  editorializes the FAILED row as a loss. It should sound exactly as
  intentional as the HEALED rows.

## Storyboard

### Scene 1 — The break — 4s
Off-white app background (`#f9f9f9`). Center: mono text `.add-to-cart`
with a hard red strikethrough, a red FAILED badge (`#fee2e2`/`#991b1b`,
uppercase, the app's real badge shape) slams in beside it. No other copy.
Sequential/interaction: none — one hard entrance.
Audio intent: a single dry, low thud on the strike/badge landing — not
dramatic, matter-of-fact.
Audio-coupled idea: badge slam synced to the thud.
Music: bed enters quiet under this scene.
Transition mood: clean, hard cut → Scene 2.

### Scene 2 — Investigate, then verify — 7s
Panel on white (`#ffffff`, `#dddddd` border), mono type. Three lines tick in
one by one: `get_dom_snapshot`, `query_selector`, `run_single_test`. They
settle, then the real diff row appears: `.add-to-cart` → `.purchase-button`
(before in red-tinted cell, after in green-tinted cell, matching the app's
diff-table styling). Then the verification block lights up: `Executed: yes`
/ `Passed: yes` in green, with the terminal line "1 passed (1.1s)" beneath.
Sequential/interaction: yes — 3 tool-call lines arrive one by one (~0.7s
apart, each held to its reading floor), then the diff row, then the two
verification lines land together.
Audio intent: quiet procedural ticks building to one small, earned
confirmation — not a triumphant sting, just a clean "checked."
Audio-coupled idea: soft key-tick per tool-call line; single clean chime on
"Passed: yes."
Music: steady bed, no swell yet.
Transition mood: soft crossfade → Scene 3.

### Scene 3 — The honest dashboard — 6s
Recreate the real list-view rows on the app's off-white background. Four
rows arrive in sequence, each a HEALED (`#dcfce7`/`#166534`) + HIGH
(`#d1fae5`/`#065f46`) badge pair with its real selector-change text (e.g.
`.add-to-cart → .purchase-button`, `#login-btn → #signin-button`). Then a
beat longer than the others, and a fifth row lands differently: FAILED
(`#fee2e2`/`#991b1b`) + NONE (`#e5e7eb`/`#374151`), selector change
`#remember-me → —`. Small caption beneath the table: "4 healed. 1 told the
truth."
Sequential/interaction: yes — rows 1-4 arrive at even, readable intervals
(~0.5-0.6s apart, each held to its floor); a clear extra pause before row 5.
Audio intent: light, consistent card-arrival sound on the first four; a
distinct lower, dry tone on the fifth that reads as deliberate, not negative.
Audio-coupled idea: per-row arrival sound; caption line settles after the
fifth row, not before.
Music: cues toward strong beats around 16-18s for the row arrivals if timing
allows; do not force it if it costs readability.
Transition mood: soft crossfade → Scene 4.

### Scene 4 — Outro — 3s
Off-white background. Wordmark "Self-Healing E2E Tests" centers, mixed case,
medium weight. Beneath it: "Verified by execution. Not vibes." After a short
hold, a smaller final line fades in below both: "A human still merges."
Sequential/interaction: none — two-step reveal (wordmark+tagline, then the
final line).
Audio intent: music resolves and fades under the wordmark; one last soft
tick on the final line landing.
Audio-coupled idea: final line's fade-in paired with the last tick.
Music: fades out through the scene, gone by the last frame.
Transition mood: slow crossfade in, hold to black.

**Music mood for this video:** polished / restrained corporate-tech, 120 BPM bed, no swell, no stinger.
**Audio summary:** A quiet, procedural audio arc — dry ticks for verification steps, one clean confirm chime, even-handed arrival sounds for both healed and failed rows, resolving to silence under the closing line.
