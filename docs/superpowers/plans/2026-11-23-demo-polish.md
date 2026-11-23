# Demo polish before the Nov 24 run: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Act on the facilitator's notes from trying the build: a teaser before the demo, a demo that plays on a loop while people arrive, a clearer "pick and share" step, haiku that look like haiku, a clear emoji limit, no overview prompt on screen, cards that fit the projector when crowded, and smooth animations.

**Architecture:** Same as the Nov 22 plan (`docs/superpowers/plans/2026-11-22-demo-and-haiku-themes.md`): rules in `server/session.js`, pure helpers in `server/flow.js`, timers as timestamps advanced by `tick()`, three screens fed by per-role views.

**Spec:** `Off the Record DevTalk Retro Spec.md` (source of truth, updated in the same commits) and `docs/superpowers/specs/2026-11-21-demo-and-haiku-themes-design.md`.

## Global Constraints

The Nov 22 plan's Global Constraints all still apply (no new dependencies; `npm test` green after every task; every promise on screen literally true; "the facilitator", never "Erik"; phones never receive comments, haiku, demo content, flags or the talk clock; fixed-label logs; spec updated in the same commit; nothing personal committed). Also:

- Nothing from the facilitator's demo file reaches anyone while the session is on the teaser.
- Animations use `transform` and `opacity` only, so the laptop's GPU can composite them.

## Review Focus

1. **The demo loop and the talk clock fighting each other.** The facilitator starts the talk clock at the first slide while the demo is mid-loop. Expected: the demo stops looping and waits on step 1. Pinned in Task 1.
2. **Two projector tabs, or a projector reload, mid-loop.** Expected: every projector shows the same step; the loop is driven by the server. Pinned in Task 1.
3. **A comment edited after others came in.** Expected: it keeps its place in the order. Pinned in Task 2.
4. **A card with 20 comments.** Expected: the first ones in submission order, at a readable minimum size, and "+N more". Pinned in Task 5.

---

### Task 1: Teaser phase and a demo that plays on a loop (server)

**Files:** `server/phases.js`, `server/session.js`, `server/flow.js` if useful, `server/demo.js`, `demo/example.json`, `server/index.js`, `test/demo.test.js`, `test/flow.test.js`, spec, README.

**Interfaces (produces):**
- `PHASES` starts with `'teaser'`: `['teaser', 'demo', 'join', …]`. `freshState()` and `reset()` start on `teaser`. `teaser` is outside the talk plan (no `PLAN` entry; leaving it never starts the talk clock).
- Demo file gains optional `teaser: { title, lines: [string] }` (title 1–60, up to 4 lines of 1–160). Missing → `{ title: 'Off the Record', lines: ['Starting soon.'] }`.
- Views in `teaser`: phone and projector both get `teaser: { title, lines }` and nothing from the demo; facilitator gets the same plus `next: 'demo'`.
- `state.demo = { step, cardId, auto, stepStartedAt }`. Entering `demo` forward from the teaser sets `auto: true`, `step: 0`.
- `DEMO_STEP_MS = [10_000, 14_000, 12_000, 14_000, 14_000]` (about a minute per loop; step 2 includes the send animation). `tick()` in `demo` with `auto`: when `now >= stepStartedAt + DEMO_STEP_MS[step]`, go to the next step, wrapping from the last to the first; set `stepStartedAt = now`; `changed()`.
- `demoStep(delta, { from })` (existing guard) also sets `auto = false`. New `demoAuto(on)` sets `auto` (and `stepStartedAt = now`). `startTalk()` while in `demo` sets `auto = false`, `step = 0`.
- Views in `demo`: projector `demo.auto`, `demo.stepStartedAt`; facilitator `demo.auto`.
- Facilitator action `demoAuto { on }` in `server/index.js`.

- [ ] **Step 1: Failing tests:** `a session starts on the teaser, and the teaser shows no demo content` (phone and projector JSON contain the teaser title but not the demo's note text); `leaving the teaser starts the demo on a loop`; `the loop advances on the server and wraps to the first step` (fake clock, `tick()`); `Next or Back takes the demo off the loop`; `starting the talk clock takes the demo off the loop and back to step 1`; `a teaser in the demo file is validated; without one, a plain teaser`; `leaving the teaser doesn't start the talk clock`.
- [ ] **Step 2: Run, see them fail.** `npm test`
- [ ] **Step 3: Implement.** Write the generic teaser into `demo/example.json` (invented, no real place or date).
- [ ] **Step 4: Run.** `npm test` passes.
- [ ] **Step 5: Spec and README** (teaser; the loop while people arrive; the talk clock takes it off the loop), **commit** "Add a teaser before the demo; the demo plays on a loop until the talk starts".

---

### Task 2: Comments in submission order; a clear emoji limit (server)

**Files:** `server/session.js`, `server/index.js` if needed, `test/session.test.js`, spec.

**Interfaces:**
- `commentsFor(groupId) → { shown, more }` and `allCommentsFor(groupId)`: submission order (oldest first), not the hash order. A resend with the receipt that changes the comment keeps the comment's original place (reuse its id). `COMMENTS_SHOWN` stays 5 as the default; Task 5 may show fewer.
- `LIMITS.emojisPerCard = 14` (the 8 presets plus 6 of your own, all the phone can show). Over it fails: `Up to 14 emojis on a card: remove ${n - 14}`.

- [ ] **Step 1: Failing tests:** `comments show oldest first; the newest are the ones counted in +N more`; `editing a comment keeps its place`; `the emoji limit says how many to remove`.
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5:** spec (comment order; the limit), **commit** "Comments in the order they came; the emoji limit says what to remove".

---

### Task 3: Phone: teaser screen and the emoji limit

**Files:** `public/phone.js`, `public/phone.css`.

- [ ] **Step 1:** `teaser` screen: the teaser title and lines; nothing to tap.
- [ ] **Step 2:** Reacting: once 14 emojis are picked on a card, the rest can't be added; a hint under the picker says "Up to 14 on a card. Tap one to remove it, then add another." The server's error text is shown as is if it ever arrives.
- [ ] **Step 3: Check headlessly** (scratch folder, `playwright-core` with the installed Chrome): teaser screen; pick all 8 presets and add 6 of your own → the hint, no error; `npm test`.
- [ ] **Step 4: Commit** "Phones: the teaser, and an emoji limit you can see before you hit it".

---

### Task 4: Projector: teaser, the looping demo, a sealed letter, haiku that look like haiku

**Files:** `public/projector.js`, `public/projector.css`.

- [ ] **Step 1: Teaser screen:** the title large and the lines below, centred; no QR, no waiting line, no section timer.
- [ ] **Step 2: Demo follows the server's step** (it already does); when `demo.auto`, each step plays its entry animation as it arrives, and a step's animation fits inside its `DEMO_STEP_MS`. No step counter on screen.
- [ ] **Step 3: Step 2 ("Pick up to 3 to share.") ends on the sending, not on the card.** Animate: the notes list, one note gets picked (its check fills), the "Share" button goes from disabled to enabled, a tap on it, then the note folds into a sealed envelope (no text visible on it) that slides away, and the phone shows "Shared. You can still share 2 more." The card text never appears in this step.
- [ ] **Step 4: Haiku look like haiku**, in the demo's step 3 and in the walk-through: split at " / ", show the separators as visible, dimmed " / " marks, and let lines break only at a separator, never inside a segment (a segment that is too wide shrinks its font, down to a floor, rather than wrap). In the demo, the three segments may sit on three lines, each ending with its " / " except the last. In the walk-through, one line if it fits, else breaking at separators.
- [ ] **Step 5: Overview:** remove the "First reactions? Anything surprise you?" line. (The facilitator's own prompts stay on the facilitator view.)
- [ ] **Step 6: Check headlessly** at 1280×720: teaser; a full demo loop with screenshots per step (step 2 mid-animation and at its end); a haiku whose middle segment is long; the overview; `npm test`.
- [ ] **Step 7: Commit** "Projector: teaser, demo on a loop, a sealed letter for sharing, haiku with their slashes".

---

### Task 5: Projector: crowded cards fit the screen

**Files:** `public/projector.js`, `public/projector.css`.

**Rule:** the walk-through card, mix, comments, haiku and counts row always fit in the viewport.
1. Lay out at the normal sizes. If it overflows, step down together, in small steps: the card text and comments font (floors: card text 2.6vw, comments 1.4vw, haiku 1.3vw) and the gaps and paddings (down to about half).
2. If it still overflows at the floors, show fewer comments, dropping the newest first, and count them in "+N more" (comments arrive oldest first from Task 2).
3. Re-fit when the view changes, when fonts finish loading (`document.fonts` `loadingdone`), and on resize. Also re-measure the emoji row after fonts load (the final review saw it measured before Noto Color Emoji loaded).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Check headlessly** with the overflow content in `/Users/eriktetland/.claude/jobs/e6dcde76/tmp/overflow-demo.mjs` (a 143-character card, 7 comments, 12 emojis, a haiku) plus a 20-comment variant and a short card with one comment: at 1280×720 and 1920×1080, `.walk .bottom` ends inside the viewport, nothing overlaps, and the short card keeps its normal sizes. `npm test`.
- [ ] **Step 3: Commit** "Projector: crowded cards shrink to fit, then show the oldest comments".

---

### Task 6: Facilitator: teaser and demo-loop controls

**Files:** `public/facilitate.js`, `public/facilitate.css`, spec (view table).

- [ ] **Step 1:** Teaser: the teaser text as the room sees it, and "Start the demo ▶" (`advance { from: 'teaser' }`), with an ⓘ: "Phones and the projector show this until you start the demo. Start it when people begin to arrive; it plays on a loop."
- [ ] **Step 2:** Demo: "Playing on a loop" / "Paused on step n" status; "◀ Back" and "Next ▶" (take it off the loop); "Play on a loop" (`demoAuto { on: true }`); "Start ▶" to Join as today. Starting the talk clock also takes it off the loop (say so in the ⓘ).
- [ ] **Step 3: Check headlessly; commit** "Facilitator: teaser and demo-loop controls".

---

### Task 7: Smooth animations

**Files:** whatever the measurements point at (`public/projector.js`, `public/projector.css`, `public/shared/*-timing.js`).

- [ ] **Step 1: Measure** frame times with a `requestAnimationFrame` probe in headless Chrome at 1280×720 for: each demo step's entry animation, the finale with 60 cards and ~400 reactions, and the shred with 60 cards. Record dropped frames (gaps over 25 ms) per animation.
- [ ] **Step 2: Fix the worst offenders**: animate only `transform`/`opacity`; no layout reads inside animation loops; `will-change` on moving elements; fewer DOM nodes where an animation creates hundreds (shred strips, finale particles), or one canvas.
- [ ] **Step 3: Shorter, calm, slow–fast–slow** (the facilitator's call, Nov 23): the finale and the shred together take about 30 seconds with a full room (60 cards, ~400 reactions), not counting the facilitator's "Ready to shred?" tap. Targets: finale about 12 s (replay ~6 s, pooling ~2.5 s, a quiet beat ~3 s before the prompt); shred about 18 s (the "Delete everything?" prelude ~2.5 s, the sheets ~11 s, settle + fade + black ~4.5 s). Inside each, pace slow at the start, faster in the middle, slow at the end (ease the replay's particle spacing and the gaps between sheets), so it stays calm. Fewer cards → shorter. `public/shared/finale-timing.js` and `public/shared/shred-timing.js` stay the single source for both the projector and the server.
- [ ] **Step 4: A "Speed up" button** on the facilitator view during the finale and the shred: one tap plays what's left about 3× faster (a second tap does nothing more). Server: `speedUp({ from: phase })` records `speedUp: { at, factor: 3 }` for the current part; the server's closing timer (shred) and the "Ready to shred?" prompt time (finale) are recomputed from it; the projector's view carries it and the animation scales its remaining time from `at`. Test with the fake clock: after `speedUp` at time t, the closing screen comes at t + (closingAt − (t − start)) / 3.
- [ ] **Step 5: Re-measure; record the new timings in the spec; commit** "Shorter, smoother finale and shred, with a speed-up button".

---

### Task 8: Facilitator's demo file and redeploy

- [ ] **Step 1:** Add a `teaser` to the facilitator's gitignored `demo/local.json` (the talk's public description and its date and venue); never committed.
- [ ] **Step 2:** `npm test`; push; redeploy with `deploy/deploy.sh <ip>` only if the live server is on the teaser, demo or closing (check the projector stream's `phase` first).
