# Hyperframes Composition Brief: Self-Healing E2E Tests

## Objective
Create a short launch-style brag video for **Self-Healing E2E Tests**, a
CI-oriented tool that repairs Playwright tests broken by selector drift and
refuses to trust its own fix until it re-runs the test and watches it pass.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `/Users/ednilsonantonio/Desktop/mend`
- Primary files read: `README.md`, `dashboard/app/globals.css`,
  `docs/images/dashboard-list.png`, `docs/images/dashboard-detail.png`,
  `package.json`
- Product name: Self-Healing E2E Tests
- Tagline / strongest claim: "never accepts a fix without actually
  re-executing the test against a temp copy of the spec file and seeing it
  pass" — and the honesty claim: one seeded scenario is intentionally
  unfixable, and the tool reports that truthfully instead of forcing a fix.
- Key UI or visual moment to recreate: the real dashboard list-view row
  (status badge + confidence badge + selector-change text) and the real
  detail-view verification block (`Executed: yes` / `Passed: yes` + the
  before/after selector diff row), both shown in
  `docs/images/dashboard-list.png` and `docs/images/dashboard-detail.png`.
- Copy that must appear verbatim:
  - `.add-to-cart` → `.purchase-button` (real selector diff from the detail
    view screenshot)
  - `Executed: yes` / `Passed: yes`
  - "Verified by execution. Not vibes." (brief's own line, matches the
    project's stated invariant — not literal README text, written to carry
    it)
  - "Self-Healing E2E Tests"

## Creative Direction
- Tone preset: polished
- Creative direction: a rigor demo — the agent has to prove it, not claim
  it. Cold, procedural, confident because it checked.
- Interpretation: 4 scenes, longer holds, restrained motion, mixed-case
  type, no aggressive weight. No jokes, no hype language. The product's own
  visual language (badges, mono selectors, diff table, verification block)
  carries all the energy. Slow crossfades (0.6-0.8s), quiet confidence.
- Angle: Most "AI agent" demos sell confidence. This one sells the
  opposite — an agent that isn't allowed to be believed. It proves every fix
  by actually re-running the test, its confidence score comes from measured
  signals instead of self-reported certainty, and when it can't find a real
  fix it says so, on camera, next to the wins. The video walks one heal
  end-to-end and then reveals the row that didn't heal, because that's the
  actual flex.
- Hook: a real selector (`.add-to-cart`) struck through in mono type, with
  the app's real red FAILED badge slamming in beside it. No headline yet.
- Outro / punchline: wordmark "Self-Healing E2E Tests," then "Verified by
  execution. Not vibes.," then a final small line: "A human still merges."
- Avoid:
  - Generic SaaS language ("streamline your workflow" etc.)
  - Abstract filler visuals — every scene must show real product chrome
  - Any visual redesign of the dashboard's palette or badge shapes — reuse
    them as-is
  - Treating the FAILED/NONE row as a loss — it must read as intentional,
    same visual confidence as the HEALED rows

## Visual Identity
- Background: `#f9f9f9` (page bg)
- Panel: `#ffffff` fill, `#dddddd` 1px border, 4px radius
- Text: `#333333` primary, `#666666` secondary
- Accent / link: `#0066cc`
- Status green (healed/pass): bg `#dcfce7`, text `#166534`
- Confidence high: bg `#d1fae5`, text `#065f46`
- Status red (failed): bg `#fee2e2`, text `#991b1b`
- Confidence none: bg `#e5e7eb`, text `#374151`
- Display font: system UI stack (-apple-system, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif) — no custom display font
- Body font: same system UI stack
- Mono font: Monaco, "Courier New", monospace — use for every selector
  string, diff line, and terminal output line
- Visual references from the project: badge shapes (`border-radius: 3px`,
  uppercase, `0.8rem`, bold, letter-spacing `0.5px`), the diff table's
  red-tinted/green-tinted before/after cells, the detail view's blue-bordered
  callout note style (`border-left: 4px solid #0066cc`, bg `#f0f8ff`) —
  usable for the hook's or outro's supporting line if a callout treatment
  is wanted, but keep it optional, not mandatory.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract
(full scene-by-scene detail, sequencing, and audio intent live there). Scene
summary:

1. **The break** — 4s — Off-white bg. Mono `.add-to-cart` with a hard red
   strikethrough; the app's real FAILED badge slams in beside it. One hard
   entrance, no other copy.
2. **Investigate, then verify** — 7s — White panel, mono type. Three tool-call
   lines (`get_dom_snapshot`, `query_selector`, `run_single_test`) tick in
   one by one, then the real diff row (`.add-to-cart` → `.purchase-button`,
   red/green tinted cells), then the verification block lights up green:
   `Executed: yes` / `Passed: yes`, with "1 passed (1.1s)" beneath.
3. **The honest dashboard** — 6s — Real list-view rows on off-white bg. Four
   HEALED/HIGH badge rows arrive in sequence with their selector-change
   text, then — after a deliberately longer pause — a fifth row lands
   differently: FAILED/NONE, `#remember-me → —`. Caption: "4 healed. 1 told
   the truth."
4. **Outro** — 3s — Off-white bg. Wordmark "Self-Healing E2E Tests" centers,
   then "Verified by execution. Not vibes." beneath it, then a smaller final
   line fades in after a hold: "A human still merges."

## Audio
- Audio role: sparse professional accents over a restrained bed
- Audio arc: quiet procedural ticks through investigation → one clean
  confirm chime on verification pass → even-handed arrival sounds for both
  the healed and the failed dashboard rows (no editorializing the failure as
  a loss) → music resolves to silence under the closing line
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (already
  copied to `composition/assets/music/`) — steady, clean, ~110 BPM, the
  bundled catalog's polished/cinematic pick
- Music treatment: enters low (~0.3 volume) under Scene 1, steady bed
  through Scene 2, slight presence lift into Scene 3, fades out through
  Scene 4 — silent by the last frame
- Music cue guidance: preset copied to
  `composition/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (and matching `.md`). 109.96 BPM. Strong-cue candidates in the 0-25s
  window: ~8.74s, ~13.11s, ~17.47s, ~18.56s, ~22.93s, ~24.56s. Suggested
  (optional, not mandatory) locks: verification "Passed: yes" near 8.74s,
  first HEALED row entrance near 13.11s, FAILED-row landing and/or outro
  wordmark entrance near 17.47s/18.56s. Use only 1-3 locks; ignore any that
  hurt readability or pacing. Beat grid is otherwise ~0.5-0.55s apart —
  usable for the Scene 2 tool-call ticks, but hold each readable line to its
  reading floor rather than snapping every line to a beat.
- Audio-reactive treatment: subtle only — e.g. the white panel's border or
  the badge glow may breathe very slightly with RMS. No waveform/equalizer
  visuals, no strobing. Skip entirely if it risks distracting from a
  restrained tone; document if extraction is unavailable.
- Audio-coupled moments:
  - Scene 1 badge slam — one dry, low thud, not dramatic
  - Scene 2 tool-call lines — soft key-tick per line; one clean confirm
    chime on "Passed: yes"
  - Scene 3 row arrivals — light consistent card/row sound on rows 1-4; a
    distinct lower, dry tone on row 5 that reads as deliberate, not negative
  - Scene 4 final line — one last soft tick paired with its fade-in
- SFX selection guidance: polished tone → minimal but present, 2-3 subtle
  cues per the skill's tone→SFX table (e.g. `interface/bong_001` or
  `interface/drop_001` family for soft reveals; a plain `interface/click_*`
  or `ui/click*` for the row arrivals; nothing from the aggressive/chaotic
  families). Match card/row arrivals to a card- or drop-style sound, not a
  chip/casino sound — this is a data table, not a game.
- SFX analysis guidance: read
  `skills/brag/assets/sfx/sfx-analysis.md` (or the installed-skill path) and
  prefer low/medium high-frequency-risk files since this video repeats a
  similar sound 4-5 times in Scene 3.
- Exact SFX choice: Hyperframes should choose exact filenames, timestamps,
  density, and volume based on the implemented animation.
- Audio files: music already copied into `composition/assets/music/`; copy
  any chosen SFX into `composition/assets/sfx/` before referencing them.

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core`
(composition contract + `data-*` timing), `hyperframes-animation` (motion),
`hyperframes-creative` (design spec, beats, audio-reactive),
`hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli`
(lint/check/render). `/brag` is its own workflow: do not enter the
`hyperframes` entry-point intent interview and do not route into its generic
promo / launch-video workflow. Prefer native Hyperframes conventions over
anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source
  project (the dashboard badge/diff/verification chrome above satisfies
  this — recreate it faithfully, don't invent a new visual system).
- Keep all text readable in the final render — hold every line to at least
  its reading floor (short label ~0.8s settled; a full sentence ~0.3s/word,
  minimum ~1.2s).
- Keep the video within 15-25 seconds (target 20s per the plan).
- Include the planned music/SFX layer — not disabled and not documented as
  intentionally silent.
- Treat `/brag`'s audio notes as guidance, not a fixed cue sheet. Choose
  exact SFX after the visual animation exists.
- Treat the music cue metadata above as optional timing hints. Ignore cues
  that hurt readability, scene pacing, or the product story. Use only 1-3
  strong-cue locks in this 20s video.
- Major reveals may move toward a nearby strong cue within ~0.15s; smaller
  entrances may align to nearby beat points within ~0.10s.
- For Scene 3's sequential row reveals: if beats are closer together than
  the reading floor for that row's text, do not snap every row to every
  beat — snap to every other beat, or reveal quickly and hold the full set,
  per the plan's reading-time guidance.
- Honor the planned music treatment (fade-in under Scene 1, steady bed,
  fade-out under Scene 4) using the best Hyperframes-supported
  implementation.
- Consider the Hyperframes audio-reactive workflow for one subtle,
  brand-appropriate element (see Audio section above); skip and document if
  extraction is unavailable — do not block the render on it.
- Use local assets (already copied under `composition/assets/`) for audio;
  copy any additional local assets needed.
- Run `hyperframes check` before render — it is `/brag`'s single gate.
