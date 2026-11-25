# Changes from the Nov 24 practice feedback: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the feedback from a colleague who went through the practice run, and on the facilitator's notes after talking it through. The main changes: say less from the front, make "shred" read as letting go rather than tearing apart, react with emojis only (16 presets instead of 8) and write one thought at the end of the deck, a deck sized to the time, no stay/go back buttons on phones, a quiet count of people writing, writing that opens at Join, and better tools for keeping harsh cards off the screen.

**Architecture:** Same as the Nov 22 and Nov 23 plans (`docs/superpowers/plans/2026-11-22-demo-and-haiku-themes.md`, `docs/superpowers/plans/2026-11-23-demo-polish.md`). Rules live in `server/session.js`, pure helpers in `server/flow.js`, timers are timestamps advanced by `tick()` (every second), and three screens get per-role views over SSE.

**Tech Stack:** Node 22, no framework, `node:sqlite`, plain HTML and JavaScript, `node --test`. The Anthropic SDK is already a dependency.

**Spec:** `Off the Record DevTalk Retro Spec.md` (source of truth: every task updates it in the same commit).

## Why these changes

The feedback, in short:

- **Say less.** The app explains itself; the facilitator is the maestro, not the presenter. Set the scene briefly at the start (why this year, why a room of people), then let the room drive. Don't open with "who's done a retro?": it sets up the wrong expectation (good / bad / to improve).
- **Quiet typing feels awkward.** Keep the silent stretches short, or at least make them read as people working.
- **Comments on every card slow the room down and invite put-downs.** Reacting should be a fast rhythm: read, tap, next. A single thought at the end, after seeing all the cards, keeps the space for words without the risk.
- **More default emojis.** Eight presets is too few. Use the screen space for about 16.
- **"Shred" can sound like tearing someone's idea apart.** Say plainly that nothing is kept and that it all goes at the end.
- **Custom emojis exist.** iPhones make their own (Genmoji); they arrive as images, not text.
- **The demo example comment could read as cruel.** A cute put-down still makes one person feel bad, even anonymously.
- **Let the room's reactions set the pace,** not buttons on phones.
- **Post the demo as a trailer** on the afternoon of the talk, as a reminder and a nudge.

## Priority and cut line

The talk is the evening of Wednesday, November 25. Work in this order and stop wherever time runs out; every task leaves the app working.

- **Before the trailer (about 1 pm Nov 25):** Task 1 (16 presets), Task 2 (teaser and demo), Task 3 (the spoken script, docs only), Task 4 (record the trailer).
- **Before the talk:** Task 5 (no stay/go back), Task 6 (hidden stays hidden), Task 7 (emojis only, one thought at the end), Task 8 (deck sized to the time), Task 9 (count of people writing), Task 10 (writing opens at Join), Task 11 (harshness check and reviewed cards).
- **Only if there's time:** Task 12 (credits roll), Task 13 (custom image emojis, spike first).

## Global Constraints

The Nov 22 plan's Global Constraints all still apply. In short:

- No new dependencies. `npm test` passes after every task.
- Every promise on screen stays literally true. When a change makes a promise untrue (the trust disclosure, the join list), reword it in the same task.
- Write "the facilitator" in code, copy and the spec, never a person's name.
- Phones never receive comments, afterthoughts, haiku, demo content, flags, harshness levels, the writing count or the talk clock.
- Logs are fixed labels, never card text.
- The spec is updated in the same commit as the code.
- Nothing personal is committed. `demo/local.json` is gitignored and lives in the main checkout (`/Users/eriktetland/Code/dev-talk-nov-2026/demo/local.json`), not in a worktree: `git worktree remove` deletes ignored files.
- Animations use `transform` and `opacity` only.

Also:

- The server never stores which cards a phone saw, reacted to or wrote. It keeps counts against a phone's random id, as today. The writing count (Task 9) is in memory only and is never written to SQLite.
- Anything a phone sends to the server is shredded with the rest. `test/shred.test.js` covers every new kind of data: afterthoughts, harshness levels and the writing count.

## Review Focus

1. **Someone mid-sentence when the facilitator moves from Join to Submit.** Expected: the keyboard stays up, the text stays, and there's no flash or buzz. Pinned in Task 10.
2. **An afterthought typed but not sent when the room moves on.** Expected: it isn't sent automatically. The facilitator saw "N still writing a thought" before moving on, and the draft is wiped with the notes. Pinned in Tasks 7 and 9.
3. **A card hidden after its theme was approved, while it is the next card and the timer is about to move.** Expected: it is never projected and never reaches a phone. Pinned in Task 6.
4. **No API key, or the harshness check fails.** Expected: the walk-through never stalls. Unchecked cards can be marked reviewed in one tap, and the hold only stops on cards nobody has reviewed. Pinned in Task 11.
5. **Fewer cards than the deck size, or a card hidden mid-reaction.** Expected: everyone sees every card. The count never reads "Card 9 of 8", and nobody gets stuck. Pinned in Task 8.

---

### Task 1: Sixteen preset reactions

**Files:** `public/shared/emoji.js`, `server/session.js` (`LIMITS`), `public/phone.js` (`MAX_EMOJIS`), `public/phone.css` if the grid needs it, `test/session.test.js`, `test/demo.test.js`, spec (Design rules, view table, Build notes).

**Interfaces (produces):**
- `PRESETS` has 16 entries: the current 8 in their current order, then 8 more. Proposed (the facilitator confirms the list and labels before this ships): 🔥 this is fine, 🤯 mind blown, 🫠 melting, 😮‍💨 relief, 💪 proud of you, ❤️ love this, 🙏 grateful, 👀 noticed that. 🔥 covers the "everything's on fire, and that's fine" feeling of the year.
- `LIMITS.emojisPerCard = 22`: 16 presets plus 6 of your own. The error reads `Up to 22 emojis on a card: remove ${n - 22}`. Phones use `MAX_EMOJIS = 22`.
- The phone grid stays 4 columns (now 4 rows). Once the comment box is gone (Task 7), the card, grid, own-emoji row and buttons fit a 375×667 screen without scrolling. Until then, scrolling is fine.

- [ ] **Step 1: Failing tests:** `the emoji limit is 22: 16 presets plus 6 of your own`; `the demo may tap any of the 16 presets` (a demo file with 🔥 in `react.presets` validates).
- [ ] **Step 2: Run, see them fail.** `npm test`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `npm test` passes.
- [ ] **Step 5: Check headlessly** in a scratch folder with `playwright-core` and the installed Chrome, at 375×667. Expected: 16 presets in 4 rows, labels readable, the limit hint showing at 22.
- [ ] **Step 6: Spec, commit** "Sixteen preset reactions".

---

### Task 2: Teaser and demo: say "let go", show writing first, show the grouping happen, no comments

**Files:** `public/shared/struck.js` (new), `public/projector.js`, `public/projector.css`, `public/phone.js` (teaser screen), `public/phone.css`, `server/demo.js`, `server/session.js` (demo carry-over), `demo/example.json`, `test/demo.test.js`, spec (Demo stage, Session flow step 0).

**Interfaces (produces):**
- `struckParts(line: string) → Array<{ text: string, struck: boolean }>` in `public/shared/struck.js`. `~~…~~` marks a struck span, and an unpaired `~~` stays literal text. The projector and the phone both render a struck span as `<s class="struck">`: a thin, muted red line-through, with the text still readable. Teaser lines stay 1 to 160 characters, markup included.
- Demo file:
  - `notes`: 1 to 5, of which **1 to 3** have `share: true`. The validation error reads `Demo needs 1 to 3 shared notes`.
  - `react.comment` and `reveal.comments` are no longer read; a file that still has them validates and they're dropped.
  - `react.presets` may use any of the 16.
- `DEMO_STEP_MS = [13_000, 16_000, 16_000, 12_000, 12_000]` (about 70 seconds a loop).
- Leaving the demo forward adds **every** shared note as an ordinary card, once each, in a random order, with no author.

What each step shows:
1. **Notes:** the prompt and an empty writing box with its placeholder. After about 2.5 s the notes appear one at a time, about 0.9 s apart.
2. **Pick:** each shared note gets checked in turn, about 0.8 s apart. The button reads "Share N cards", goes live and is tapped. The picked notes fold into one plain sealed envelope that slides away. The phone then says "Shared." with no "you can still share" line, and the unshared notes stay listed below.
3. **Group:** the first shared note arrives alone in a plain folder. About 2.5 s later the folder's tab name appears a few characters at a time, then the haiku, one segment at a time, about 0.9 s apart. Everything is settled at least 3 s before the step ends.
4. **React:** presets tapped one by one, then the own emoji. No comment box. The caption reads "React with emojis. At the end, add a thought if you like."
5. **Reveal:** the card with its emoji mix and haiku. No comments.

- [ ] **Step 1: Failing tests:**
  - `struckParts splits ~~marked~~ spans and leaves an unpaired ~~ as text`
  - `a demo file may share 1 to 3 notes, and no more`
  - `leaving the demo adds every shared note as a card, once`
  - `comment fields in an old demo file are ignored`
  - `the loop steps take 13, 16, 16, 12 and 12 seconds`
- [ ] **Step 2: Run, see them fail.** `npm test`
- [ ] **Step 3: Implement.** Update `demo/example.json`: two shared notes, no comment fields, and a teaser line that shows the markup (generic, invented content).
- [ ] **Step 4: Run.** `npm test` passes.
- [ ] **Step 5: Check headlessly** at 1280×720: the teaser with a struck word, and one full loop, with screenshots at the start and end of each step. Expected: step 1 starts empty, step 3's tab and haiku come after the card, and step 2 never says "share 2 more".
- [ ] **Step 6: Spec, commit** "Teaser can strike a word; the demo shows writing first, the grouping happen, and no comments".
- [ ] **Step 7: The facilitator's `demo/local.json`, in the main checkout, never committed.** In the teaser, strike "shred it all" and follow it with "let it all go: nothing is kept" (the facilitator has the final say on this copy). Mark up to three notes to share. Use 🔥 among the tapped presets and in the reveal mix. Remove the old comment fields, so the reveal no longer carries a comment that reads as a dig at the card's writer. Restart the local server and check that it doesn't print `demo: local file invalid`.

---

### Task 3: The spoken script (docs only)

**Files:** spec ("Facilitator cues", the timing table's Intro row, "Trust disclosure").

- [ ] **Step 1:** Rewrite "Facilitator cues":
  - **Intro, spoken over the teaser and demo, no slides.** One or two sentences on why: 2026 was a weird year, and this is a way to harvest the weirdness and turn it into some community bonding. Then "I've run this with coworkers, friends and family; it works in any room", and "if you need help, stop me any time." Nothing more.
  - **Don't ask "who's done a retro?"** It makes people expect the retro their own team runs.
  - **Say up front that it may go quiet** while people write and read, and that this is expected.
  - **Don't read or explain the slides.** When the room laughs or gasps, acknowledge it in a word and move on. Speak mainly to keep things moving, or to wrap up a conversation that's running long.
  - **Don't warn people off inappropriate emojis.** It invites them. If one appears, skip past it.
  - **Remove the cue about asking to stay or go back** (phones lose those buttons in Task 5, no stay/go back).
- [ ] **Step 2:** Timing table: change the Intro row to "Spoken over the teaser and demo".
- [ ] **Step 3: Commit** "Spec: say less from the front".

---

### Task 4: Record the trailer

Not committed. The output goes to the facilitator.

- [ ] **Step 1:** In a scratch folder, write a `playwright-core` script that uses the installed Chrome:
  - Start the server locally with the facilitator's `demo/local.json`, on the teaser.
  - Open the projector at 1280×720 with `recordVideo`.
  - Hold the teaser for 6 s, then post `advance { from: 'teaser' }` as the facilitator.
  - Record one full loop (about 70 s), then stop.
- [ ] **Step 2:** Convert the recording to MP4 with `ffmpeg` if it's installed (Slack plays MP4 inline). Otherwise keep the WebM.
- [ ] **Step 3:** Hand the file's path to the facilitator, who posts it in the community Slack's dev channel on the afternoon of Nov 25, after 1 pm. Not earlier: a reminder close to the event works better than one people defer.

---

### Task 5: No stay or go back on phones

**Files:** `public/phone.js` (`walkScreen`), `public/phone.css` (`.signals`), `server/session.js` (`signal`, `walk.signals`, the views), `server/index.js` (`signal` action), `public/facilitate.js` (the counts, and the "anyone can ask to stay or go back" line at `public/facilitate.js:604`), `public/projector.js` (the counts), `test/walk.test.js`, `test/session.test.js`, spec (Session flow, step 5, Design rules, view table, Trust disclosure's last line).

**Interfaces:**
- `Session.signal` and the `signal` phone action are gone. `walk.signals` leaves the state, and `stay`/`back` leave every view.
- The phone in the walk-through shows only "Look up". The facilitator's overview line becomes "The themes are on the projector."
- The facilitator keeps Pause, Back and Next.

- [ ] **Step 1: Failing tests:** `there is no signal action` (the server answers 404 or an error); `the phone's walk view has no stay or go back`.
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5: Spec, commit** "Phones lose stay and go back: the room's reactions set the pace".

---

### Task 6: Hidden stays hidden (tests first; fix whatever fails)

**Files:** `test/walk.test.js`, `test/session.test.js`, and `server/session.js` only if a test fails.

- [ ] **Step 1: Tests:**
  - `a card hidden after its theme is approved never reaches a phone, the overview's counts or the projector`
  - `hiding the next card while the current one shows skips it when the timer moves on`
  - `a card hidden while it is on the projector disappears at once`
  - `a hidden card's reactions still count in the finale, as emojis only`
- [ ] **Step 2: Run.** If any test fails, fix the rule in `server/session.js`.
- [ ] **Step 3: Commit** "Tests: a hidden card stays hidden after approval".

---

### Task 7: Emojis only on each card; one thought at the end of the deck

**Files:** `server/session.js`, `server/flow.js`, `server/phases.js`, `server/index.js`, `public/phone.js`, `public/projector.js`, `public/projector.css`, `public/facilitate.js`, `test/session.test.js`, `test/walk.test.js`, `test/flow.test.js`, `test/shred.test.js`, spec (Session flow, steps 4 and 5, Design rules, view table, Trust disclosure, Privacy).

**Interfaces (produces):**
- `react(cid, groupId, emojis, receipt) → { receipt }` takes no comment. A first send needs at least one emoji (`Pick an emoji`). Sending an empty list with the receipt clears the reactions. `s.comments`, `s.removedComments`, `removeComment` and the comment views are removed.
- `LIMITS.afterthoughtMax = 200`.
- `afterthought(cid, text, receipt?) → { receipt }`:
  - Allowed in `react`, and in the 10-second grace after it closes.
  - One per phone: a second first send fails with `You've already added a thought: change it instead`.
  - A resend with the receipt replaces the text. An empty text with the receipt clears it. An afterthought the facilitator removed stays removed.
  - The identifier hint runs on it, as on cards.
  - State: `s.afterthoughts: [{ id, text, r }]` and `s.removedAfterthoughts: { [receipt]: 1 }`. No author, and nothing ties it to the phone except the phone's count (`client.afterthoughts`).
- `removeAfterthought(id)` is a facilitator action.
- `lastSlideMs(count: number) → number` in `server/flow.js`: `LAST_SLIDE_MS` (20 s) with none, otherwise `ceil(count / AFTERTHOUGHTS_PER_PAGE) * AFTERTHOUGHT_PAGE_MS`, at least 20 s and at most 60 s. The constants go in `server/phases.js`: `AFTERTHOUGHTS_PER_PAGE = 4`, `AFTERTHOUGHT_PAGE_MS = 10_000`.
- `walk.lastMs` is set in `buildWalk()` and again whenever the last slide is shown, so a late send in the grace window still gets its time. `cardMs` and `tickWalk` reserve `walk.lastMs` instead of `LAST_SLIDE_MS`.
- The projector's last slide:
  - With afterthoughts: the title "Afterthoughts", then the texts, four to a page. The page is `floor((serverNow − cardStartedAt) / pageMs) % pages`, where `pageMs = (cardEndsAt − cardStartedAt) / pages`. Every projector agrees, and a pause holds the page. Reuse the comment list's styling and `crowdFit`.
  - Without afterthoughts: "Anything else? Out loud.", as today.
  - The projector view carries afterthought text only: `walk.afterthoughts: [{ text }]`, on the last slide only.
- Facilitator view: `afterthoughts: [{ id, text }]` in `react` and `walk`, each with Remove. When the next item is the last slide, the walk-through's "next" preview shows them.
- The phone's end of the deck:
  - "That was every card. Anything new after seeing them all?" with a textarea (up to 200 characters, the identifier hint), "Add this thought", and "Nothing to add".
  - Then "Made your own emoji? Go back and add it to a card." and "◀ Back to the last card".
  - The draft is kept in `sessionStorage` (`afterthoughtDraft`) and wiped like the notes. It is **not** sent automatically when the phase changes.
  - `reactDone` is posted on reaching the end of the deck, as today.

- [ ] **Step 1: Failing tests:**
  - `a reaction carries emojis only`
  - `a phone can add one thought at the end and change it with its receipt`
  - `an empty thought with its receipt clears it`
  - `a removed thought can't come back with its receipt`
  - `thoughts are closed outside reactions, except the 10-second grace`
  - `phones never receive thoughts`
  - `the projector gets the thoughts' text only, on the last slide`
  - `lastSlideMs: 20 s with none, 10 s a page of 4, at most 60 s` (flow)
  - `the last slide's share grows with the thoughts, and the cards before it share what's left` (walk)
  - The shred test sends a thought and checks it's gone everywhere.
- [ ] **Step 2: Run, see them fail.** `npm test`
- [ ] **Step 3: Implement the server.**
- [ ] **Step 4: Implement the phone, projector and facilitator screens.** Update the trust disclosure: "I see cards and thoughts before they're shown and can remove any of them" (projector join fine print and spec).
- [ ] **Step 5: Run.** `npm test` passes.
- [ ] **Step 6: Check headlessly:** react through a deck on a 375×667 phone, add a thought, and go back to add an emoji. Check the last slide with 0, 3 and 9 thoughts at 1280×720 (pages turn, nothing overflows).
- [ ] **Step 7: Spec, commit** "React with emojis only; one thought at the end of the deck, shown on the last slide".

---

### Task 8: A deck sized to the time, and earlier warnings

**Files:** `server/flow.js`, `server/phases.js`, `server/session.js`, `public/phone.js`, `public/facilitate.js`, `test/flow.test.js`, `test/session.test.js`, spec (Session flow, step 4; Clustering and the stream).

**Interfaces (produces):**
- Constants in `server/phases.js`: `CARD_REACT_MS = 8_000`, `AFTERTHOUGHT_RESERVE_MS = 60_000`, `MIN_DECK = 8`.
- `deckSize(groups: number, reactMs: number) → number` in `server/flow.js`: `min(groups, max(MIN_DECK, floor((reactMs − AFTERTHOUGHT_RESERVE_MS) / CARD_REACT_MS)))`.
- `s.deckSize` is set once, when reactions start going forward. Entering reactions again from the walk-through keeps it, and "+1 minute" doesn't change it. The phone view carries `react.deckSize`; the facilitator view carries it with the total.
- Each phone takes the first `deckSize` cards of its own seeded shuffle (`order().slice(0, deckSize)`), so the server never learns which cards a phone saw. The card count reads "Card n of min(deckSize, cards left)".
- `react()` refuses a first send past `min(deckSize, visibleGroups)` (`You have reacted to every card in your deck`).
- Phone warnings:
  - At 2 minutes left: "About 2 minutes left: finish your cards, then add a thought if you like."
  - At 1 minute left: "About a minute left: send your thought now."
  - These replace the 60 s and 15 s warnings, as on submissions.
- The facilitator's ⓘ: "Each phone gets N of the M cards, picked at random, so everyone can finish with time for a thought at the end. Cards seen by more phones can gather more reactions."

- [ ] **Step 1: Failing tests:**
  - `deckSize: 5 minutes and 60 cards gives 30; 10 cards gives 10; a 1-minute window gives 8` (flow)
  - `a phone can react to deckSize cards, no more`
  - `the deck size is fixed when reactions start; +1 minute doesn't change it`
  - `a card hidden mid-reaction shrinks the deck without stranding a phone`
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5: Spec** (including the bias: a card in more decks can gather more reactions, and the stream orders by reactions), **commit** "Each phone's deck fits the time left, with room for a thought".

---

### Task 9: A quiet count of people writing

**Files:** `server/session.js`, `server/index.js`, `public/phone.js`, `public/projector.js`, `public/projector.css`, `public/facilitate.js`, `test/session.test.js`, `test/shred.test.js`, spec (Session flow, steps 2 and 4; Privacy and the shred; view table).

**Interfaces (produces):**
- `WRITING_WINDOW_MS = 20_000` in `server/phases.js`.
- `Session.activity: Map<cid, { typedAt: number, unsent: boolean }>`, in memory only, never in `this.state` (so never in SQLite). It is cleared by `shred()` and `reset()`.
- Phone actions:
  - `typing { cid }`: the phone sends it at most once every 5 s while the person types in the notepad (submit) or the thought box (react).
  - `unsent { cid, on }`: the phone sends it whenever the thought box goes from empty to holding unsent text, or back. Neither action carries any text.
- `writingCount(now) → number` counts phones that typed within the last `WRITING_WINDOW_MS`. `tick()` calls `changed()` when the count or the unsent count differs from the last broadcast, so the count falls without any new event.
- Views (phones get neither count):
  - Projector, in `submit` and `react`: `writing: number`.
  - Facilitator: `writing: number`, and `unsent: number` in `react`.
- Projector, in `submit` and `react`: the section timer large and centred. Below it, quietly, "N people writing" when N > 0. Nothing else: the big "On your phone" goes; the corner QR's "Joining late? Start here" stays.
- Facilitator:
  - In submit: "N writing now". Its ⓘ: "Phones that typed in the last 20 seconds; no text is sent. If almost nobody is writing, you can move on early; if many still are when time's up, add a minute."
  - In react, beside the move prompt: "N still writing a thought". Its ⓘ: "Thoughts aren't sent automatically. Wait for them, or say there's no time and move on."

- [ ] **Step 1: Failing tests:**
  - `writing counts phones that typed in the last 20 seconds`
  - `the count falls on its own, broadcast by tick`
  - `unsent thoughts are counted for the facilitator only`
  - `phones never receive the writing count`
  - `the shred forgets who typed` (shred test: `activity` is empty, and no file holds it)
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5: Spec** (Privacy: "the server keeps, in memory only, when each phone last typed, never what, to count people writing; it's gone at the shred"), **commit** "A quiet count of people writing, so silence reads as work".

---

### Task 10: Writing opens at Join

The facilitator's note asks that people can start writing as soon as everyone sits down, without waiting for the QR code to go. Writing still doesn't open before the talk starts (during the demo loop), so it's clearly something each person does in the room. **Assumption, to confirm:** sharing opens at Join too, and the 5-minute submissions timer still starts when the facilitator moves to Submit, so early joiners just get extra time.

**Files:** `public/phone.js`, `server/session.js` (`submitCards` phases, the phone view), `test/session.test.js`, spec (Session flow, steps 1 and 2; timing table).

**Interfaces:**
- `submitCards` is allowed in `join` and `submit`. The phone view in `join` carries `submit` (with `endsAt: null` and nudges off).
- `SCREENS.join` is the notepad. Above the prompt, one compact line: "Anonymous. Notes you don't share never leave this phone. Everything on our server is shredded tonight." The "I'm here" button goes: the first tap in the notepad unlocks vibration on Android.
- The phone treats `join` and `submit` as one screen: `screenKey(phase)` maps both to `'write'`. A change between them updates the screen in place, with no rebuild, no buzz and no flash, and keeps focus and the keyboard.
- The projector's Join screen is unchanged (big QR, the promises, the fine print).

- [ ] **Step 1: Failing tests:** `cards can be shared from Join`; `the phone view in Join carries the notepad's fields, with no timer and no nudge`.
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5: Check headlessly:** type in the notepad during Join, then move the room to Submit. Expected: same focus, same text, no flash.
- [ ] **Step 6: Spec, commit** "Writing opens at Join".

---

### Task 11: A harshness check, reviewed cards, and a hold before unreviewed ones

**Files:** `server/moderation.js` (new), `server/session.js`, `server/index.js`, `public/facilitate.js`, `public/facilitate.css`, `public/projector.js` (the trust fine print), `test/moderation.test.js` (new), `test/session.test.js`, `test/walk.test.js`, `test/shred.test.js`, spec (Facilitation logic; Privacy, the bullet on Anthropic; Trust disclosure; view table).

**Interfaces (produces):**
- `createHarshnessCheck({ apiKey }) → null | (items: Array<{ id: number, text: string }>) → Promise<Map<number, { level: 0 | 1 | 2, reason: string }>>` in `server/moderation.js`:
  - It returns `null` without a key.
  - Levels: 0 is fine; 1 is edgy, worth a look; 2 is harsh (puts down a person or group, or is inappropriate to project).
  - It uses `MODEL` from `server/cluster.js`, effort `low`, a `json_schema` output, `max_tokens` 2000, a 15 s timeout and no retry.
  - It sends per-call numbers 1..N in id order and maps them back, as `server/cluster.js` does.
  - The reason is one line, shown to the facilitator only.
- Session:
  - After each new card or thought, once there's been 5 s with nothing new, check every unchecked visible card and thought in one call. Store `harsh: { level, reason }` on the item. A failed check leaves the items unchecked, logs the fixed line `moderation: check failed`, and blocks nothing.
  - `review(kind: 'card' | 'afterthought', id, on)`, and `reviewRest()`, which marks every unreviewed item at level 0 *or unchecked* as reviewed.
  - `review` and `reviewRest` are facilitator actions.
- The hold:
  - When the walk-through's timer would move onto an item with any visible card, or (for the last slide) any thought, that is unreviewed, it pauses on the current card instead. It sets `walk.held = true`.
  - The facilitator's view says "The next card hasn't been reviewed: check it below, then Next." The facilitator's Next marks the next item's cards or thoughts reviewed and moves on.
  - A hold is a pause: the finish doesn't move.
- Facilitator view:
  - Cards and thoughts are sorted with unreviewed first, then harshest first.
  - Each shows a red (2) or amber (1) dot with its reason, "not checked" when it hasn't been, and a "Reviewed" toggle. "Mark the rest reviewed" sits at the top.
  - Nothing about harshness reaches the projector or phones.
- Trust fine print and spec: "Submitted cards and thoughts go to Anthropic (Claude Haiku) for grouping and a check for harsh wording; they don't train on them and delete them within 30 days."

- [ ] **Step 1: Failing tests:**
  - `harshness answers map back from per-call numbers` (moderation, with a stub client)
  - `cards are checked once things are quiet for 5 seconds; levels reach the facilitator only`
  - `"Mark the rest reviewed" skips edgy and harsh items and includes unchecked ones`
  - `the walk-through holds before an unreviewed card, and Next marks it reviewed`
  - `with no API key nothing is checked and the walk-through still runs once the rest are marked reviewed`
  - The shred test: no harshness reason survives the shred.
- [ ] **Step 2–4:** red, implement, green (`npm test`).
- [ ] **Step 5: Try it with the real key** on 20 invented cards, including two put-downs and one card that is cute but cruel. Expected: those three get level 1 or more, and the rest 0. Record the timing in the spec.
- [ ] **Step 6: Spec, commit** "A quick harshness check, reviewed marks, and a hold before an unreviewed card".

---

### Task 12 (only if there's time): Credits roll on the closing screen

The thanks and credits play while the feedback QR code shows. The photos are taken just before the event, so they must never reach the server or a public page.

**Files:** `public/projector.js`, `public/projector.css`, `server/demo.js` (optional `credits`), `test/demo.test.js`, spec (Closing; Privacy).

**Interfaces:**
- Demo file: optional `credits: { title, lines: [string] }`, with a title of 1 to 60 characters and up to 12 lines of 1 to 80. It's public text, shown on the projector at the closing.
- The projector, on the teaser only, shows a small "Add credits photos" file input. The photos stay in that tab's memory as object URLs. They are never sent anywhere, and a reload loses them (the input says so).
- Closing: the QR code and "What do you think?" stay put. Beside them, the credits title and lines and the photos scroll slowly upward, about 40 s for one pass, then loop.

- [ ] **Step 1: Failing test:** `credits in the demo file are validated and reach the projector only at the closing`.
- [ ] **Step 2–4:** red, implement, green (`npm test`). Check headlessly with three test images.
- [ ] **Step 5: Spec, commit** "A credits roll at the closing, with photos that never leave the projector's tab".

---

### Task 13 (only if there's time): Custom image emojis, spike first

- [ ] **Step 1: Spike, at most 30 minutes, on real phones.**
  - On an iPhone (iOS 18.2 or later, Safari), insert a Genmoji into (a) the current `<input>` and (b) a `contenteditable` div. Record what arrives: an `<img>` or `<picture>` in the DOM, a `paste` event with an image `File`, or nothing.
  - On Android, do the same with a Gboard Emoji Kitchen sticker.
  - Write the findings into the spec under "Ideas for later".
- [ ] **Step 2: If no iPhone path delivers the image, stop here.** Commit the spec note: "Spec: custom image emojis aren't reachable from the web yet".
- [ ] **Step 3: If one does,** build it to this outline, and write the details into the spec first:
  - The phone shrinks the image to a 72×72 PNG `data:` URL of at most 16 KB.
  - A reaction may carry `img:<8-hex key>`. The server stores the image once in `s.images[key]`, within the 22-emoji limit.
  - The facilitator sees each new image as it arrives, with Hide. A hidden image is never projected and leaves the mix and the finale.
  - The projector draws images in the emoji mix and the finale's canvas.
  - The shred deletes them with everything else, and the shred test checks it.
  - Privacy note: a Genmoji can be made from a photo of a person, so the facilitator's Hide is the safeguard. Say so in the trust fine print.

---

## Not built (and why)

- **Grouping the end-of-deck thoughts with the AI** (suggested in the feedback). It's worth trying, but it adds another AI call while the room waits. Show them in pages for now; it's an idea for later.
- **Suggesting one person's custom emoji to everyone.** The 16 presets and each phone's own recent emojis are enough for now.
- **A shred preview in the demo.** The shred is the ending's surprise, and the teaser's "let it all go: nothing is kept" sets the tone without spoiling it.
- **A private page where chosen people add to the credits.** It would mean storing uploads on the server, which "nothing is kept" doesn't allow without its own design. It needs a separate plan.

## Before the talk (not code)

- [ ] The facilitator confirms the 8 new presets and their labels (Task 1) and the teaser copy (Task 2, Step 7).
- [ ] Rewatch the recording of the practice run with the new flow in mind.
- [ ] A solo run on two phones with the new flow (writing at Join, emojis only, a thought at the end, the last slide, the hold) before redeploying.
- [ ] Redeploy with `deploy/deploy.sh <ip>` once the live server is on the teaser (check the projector stream's `phase` first). Confirm the server log has no `demo: local file invalid`.
- [ ] Post the trailer (Task 4) after 1 pm on Nov 25.
