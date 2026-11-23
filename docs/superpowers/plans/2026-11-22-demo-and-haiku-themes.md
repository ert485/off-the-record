# Talk flow for Nov 25: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nov 25 talk flow: a scripted demo stage, comments written while reacting, a self-running flow on a 25-minute talk clock where the facilitator confirms each move, a haiku per theme with early grouping and a quick late-arrival check, and folder tabs on the projector.

**Architecture:** All rules stay in `server/session.js` (state and actions, no HTTP, no disk), with new pure helpers in `server/flow.js` (prompts and walk-through timing) and `server/demo.js` (the demo data file). Timers are timestamps in state, advanced by the existing 1-second `session.tick()`, so a server restart resumes where it was. The three screens get the new fields through the existing per-role views over SSE.

**Tech Stack:** Node 22, `node:sqlite`, `node:test`, plain HTML/JS with no build step, `@anthropic-ai/sdk` (Claude Haiku 5.5, `claude-haiku-5-5`).

**Spec:** `docs/superpowers/specs/2026-11-21-demo-and-haiku-themes-design.md` (the design), and `Off the Record DevTalk Retro Spec.md` (the source of truth, updated in the same commits as the build).

**Dates:** build Nov 22–23; solo run on the projector, a laptop and two phones on Nov 24; talk Nov 25.

## Global Constraints

- No new dependencies: `package.json` dependencies stay `@anthropic-ai/sdk` and `qrcode`.
- `npm test` passes at the end of every task.
- Model `claude-haiku-5-5`. Full grouping runs at effort `high`; the late-arrival call at effort `low`, aiming under 10 seconds.
- Every promise on screen is literally true. The trust disclosure says the facilitator can remove any card or comment.
- "The facilitator", never "Erik", in app text and in the spec, except the talk's own logistics (who, where, when).
- The projector never shows "behind", "over" or a per-card number. The one per-card signal in the room is the walk-through's draining bar.
- Phones never receive hidden cards, unapproved theme names, haiku, comments, demo content, the pace marker or the talk clock.
- Errors and logs print fixed labels only: never card, comment or demo text, never an IP address.
- Each task updates the spec sections it changes, in the same commit (the spec's rule).
- Nothing personal in committed files. The facilitator's own demo file, `demo/local.json`, is gitignored (already, in the plan commit).

## Review Focus

1. **Two facilitator devices tap the same move.** The laptop and the phone both show "Ready for grouping? ▶"; both get tapped. Expected: one move, never a skipped part or card. Pinned in Task 3 (`advance({ from })`) and Task 4 (`moveCard(delta, { from })`).
2. **"+1 minute" after the time is already up.** Expected: the prompt goes away until the new time runs out, and phones see the new time. Pinned in Task 3.
3. **An almost empty round.** Only the demo card, or no cards at all: theme count, walk-through timing (no division by zero) and grouping must still work. Pinned in Tasks 4 and 5.
4. **A server restart mid-part.** During the early grouping, the late-arrival call or the walk-through. Expected: running calls run again; the walk-through resumes with its timers. Pinned in Tasks 4 and 6.
5. **A half-typed comment when reactions close or the phone reloads.** Expected: the draft survives a reload, and is sent with the card when reactions close. Pinned in Task 8 (manual check) and Task 3 (the 10-second grace).

## If time runs short

Cut from the end, in this order: the file-drawer overview in Task 10 (keep plain tabs), the animated phone in Task 11 (static steps instead), the facilitator's "next card" comment preview in Task 9. Tasks 1–8 are the talk.

## File map

| File | Change |
| --- | --- |
| `spike/late-arrivals.mjs`, `spike/early-grouping.json` | New: the late-arrival spike and its cached early grouping (synthetic cards only) |
| `server/phases.js` | New phase list and talk plan, timing constants |
| `server/flow.js` | New: `pendingMove()`, `walkEndsAt()`, `cardMs()` |
| `server/session.js` | Comments while reacting, talk clock, confirmed moves, self-running walk-through, haiku, early grouping, late arrivals, demo stage; anonymous pause and last call removed |
| `server/cluster.js` | Prompt from the spike, haiku, theme count, effort; `createPlacer()` for late arrivals |
| `server/demo.js`, `demo/example.json` | New: demo data loader and the committed generic example |
| `server/index.js` | New actions, demo loading, `TALK_MINUTES` |
| `public/shared/finale-timing.js` | New: finale timeline shared by projector and server |
| `public/phone.js`, `public/phone.css` | "Starting soon", comment box, react warnings, Stay/Go back only |
| `public/facilitate.js`, `public/facilitate.css` | Talk clock, demo controls, the one prompt, haiku editing, late-arrival choice, walk controls |
| `public/projector.js`, `public/projector.css` | Waiting line, demo phone, folder tabs, haiku, comments, drain bar, last slide |
| `deploy/deploy.sh` | Don't deploy `spike/` |
| `test/*.test.js` | New: `flow`, `walk`, `cluster`, `late`, `demo`; updated: `session`, `shred` |

---

### Task 1: Spike: the late-arrival quick call

Tests the design's assumption before anything depends on it: one low-effort call, given the early themes and the late cards, places each late card and flags when the late cards would change the picture, in under 10 seconds.

**Files:**
- Create: `spike/late-arrivals.mjs`, `spike/early-grouping.json` (written by the script)
- Modify: `docs/superpowers/specs/2026-11-21-demo-and-haiku-themes-design.md` (results)

**Interfaces:**
- Produces (copied into `server/cluster.js` in Task 6): `LATE_SYSTEM` (prompt string) and `LATE_SCHEMA`:
  ```js
  { placements: [{ card: int, theme: int, group: int /* 0 = a new group in that theme */, fits_well: bool, reason: string /* one line when fits_well is false, else "" */ }],
    missing_themes: [{ cards: int[], reason: string }] }
  ```
  Input: one JSON line per existing theme `{ theme, name, haiku, groups: [{ group, texts }] }`, then one per late card `{ card, text }`. Flagged = any `fits_well: false` or any `missing_themes` entry. (No nullable fields, so no `anyOf` in the schema.)

- [ ] **Step 1: Write `spike/late-arrivals.mjs [runs=3] [effort=low]`**
  - Cards are `spike/seed-cards.txt` lines, id = line number. `LATE_FIT = [7, 40, 42, 57, 58]` (each has a near-duplicate or close sibling among the early cards); `LATE_NEW = [1, 2, 3]` (the truck-strike cluster; line 49, bridge construction, stays early on purpose, the hard case).
  - Early cards = all others (52). If `spike/early-grouping.json` is missing, group them once with the `SYSTEM`/`SCHEMA` from `spike/haiku-themes.mjs` at effort `high`, "about 4 themes", streamed; number themes from 101 and groups from 1001; save it. Otherwise load it.
  - Scenario A: late = `LATE_FIT`. Scenario B: late = `LATE_FIT + LATE_NEW`. Each runs `runs` times with `max_tokens: 4000`, non-streaming, timing the call.
  - Print per run: seconds, output tokens, each placement (card text → theme name, group or "new group", fit), each missing theme with its cards and reason.
  - Print the verdict: B flags a missing theme holding at least 2 of cards 1–3 in every run; A has no flags (report how many runs did); every run under 10 s.
  - Only the synthetic seed cards are sent. The key comes from the environment; the script never prints it.

- [ ] **Step 2: Run it**

  Run: `node --env-file=<spike key file> spike/late-arrivals.mjs 3 low` (Erik gives the key file path; never print or copy the key)
  Expected: the verdict lines. Record the seconds and the placements.

- [ ] **Step 3: Tune, at most three prompt revisions**

  If B isn't flagged every run: sharpen the "missing theme" instruction (cards that share an experience no theme covers, even if each could squeeze into one). If A is flagged: tell it a card that fits a theme loosely still fits. If over 10 s: try `max_tokens` lower and shorter `reason` text before trying effort `medium` (re-time it).

- [ ] **Step 4: Gate**

  If B is flagged every run and every run is under 10 s: record the results (timing table, A's false-flag count, the final prompt) in the design doc's "Late arrivals" section and go on. Otherwise stop and report to Erik with the numbers before Task 6 (Tasks 2–5 don't depend on this).

- [ ] **Step 5: Commit**

  ```bash
  git add spike/late-arrivals.mjs spike/early-grouping.json docs/superpowers/specs/2026-11-21-demo-and-haiku-themes-design.md
  git commit -m "Spike: test the late-arrival quick call; record the results in the design"
  ```

---

### Task 2: Comments while reacting; the anonymous pause goes

**Files:**
- Modify: `server/session.js`, `server/index.js`, `test/session.test.js`, `test/shred.test.js`, spec ("Session flow" 4–6, "Trust disclosure", the view table, "Design rules")

**Interfaces:**
- Produces:
  - `Session.react(cid, groupId, emojis, receipt, comment) → { receipt }`. `comment` is optional: trimmed, `''`/missing means none, over `LIMITS.commentMax` (200) fails `Comments are up to 200 characters`. `emojis` may be empty when there is a comment. A send with neither fails `Pick an emoji or write a comment`.
  - Comment state: `{ id, g, text, r }` (`r` = the card's receipt, so a resend replaces the comment with the reactions). No phone id.
  - `Session.commentsFor(groupId) → { shown: [{ id, text }], more: number }`: up to `COMMENTS_SHOWN = 5`, in a stable order (sorted by `sha256(sessionId + ':' + id)`).
  - Projector walk view: `comments: { shown, more }`. Facilitator view: `comments: { current: [{ id, text }], next: [{ id, text }] }` (all of them, for Remove).
  - Phone `react` action body gains `comment`. `signal` kinds are `stay` and `back` only.
  - Removed: `PAUSE`, `requestPause`, `acceptPause`, `holdPause`, `endPause`, `openComment`, `cancelComment`, `submitComment`, `pauseView`, `checkPause`, state `pause`/`pauseRequests`/`pauseHeld`, signal `moveOn`, and their actions in `server/index.js`. `tick()` stays (later tasks use it).

- [ ] **Step 1: Write the failing tests** in `test/session.test.js` (replace the three pause tests and the remove-comment test):
  - `a comment is sent with a card's reactions and stored with no author`: `react(A, g, ['🙋'], null, '  ha ')` → `state.comments` has one entry, `Object.keys` deep-equals `['id', 'g', 'text', 'r']`, `text === 'ha'`, and `JSON.stringify(state.comments)` doesn't include `A`.
  - `sending again with the receipt replaces the reactions and the comment`: resend with `comment: 'new'` → only `'new'`; resend with `comment: ''` → none, reactions replaced.
  - `a comment alone counts as a send; nothing at all does not`: `react(A, g, [], null, 'x')` works; `react(B, g, [], null, '')` throws `/Pick an emoji or write a comment/`.
  - `comments are capped like cards`: 201 characters throws `/up to 200/`.
  - `the projector shows up to 5 comments in a stable order, the rest counted`: 7 phones comment on one card → `walk.comments.shown.length === 5`, `more === 2`, same order in two views.
  - `the facilitator sees every comment on the current and next card, and can remove one`: `comments.current` has all 7 ids; after `removeComment(id)` the projector no longer has it.
  - `the anonymous pause and move on are gone`: `session.requestPause === undefined`; `signal(A, 'moveOn', true)` throws `/Unknown signal/`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: the new tests FAIL (comment argument ignored, pause methods present).

- [ ] **Step 3: Implement in `server/session.js` and `server/index.js`** as the Interfaces block says. Update `test/shred.test.js`: drop the pause steps; each phone's reactions carry `comment: \`comment ${MARKER}\``; keep the rest.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS, including `the shred leaves nothing behind`.

- [ ] **Step 5: Update the spec and commit**

  Spec: comments are written while reacting (one per phone per card, replaced with the receipt, no author); the walk-through shows up to 5 with "+N more"; the facilitator sees comments on the current and next card and can remove them before they're projected; the anonymous pause, its rules and "move on" are removed; the disclosure line becomes "I see cards and comments before they're shown and can remove any of them to prevent abuse." (also in the "Trust disclosure" draft).

  ```bash
  git add server test "Off the Record DevTalk Retro Spec.md"
  git commit -m "Comments are written while reacting; the anonymous pause goes"
  ```

---

### Task 3: Talk clock, new phase plan, and moves the facilitator confirms

**Files:**
- Create: `server/flow.js`, `public/shared/finale-timing.js`, `test/flow.test.js`
- Modify: `server/phases.js`, `server/session.js`, `server/index.js`, `public/projector.js` (finale constants only), `test/session.test.js`, `test/shred.test.js`, spec ("Session flow", timing table, pace and section timer)

**Interfaces:**
- Produces, in `server/phases.js`:
  - `PHASES = ['demo', 'join', 'submit', 'cluster', 'react', 'walk', 'finale', 'shred', 'closing']` (`lastcall` removed; Task 4 adds the last slide; Task 7 fills the demo).
  - `PLAN` (talk-clock minutes): demo [1.5, 3.5], join [3.5, 5], submit [5, 10], cluster [10, 10.5], react [10.5, 15.5], walk [15.5, 21.5], finale [21.5, 22.5], shred [22.5, 23.5], closing [23.5, 24.5].
  - `TALK_MINUTES = 25`, `SUBMIT_MINUTES = 5`, `REACT_MINUTES = 5`, `REACT_GRACE_MS = 10_000`.
- In `public/shared/finale-timing.js`: `finaleTimeline(reactionCount) → { doneAt }` (ms from the finale's start: the projector's current start delay 1200, replay `min(400 * n, 10_000)` (sampled as today), pool delay 2000, pool 1300, then `QUIET_MS = 8000`). `public/projector.js` imports its constants from here instead of defining them.
- In `server/flow.js`: `pendingMove(state, now, { phoneCount }) → null | { to, label }`:
  - submit, `now >= submitEndsAt` → `{ to: 'cluster', label: 'Ready for grouping?' }`
  - react, `now >= reactEndsAt`, or `phoneCount > 0` and phones with `reactDone` ≥ `phoneCount` → `{ to: 'walk', label: 'Ready for the walk-through?' }`
  - finale, `now >= phaseStartedAt + finaleTimeline(reactions.length).doneAt` → `{ to: 'shred', label: 'Ready to shred?' }`
  - otherwise `null` (Task 4 adds the walk-through, Task 6 the grouping choice).
- In `server/session.js`:
  - State: `talk: { startedAt: null, minutes }` (replaces `clockStart`); `reactEndsAt`; `reactClosedAt`. `freshState()` starts in `demo`.
  - Constructor option `talkMinutes = TALK_MINUTES`; `server/index.js` passes `Number(process.env.TALK_MINUTES) || undefined`.
  - `startTalk()`: sets `talk.startedAt` once; a second call is a no-op.
  - Entering any phase after `demo` going forward with no talk clock starts it backdated: `startedAt = now - PLAN[to][0] * 60_000`.
  - `advance({ confirm, from })`: with `from` given and `from !== phase`, fails `Already moved on`. Entering `react` forward sets `reactEndsAt = now + 5 min`; leaving `react` forward sets `reactClosedAt = now`.
  - `react()` is accepted while `phase === 'react'`, or in `walk` within `REACT_GRACE_MS` of `reactClosedAt`.
  - `extendReact()`: `reactEndsAt = max(reactEndsAt, now) + 60_000`, react only.
  - Views: facilitator `talk: { startedAt, minutes, leftMs }`, `move` (= `pendingMove`), `react.endsAt`, pace computed from `talk.startedAt`; projector `waiting: boolean` (true when `pendingMove` isn't null, or in `cluster` when grouping is done and a theme is unapproved); phone `react.endsAt`. The projector's section timer covers submit, react and walk, from `submitEndsAt`, `reactEndsAt` and the walk's end.
  - `server/index.js` facilitator actions: `startTalk`, `extendReact`, and `advance` passes `b.from`.

- [ ] **Step 1: Write the failing tests** in `test/flow.test.js` (with the same `make()` helper and fake clock as `test/session.test.js`; call `session.tick()` after moving the clock):
  - `a session starts on the demo, before join`
  - `the talk clock starts with one tap and never restarts`: two `startTalk()` calls a minute apart → `startedAt` is the first.
  - `without a tap, the talk clock starts backdated when the room moves on`: demo → join with no tap → `talk.startedAt === now - 3.5 * 60_000`.
  - `submissions and reactions get 5 minutes; +1 minute extends them`
  - `at time, the facilitator is asked and the part stays open`: past `submitEndsAt` → facilitator `move` deep-equals `{ to: 'cluster', label: 'Ready for grouping?' }`, projector `waiting === true`, `submitCards` still works.
  - `+1 minute after the time is up clears the prompt`: then `extendSubmit()` → `move === null`, phone `submit.endsAt` is a minute from now.
  - `everyone finished reacting prompts early`: two phones done → `move.label === 'Ready for the walk-through?'` with `phoneCount: 2`, `null` with `phoneCount: 3` before time.
  - `reactions are accepted for 10 seconds after they close`: after `advance()` to walk, a send at +9 s works, at +11 s throws `/Reactions are closed/`.
  - `a second tap on the same move is ignored`: `advance({ from: 'submit' })` twice → the second throws `/Already moved on/`, phase is `cluster`.
  - `the finale asks for the shred once it has played`: in finale, before `finaleTimeline(n).doneAt` `move === null`, after it `{ to: 'shred', label: 'Ready to shred?' }`.
  - Update `pace marker: ahead before the plan, behind after it` and the phase-order tests in `test/session.test.js` to the new `PLAN` and `PHASES`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: the new tests FAIL (`flow.js` missing, session starts in `join`).

- [ ] **Step 3: Implement** as the Interfaces block says. In `test/shred.test.js`: one more `advance` at the start (demo → join), drop the `lastcall` advance, and after the reset expect phase `demo`.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 5: Update the spec and commit**

  Spec: the 25-minute talk plan table from the design; the talk clock (one tap, never restarts, configurable with `TALK_MINUTES`); the facilitator confirms each move when prompted and the projector says "Waiting for the facilitator to confirm"; reactions get 5 minutes with "+1 minute" and a 10-second grace; last call is spoken.

  ```bash
  git add server public/shared public/projector.js test "Off the Record DevTalk Retro Spec.md"
  git commit -m "Run on a talk clock; the facilitator confirms each move when prompted"
  ```

---

### Task 4: The walk-through runs itself

**Files:**
- Create: `test/walk.test.js`
- Modify: `server/flow.js`, `server/phases.js`, `server/session.js`, `server/index.js`, spec ("Walk through the stream", "What the app must get right": time is a hint)

**Interfaces:**
- Consumes: `talk`, `pendingMove` (Task 3).
- Produces:
  - `server/phases.js`: `LAST_SLIDE_MS = 20_000`, `MIN_CARD_MS = 15_000`, `MIN_WALK_MS = 180_000`, `WALK_END_BEFORE_MINUTES = 3.5` (the walk ends at minute `talk.minutes - 3.5`: 21.5 of 25).
  - `server/flow.js`: `walkEndsAt(talk, now) → max(now + MIN_WALK_MS, talk.startedAt + (talk.minutes - 3.5) * 60_000)`; `cardMs(walk, now) → max(MIN_CARD_MS, (walk.endsAt - LAST_SLIDE_MS - now) / cardsLeft)`, with `cardsLeft = max(1, walk.stream.length - 1 - walk.index)` (the current card through the one before the last slide; the overview counts as a card).
  - Stream: `[{ groupId: 'overview', overview: true }, ...cards, { groupId: 'last', last: true }]`.
  - `state.walk = { stream, index, cardStartedAt, cardEndsAt, endsAt, paused, done, signals: { stay: {}, back: {} } }`.
  - `moveCard(delta, { from })`: `from` given and `!== index` fails `Already moved on`. Next on the last slide sets `done = true`; Back from `done` clears it. Every card change sets `cardStartedAt = now`, `cardEndsAt = now + cardMs` (the last slide gets `LAST_SLIDE_MS`).
  - `pauseWalk(paused)`: pausing holds the card (`cardEndsAt = null`); resuming sets `cardEndsAt = now + cardMs`. The finish time never moves.
  - `tick()` in walk, not paused, not done: if not on the last slide and `now >= endsAt - LAST_SLIDE_MS` → go to the last slide; else if `now >= cardEndsAt` → next card (or `done` after the last slide).
  - Entering walk going back (from the finale) sets `paused = true`, `done = false`.
  - `pendingMove`: walk with `done` → `{ to: 'finale', label: 'Ready for the finale?' }`.
  - Views: facilitator `walk: { index, total, cardsLeft, cardMs, cardStartedAt, cardEndsAt, endsAt, paused, done, stream, item }`; projector `walk: { index, total, cardStartedAt, cardEndsAt, paused, item, comments, stay, back }` with `item = { last: true }` on the last slide. The facilitator `budgetMs` field goes.
  - `server/index.js`: `nextCard`/`prevCard` pass `b.from`; new `pauseWalk` (`b.paused`).

- [ ] **Step 1: Write the failing tests** in `test/walk.test.js` (start the talk clock at t0 and walk the session to the walk-through):
  - `the walk-through ends at minute 21.5 on the talk clock, never shorter than 3 minutes`: entered at minute 15.5 → `endsAt === t0 + 21.5 min`; entered at minute 20 → `endsAt === now + 3 min`.
  - `each card gets the time left divided by the cards left, never under 15 seconds`: 6 minutes, overview + 4 cards → `cardMs === (360_000 - 20_000) / 5`; with 1 minute left and 10 cards → `15_000`.
  - `cards advance by themselves; a pause holds the card; resume gives it a fresh share`
  - `when time runs out with cards left, it skips to the last slide, then asks for the finale`: tick to `endsAt - 20 s` on card 2 of 4 → `item.last`; 20 s later `done` and `move.label === 'Ready for the finale?'`.
  - `skipped cards' reactions still count in the finale`: finale `sequence.length` equals all reactions.
  - `back from the last slide returns to the last card; next on the last slide finishes`
  - `a walk-through with no cards goes from the overview to the last slide`: `Number.isFinite(f.walk.cardMs)` and `Number.isFinite(f.walk.cardEndsAt)` on every step, and `tick()` reaches `done`.
  - `a double-tapped Next moves one card`: `moveCard(1, { from: 1 })` twice → second throws `/Already moved on/`, index 2.
  - `going back into the walk-through holds the card`
  - `a restart mid-walk keeps its timers`: `new Session({ state: JSON.parse(JSON.stringify(old.state)), … })` then `tick()` advances at the same `cardEndsAt`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 5: Update the spec and commit**

  Spec: the walk-through's fixed finish, per-card share, 15-second floor, last slide "Anything else? Out loud." (20 s), skipping and its "N cards left · ~M:SS each" readout, Pause/Back/Next, the draining bar as the one per-card signal in the room, phones keep Stay and Go back.

  ```bash
  git add server test "Off the Record DevTalk Retro Spec.md"
  git commit -m "The walk-through advances by itself and ends on the talk clock"
  ```

---

### Task 5: A haiku per theme, about one theme per 12 cards

**Files:**
- Create: `test/cluster.test.js`
- Modify: `server/cluster.js`, `server/session.js`, `server/index.js`, `test/session.test.js`, spec ("Clustering and the stream", "Neutral cluster labels")

**Interfaces:**
- Produces, in `server/cluster.js`:
  - `themeCount(cardCount) → Math.min(5, Math.max(2, Math.round(cardCount / 12)))`.
  - `groupingPrompt(cardCount) → string`: the `SYSTEM` from `spike/haiku-themes.mjs` with "Use about ${themeCount(n)} themes (fewer when there are only a few cards)".
  - `SCHEMA` gains `haiku` (required, as in the spike).
  - `createClusterer()` returns `clusterCards(cards, { effort = 'high' } = {}) → Promise<{ themes: [{ name, haiku, groups }], local }>`, via `client.messages.stream({ … max_tokens: 64000 }).finalMessage()`, client `timeout: 120_000, maxRetries: 1`. `localClusterer` returns `haiku: ''`.
- In `server/session.js`:
  - `LIMITS.haiku = 120`; `cleanHaiku(raw) → string`: not a string → `''`; newlines become `' / '`; spaces collapsed; trimmed; longer than 120 → `''` (a cut haiku reads broken, and the facilitator can write one).
  - `normalizeClusters()` keeps `haiku` (cleaned). Themes in state: `{ id, name, haiku, approved, groups }`.
  - `approveAll(names = {}, haikus = {})` and `approveTheme(id, name, haiku)`: a typed haiku replaces the stored one; `''` clears it; over 120 fails `Haiku are up to 120 characters`. Approval covers name and haiku together.
  - Projector `itemView()` adds `haiku` only for an approved theme with a haiku; `overviewView()` never has it; phones never get it. Facilitator `themes[].haiku`.
  - `server/index.js`: `approveTheme` passes `b.haiku`; `approveAll` passes `b.haikus`.

- [ ] **Step 1: Write the failing tests**
  - `test/cluster.test.js`: `theme count is about one per 12 cards, 2 to 5` (1→2, 15→2, 30→3, 60→5, 200→5); `the grouping prompt asks for about N themes and no catch-all` (`groupingPrompt(60)` includes `about 5 themes` and `No catch-all`); `the local fallback has no haiku`.
  - `test/session.test.js`: `a haiku is cleaned: newlines become " / ", too long is dropped`; `the facilitator can edit or clear a haiku; approving covers both`; `the projector shows an approved theme's haiku on its cards, never on the overview; phones never get it` (phone views' JSON never contains the haiku text in any phase).

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 5: Update the spec and commit**

  Spec: the haiku per theme (rules, cap, editable and clearable, approved with the name, projector-only, small and on one line), the theme count rule, the tested prompt, the effort table.

  ```bash
  git add server test "Off the Record DevTalk Retro Spec.md"
  git commit -m "Each theme gets a haiku; about one theme per 12 cards"
  ```

---

### Task 6: Group early; place late arrivals in one quick call

Depends on Task 1's verdict.

**Files:**
- Create: `test/late.test.js`
- Modify: `server/cluster.js`, `server/session.js`, `server/flow.js`, `server/index.js`, `test/session.test.js`, spec ("Clustering and the stream")

**Interfaces:**
- Consumes: `LATE_SYSTEM`, `LATE_SCHEMA` (Task 1); `clusterCards(cards, { effort })` (Task 5).
- Produces, in `server/cluster.js`:
  - `createPlacer() → placeLateCards({ themes: [{ id, name, haiku, groups: [{ id, texts }] }], late: [{ id, text }] }) → Promise<{ placements: [{ cardId, themeId, groupId /* null = new group */ }], flags: [{ cardIds, reason }] }>`: effort `low`, `max_tokens` from the spike, client `timeout: 20_000, maxRetries: 0`. Converts the model's JSON: `group: 0` → `null`; each `fits_well: false` → a flag for that card; each `missing_themes` entry → a flag for its cards.
  - `localPlacer`: every late card a new group in the first theme, no flags.
- In `server/session.js`:
  - Constructor option `placeLateCards` (default `localPlacer`). `server/index.js` passes `createPlacer()`.
  - `normalizePlacements(raw, { themeIds, groupIds, lateIds })`: drops unknown ids and duplicates; a late card without a valid placement is added to `flags` as `{ cardIds: [id], reason: 'Not placed' }` and, if kept, goes to an "Other" theme (unapproved) as its own group.
  - `state.clustering` gains `early: boolean` and `late: null | { status: 'running' | 'flagged' | 'done', placements, flags }`.
  - `tick()` in submit: when `!clustering.early`, `now >= submitEndsAt - 60_000` and there are visible cards → full grouping at effort `high`, `clustering.early = true`. Extending afterwards doesn't rerun it.
  - Entering `cluster`: if a grouping is running, wait (when it lands in `cluster`, continue below); if there are no themes, run a full grouping; if some visible cards have no group, run `placeLateCards` on them; otherwise keep everything as is.
  - Placement result: no flags → apply, keep names, haiku and approvals (`late.status = 'done'`); flags → `late.status = 'flagged'`; failure → flagged with every late card and `reason: 'The quick check didn't finish: <message>'`.
  - `keepLate()`: applies the suggested placements. `regroupAll()`: full grouping at `high`, approvals reset. Both only while flagged.
  - `skipClustering()` during placement counts as a failure.
  - `advance()` from `cluster` fails `Grouping is still running` while either call runs, and `Choose: keep the themes or regroup` while flagged.
  - The constructor reruns a placement left `running` by a restart.
  - Facilitator view `clustering.late`: `{ status, flags: [{ cards: [{ id, text }], reason }] }`; projector `waiting` is also true while flagged.
  - Hidden cards are never sent to either call.
  - `server/index.js` facilitator actions: `keepLate`, `regroupAll`.

- [ ] **Step 1: Write the failing tests** in `test/late.test.js` (fake `clusterCards` and `placeLateCards` that record their calls and resolve on demand):
  - `at the 1-minute warning, a full high-effort grouping starts on the cards so far`: called once with `{ effort: 'high' }` and the 3 cards so far; extending after doesn't call again.
  - `the facilitator can approve themes while people are still submitting`
  - `confirming with no late cards keeps the early themes as approved`: no placement call; themes still approved.
  - `late cards that fit are placed without asking; names, haiku and approvals stay`
  - `flagged late cards wait for the facilitator; keep places them as suggested`: `advance()` throws `/keep the themes or regroup/` until `keepLate()`.
  - `regroup runs a full grouping and asks for approval again`
  - `if the quick call fails, the late cards are flagged with the reason; keep puts them in Other`
  - `confirming before the early run finishes waits for it, then places the late cards`
  - `a restart during placement runs it again`
  - `hidden cards are never sent for placement`
  - Update `going back to grouping regroups when new cards came in` (`test/session.test.js`): new cards are now placed; existing reactions stay on their groups.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 5: Check the real calls once**

  Run the server with the spike key (`node --env-file=<spike key file> --no-warnings server/index.js` with `FACILITATOR_TOKEN=dev`), submit the 60 seed cards from three fake phones with a short script in the job's temp folder, let the warning start the early run, add the 3 bridge cards, confirm. Expected: themes with haiku in ~40 s; the late call flags the bridge cards in under 10 s.

- [ ] **Step 6: Update the spec and commit**

  Spec: grouping starts at the 1-minute warning at high effort; late arrivals are placed and assessed in one quick call; keep or regroup when flagged; why not always regroup; going back to grouping places new cards instead of regrouping.

  ```bash
  git add server test "Off the Record DevTalk Retro Spec.md"
  git commit -m "Group at the 1-minute warning; place late cards in one quick call"
  ```

---

### Task 7: The demo stage (server)

**Files:**
- Create: `server/demo.js`, `demo/example.json`, `test/demo.test.js`
- Modify: `server/session.js`, `server/index.js`, `deploy/deploy.sh`, `test/shred.test.js`, `README.md`, spec ("Session flow", new "Demo stage")

**Interfaces:**
- Produces, in `server/demo.js`:
  - The demo file (`demo/local.json` if present, else `demo/example.json`):
    ```json
    { "notes": [{ "text": "…", "share": true }, { "text": "…" }],
      "theme": { "name": "…", "haiku": "… / … / …" },
      "react": { "presets": ["😂", "🙋"], "own": "🌉", "comment": "…" },
      "reveal": { "mix": [["😂", 14], ["🌉", 6]], "comments": ["…", "…"] } }
    ```
  - `validateDemo(obj) → Demo`, throwing `Error` with the reason: 1–5 notes of 1–200 characters, exactly one `share: true`; theme name 1–60; haiku up to 120 (`''` allowed); `presets` from the 8 presets; `own` one emoji (`isSingleEmoji`); comments up to 200 characters, at most 5; `mix` pairs of an emoji and a positive integer.
  - `loadDemo(dir) → Demo`: `local.json` if it exists and is valid; if it exists and is invalid, prints the fixed line `demo: local file invalid, using the example` and uses the example; a missing or invalid example throws at startup.
  - `DEMO_STEPS = ['notes', 'pick', 'group', 'react', 'reveal']`.
- In `server/session.js`:
  - Constructor option `demo` (a `Demo`). State `demo: { step: 0, cardId: null }`.
  - `demoStep(delta)`: ±1 within the steps, only in `demo` (fails `The demo is over` otherwise, `That was the last step` / `This is the first step` at the ends).
  - Leaving `demo` forward adds the shared note as an ordinary card (random id, no author, not counted against any phone) once; going back and forward again doesn't add another. The demo's reactions and comments never enter the session.
  - Views: projector `demo: { step, notes, theme, react, reveal }`; facilitator `demo: { step, steps: 5, name: DEMO_STEPS[step] }`; phones get only `phase: 'demo'`.
- `server/index.js`: `loadDemo(join(ROOT, 'demo'))` passed as `demo`; facilitator actions `demoNext`, `demoBack`.
- `deploy/deploy.sh`: add `--exclude spike`. `demo/local.json` still deploys (rsync copies untracked files).

- [ ] **Step 1: Write the failing tests** in `test/demo.test.js`:
  - `the example demo file is valid`
  - `an invalid demo is rejected with the reason` (two shares, no share, a 201-character note, `own: 'ab'`, 6 comments).
  - `loadDemo prefers local.json and falls back to the example when it is invalid` (temp directory with both files).
  - `the demo steps forward and back on the facilitator's taps, only in the demo`
  - `phones see only that the session starts soon`: phone view keys deep-equal `['now', 'phase', 'role', 'session']`.
  - `leaving the demo adds its card once, with no author`
  - `the demo's reactions and comments don't carry over`: after leaving, `reactions` and `comments` are empty.

- [ ] **Step 2: Run them to see them fail**

  Run: `npm test`
  Expected: FAIL.

- [ ] **Step 3: Implement**, and write `demo/example.json` as a generic example (no real place or person): a light shared note, a personal one, a theme with a haiku, three presets plus a keyboard emoji, and two comments.

- [ ] **Step 4: Run the tests**

  Run: `npm test`
  Expected: PASS. `the shred leaves nothing behind` still passes (the demo card is shredded with the rest).

- [ ] **Step 5: Update the spec and README, and commit**

  Spec: the demo stage (on the projector only, five steps, prepared content from a data file, the facilitator's own file gitignored but deployed, its card joins the session, phones see "Starting soon"). README: `demo/local.json` and `TALK_MINUTES`.

  ```bash
  git add server demo/example.json deploy/deploy.sh test README.md "Off the Record DevTalk Retro Spec.md"
  git commit -m "Add a scripted demo stage before Join"
  ```

---

### Task 8: Phone screens

**Files:**
- Modify: `public/phone.js`, `public/phone.css`

**Interfaces:**
- Consumes: phone views from Tasks 2, 3 and 7 (`phase: 'demo'`, `react.endsAt`, the `react` action's `comment`, signals `stay`/`back`).

- [ ] **Step 1: Demo.** A `demo` screen: "Starting soon" with "Look up: the facilitator is showing how this works."
- [ ] **Step 2: Reacting.** Under each card's emojis, an "Add a comment" box (200 cap, the same identifier hint as cards via `check`). The draft is kept per card in `sessionStorage` (wiped like notes). Sending a card sends its emojis and comment together; "◀ Previous" and a resend use the receipt as today. Warnings, as submissions do: at 1:00 "Finish the card you're on", at 0:15 "15 seconds: send this card". At zero, nothing locks. When the phase leaves `react`, the phone sends the card it's on if it has an emoji or comment text not yet sent (once).
- [ ] **Step 3: Walk-through.** Remove the pause button, pause panel, comment box and "Move on"; keep "Stay" and "Go back". Remove the `lastcall` screen and `.pause-panel`/`.lastcall-sub` CSS.
- [ ] **Step 4: Copy.** "Erik" → "the facilitator" ("Look up when the facilitator moves on").
- [ ] **Step 5: Check it by hand**

  Run: `npm run dev`, open `http://localhost:3000/` in two phone-sized windows and `/facilitate?t=dev`.
  Expected: "Starting soon" in the demo; a comment sent with emojis shows on the facilitator view; reload mid-comment keeps the draft; the 1:00 and 0:15 warnings appear (sit in reactions for 4 minutes once); moving on with a typed comment unsent → it arrives; walk-through shows Stay and Go back only.
- [ ] **Step 6: Run the tests and commit**

  Run: `npm test` (PASS)

  ```bash
  git add public/phone.js public/phone.css
  git commit -m "Phones: comments while reacting, Starting soon, Stay and Go back"
  ```

---

### Task 9: Facilitator view

**Files:**
- Modify: `public/facilitate.js`, `public/facilitate.css`, spec (the view table)

**Interfaces:**
- Consumes: facilitator views and actions from Tasks 2–7 (`talk`, `move`, `demo`, `clustering.late`, `themes[].haiku`, walk fields, `comments.current`/`next`; actions `startTalk`, `demoNext`, `demoBack`, `advance { from }`, `extend`, `extendReact`, `approveAll { names, haikus }`, `approveTheme { id, name, haiku }`, `keepLate`, `regroupAll`, `nextCard`/`prevCard { from }`, `pauseWalk`, `removeComment`).

- [ ] **Step 1: The one prompt.** When `v.move` is set, the yellow "moving" zone shows one big button, `${v.move.label} ▶`, sending `advance { from: v.phase }` (the shred keeps its confirm). In `cluster`, the button is "Approve all and start reactions ▶" (`approveAll` with the typed names and haiku, then `advance { from: 'cluster' }`).
- [ ] **Step 2: Talk clock.** "Start talk clock" until started; then time left in the talk and the pace marker (ⓘ explains both). Phase labels and FORWARD/BACK_TO texts follow the new phase list (`demo`: "Demo"; no last call).
- [ ] **Step 3: Demo.** Step name and "n of 5", "◀ Back" and "Next ▶", and "Start ▶" to Join.
- [ ] **Step 4: Grouping.** Theme drafts (name and haiku inputs, haiku editable and clearable) show during submissions as soon as the early run lands, with per-theme approve and "Approve all". The late-arrival panel when flagged: each flagged card with its reason, and "Keep the themes and add the late arrivals" / "Regroup everything (~40 seconds)".
- [ ] **Step 5: Reactions.** Time left, "+1 minute", "n of m phones finished".
- [ ] **Step 6: Walk-through.** "Pause"/"Resume", "◀ Back one card", "Next card ▶" (with `from`), "N cards left · ~M:SS each" (ⓘ: the walk-through ends at a fixed time; cards share what's left). Comments on the current and next card with red-outlined "Remove". Remove the pause controls, "move on" and `budgetMs`.
- [ ] **Step 7: Copy.** `DISCLOSURE` matches the projector's (Task 10); "Erik" → "the facilitator" in prompts.
- [ ] **Step 8: Check it by hand**

  Run: `npm run dev` with two phone windows; play a whole session (about 15 minutes: submissions and reactions keep their 5 minutes, the walk-through its 3-minute floor).
  Expected: one prompt per move; double-tapping it on two facilitator tabs moves once; haiku edits reach the projector only after approval; with the spike key, a card submitted after the early run brings up the late panel when it doesn't fit.
- [ ] **Step 9: Run the tests, update the spec's view table, and commit**

  ```bash
  git add public/facilitate.js public/facilitate.css "Off the Record DevTalk Retro Spec.md"
  git commit -m "Facilitator view: talk clock, one prompt per move, haiku and late arrivals"
  ```

---

### Task 10: Projector: waiting line, folder tabs, haiku, comments, drain bar

**Files:**
- Modify: `public/projector.js`, `public/projector.css`

**Interfaces:**
- Consumes: projector views from Tasks 2–6 (`waiting`, `walk.item.haiku`, `walk.item.last`, `walk.comments.shown`/`more`, `walk.cardStartedAt`/`cardEndsAt`/`paused`).

- [ ] **Step 1: Waiting.** When `v.waiting`, a line at the bottom: "Waiting for the facilitator to confirm". Never during the finale animation or the shred.
- [ ] **Step 2: Folder tab.** The card's theme name drawn as a manila folder tab on top of the card (CSS only, the existing palette, legible from the back row).
- [ ] **Step 3: Card contents.** Below the emoji mix: up to 5 comments and "+N more"; then the haiku, small, on one line. Not on the overview.
- [ ] **Step 4: Drain bar.** A thin bar along the card's bottom edge, full at `cardStartedAt`, empty at `cardEndsAt`, frozen while `paused`. No numbers.
- [ ] **Step 5: Last slide.** "Anything else? Out loud." Remove the `lastcall` screen, the pause banner and the pause count; the controls line becomes "From your phone you can ask to stay, or to go back a card."
- [ ] **Step 6: Overview as a file drawer.** Themes as folder tabs, biggest first, each with its card count.
- [ ] **Step 7: Disclosure.** Fine print: "I see cards and comments before they're shown and can remove any of them to prevent abuse."
- [ ] **Step 8: Check it by hand**

  Run: `npm run dev`, play a session, view `/projector` full screen at 1280×720 from across the room (or zoomed out to 50%).
  Expected: tab, comments, haiku and bar readable; no number anywhere on a card; the waiting line appears at each prompt.
- [ ] **Step 9: Run the tests and commit**

  ```bash
  git add public/projector.js public/projector.css
  git commit -m "Projector: folder tabs, haiku, comments, a draining bar, a waiting line"
  ```

---

### Task 11: Projector: the demo phone

**Files:**
- Modify: `public/projector.js`, `public/projector.css`

**Interfaces:**
- Consumes: projector `demo: { step, notes, theme, react, reveal }` (Task 7); the folder tab and card styles from Task 10.

- [ ] **Step 1: Draw a phone** (and hide the corner "Joining late?" QR during the demo) on the left of the projector (a rounded frame with the app's phone styles), with a one-line caption on the right per step.
- [ ] **Step 2: The five steps,** reusing the real phone and projector markup classes where they fit:
  1. Notepad with the notes (caption: "Write private notes. They never leave your phone.")
  2. The shared note highlighted, then shown as a card ("Pick up to 3 to share.")
  3. The card under its folder tab with the theme name and haiku ("The cards are grouped into themes.")
  4. Presets tapped one by one, the keyboard emoji added, the comment typed out ("React, and add a comment if you like.")
  5. The reveal: the card full size as in the walk-through, with `reveal.mix` and `reveal.comments` ("Then we look at them together.")
  Each step animates in when entered; Back shows the previous step settled.
- [ ] **Step 3: Check it by hand**

  Run: `npm run dev`, step through with Next and Back on the facilitator view.
  Expected: every step readable from the back; `demo/local.json` content when present, the example otherwise.
- [ ] **Step 4: Run the tests and commit**

  ```bash
  git add public/projector.js public/projector.css
  git commit -m "Projector: step through the demo on a drawn phone"
  ```

---

### Task 12: Spec and README sweep

**Files:**
- Modify: `Off the Record DevTalk Retro Spec.md`, `README.md`

- [ ] **Step 1:** Replace "Erik" with "the facilitator" throughout the spec except "Talk overview" logistics and hosting details; check every section against what Tasks 2–11 built (timing table, view table, design rules, build notes, privacy, facilitator cues: "Anything from funny to heavy belongs here", "find someone after the event and tell them 'that was me too'").
- [ ] **Step 2:** README: the phone/projector/facilitator descriptions (no anonymous pause), env vars `TALK_MINUTES`, the demo file.
- [ ] **Step 3:** Run: `grep -n "Erik" "Off the Record DevTalk Retro Spec.md" README.md public server` — Expected: only logistics/hosting lines in the spec.
- [ ] **Step 4: Commit**

  ```bash
  git add "Off the Record DevTalk Retro Spec.md" README.md
  git commit -m "Spec: the facilitator, not Erik; bring it up to date with the Nov 25 flow"
  ```

---

### Task 13: Whole run, deploy, and the Nov 24 checklist

**Files:**
- none (unless the run finds a bug: then a test and fix in the owning task's files)

- [ ] **Step 1: Whole run locally with the real key** (`node --env-file=<spike key file>` running the server, `FACILITATOR_TOKEN=dev`, `TALK_MINUTES=25`), projector + facilitator + two phone windows, the 60 seed cards posted by a script during submissions. Expected: every prompt in order, early grouping lands before the warning ends, the shred leaves the data directory empty.
- [ ] **Step 2: Deploy.** `aws ec2 describe-instances --profile personal-admin …` shows the instance running; `curl checkip.amazonaws.com` is in the security group; `deploy/deploy.sh <ip>` (copies `demo/local.json`). Expected: `active active`, and `https://otr.tetl.ca/projector` shows the demo.
- [ ] **Step 3: Write the solo-run checklist for Nov 24** into the facilitator's own notes (not the repo): projector, laptop as facilitator, two phones (one on LTE); demo steps legible from the back; talk clock started at the first slide; every prompt; a comment removed before it's projected; a late card after the early run; Pause/Back/Next; finale; shred; closing QR; total time against 25 minutes.
- [ ] **Step 4:** `npm test` green on the branch; push.
