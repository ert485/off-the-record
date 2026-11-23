# Talk flow for Nov 25: demo stage, comments while reacting, a self-running flow, haiku themes

Nov 22, 2026 (rewritten from the Nov 21 draft) · for the Nov 25 DevTalk run · `Off the Record DevTalk Retro Spec.md` stays the source of truth and is updated in the same commits as the build.

## Intent

What success sounds like, from someone leaving the room: **"I didn't think a retro could get a whole room to open up that fast. Every conversation afterward went straight to the real stuff."** The retro is a way to meet each other: people meet the cards alone on their phones first, then together on the projector, and the time after the event is where it turns into conversations. The tool is the open-source part; the talk is the invitation.

What the practice runs and reflection since changed:

1. **The audience couldn't tell what the app wanted them to do.** Fix: a scripted demo stage, before anyone joins, that walks through the whole flow with one prepared card.
2. **The walk-through was slow and the anonymous pauses broke its rhythm.** Fix: comments move into the reaction phase, written privately alongside the emojis. The walk-through becomes a quick reveal (closer to a party game's results screen than a discussion) where the laughs land together, with a pause button for when someone starts talking.
3. **The facilitator had too much to run.** Fix: the app runs each part by itself on a talk clock and asks the facilitator one question between parts ("Ready for reactions?"), while the projector says it's waiting for the facilitator.
4. **Grouping is where the room sees itself from a distance.** Each theme gets a haiku from Claude Haiku, and theme names look like tabs on paper file folders, matching the office-records world the shredder already lives in.

## Goals

- A 25-minute talk clock the facilitator starts at the first slide, so the talk can't run into the next speaker's slot.
- The demo runs without fumbling: prepared content, stepped through on the projector.
- Submissions and reactions get generous time (5 minutes each); everything else is quick.
- Comments written while reacting, shown with their card in the walk-through.
- The app runs each part by itself and prompts the facilitator when it's time to move on; the facilitator confirms each move with one tap, and otherwise steps in only to approve, hide, pause or go back.
- The app reads as a reusable tool: "the facilitator", never "Erik", in the app and spec (talk logistics excepted).

## Non-goals (this round)

- Hardening back-and-forth (a submission timer that resumes, reactions following their cards through a regroup, resetting "finished reacting"). The demo stage removes the need for the 25th. Going back still works as today, with its known limits: after going back to submissions the window is at least 1 minute, and if new cards arrive and grouping runs again, existing reactions and comments detach from their cards.
- Deck caps per person, handling one person to thousands, waiting for enough cards, replacing a submitted card, a "people are typing" signal.
- Intro and closing slides inside the app. They live in the facilitator's own slide deck (personal photos never go on the public server).
- A haiku or written summary before the shred: the spec's reason stands (the AI would be speaking for the whole room at the ending). The haiku is per theme, approved by the facilitator.

## Anti-goals

- Pressure while people write or react: no "behind" or "over" on the projector; the submit and react timers count down with warnings, and the facilitator can add time.
- Any promise on screen that stops being literally true (the trust disclosure must match the new comment flow).
- Anything personal to Erik in the public repo beyond the talk logistics already there.

## Constraints

- Three days to the talk. Server behaviour is covered by tests (`npm test` stays green, with new cases); one solo run on the projector, a laptop and two phones before the 25th.
- The spec's "What the app must get right" still applies, with one change: "time is a visible hint, never pressure" now covers submissions and reactions; the walk-through is a timed reveal with a pause.
- No new dependencies.

## Approaches considered

- **A. Demo stage, comments while reacting, a self-running flow with one-tap moves (chosen).** The demo is its own scripted step before Join, so it never touches the live session's timers or groups. Comments join the reaction step, so the walk-through needs no pauses and can run itself.
- **B. Demo through the back button, plus timing and regroup fixes** (the Nov 21 draft). Live and flexible, but four separate fixes (submission timer, pace clock, regroup, "finished reacting") and more ways to fumble on stage. Dropped once the demo stage came up.
- **C. Keep today's flow and only add haiku and tabs.** Least work, but leaves the two problems the practice run found: a confused start and a slow walk-through.

## Design

### Talk plan (25 minutes, on the talk clock)

| Part | Where | Minutes | Moving on |
| --- | --- | --- | --- |
| Intro: who's talking, "show of hands: who's done a retro?", a throwback | Facilitator's slides | 0–1.5 | Facilitator switches to the projector tab |
| Demo | App: demo stage | 1.5–3.5 | Facilitator steps through; then "Start ▶" to Join |
| Join + trust disclosure | App | 3.5–5 | Facilitator |
| Submit | App | 5–10 | Prompt at time: "Ready for grouping?"; "+1 minute" as today |
| Group + approve themes | App | 10–10.5 | One tap: "Approve all and start reactions ▶" |
| React + comment | App | 10.5–15.5 | Prompt at time, or as soon as everyone has finished: "Ready for the walk-through?"; "+1 minute" |
| Walk-through (reveal) | App | 15.5–21.5 | Cards advance by themselves (pause, back, next); prompt at the end: "Ready for the finale?" |
| Finale | App | 21.5–22.5 | Prompt when it's done: "Ready to shred?" (with the confirm, as today) |
| Shred | App | 22.5–23.5 | Closing fades in by itself, as today |
| Closing + feedback QR, then the facilitator's own closing slides | App, then slides | 23.5–24.5 | Facilitator |
| Buffer | | 24.5–25 | |

- **Talk clock.** The facilitator starts it with one tap ("Start talk clock") at the first slide; it runs for a configurable length (default 25 minutes) and never restarts. The facilitator view shows time left in the talk and the ahead/behind marker against this plan. The projector shows only the current part's time left, as today.
- **Who absorbs slack.** Submit and react keep their 5 minutes (plus any "+1 minute" the facilitator adds). The walk-through absorbs the difference: when it starts, its length is set so it ends at minute 21.5 on the talk clock, never less than 3 minutes. Every other part has a fixed length.
- **Last call** becomes spoken: the last walk-through slide says "Anything else? Out loud." The separate last-call phase and its anonymous pause go away.

### Demo stage

- Before the demo comes a **teaser** phase: a title and up to four lines (the demo file's optional `teaser`; otherwise "Starting soon.") shown on phones and the projector, with no demo content. It is outside the talk plan, so leaving it never starts the talk clock.
- The demo is a new phase, before Join, shown on the **projector** (no screen-sharing of a participant or facilitator tab, so the facilitator token can't leak).
- It steps through a phone drawn on the projector, one step per "Next" on the facilitator view (with "Back"):
  1. The notepad with a few private notes, written in advance. One of them is the card to share (light); another is warmer and more personal, to show that both kinds belong.
  2. Picking one to share: the note is picked, the Share button goes from disabled to enabled and is tapped, and the note folds into a plain sealed envelope that slides up out of the phone. The phone then shows "Shared. You can still share 2 more." The card's text isn't shown in this step.
  3. Grouping: the card under a folder tab with its theme name and a haiku.
  4. Reacting: tapping preset emojis, adding a keyboard emoji (🌉), typing a comment.
  5. The reveal: the card on the projector with its emoji mix and the comment(s).
- The demo plays on a loop while people arrive (the steps last 10, 14, 12, 14 and 14 seconds, about a minute a round; the server moves the steps, so every projector agrees). Each step plays its entrance as it arrives, including the wrap back to the first, and there is no step counter on screen. Next or Back takes it off the loop, a facilitator switch puts it back (starting again from the first step, with its entrance), and starting the talk clock takes it off the loop and back to step 1.
- Content comes from a small data file, so the haiku and comments in the demo are written ahead of time. A generic example is committed; the facilitator's own file sits next to it, gitignored (it still deploys, since the deploy script copies untracked files), and is used when present. Claude drafts Erik's file from the material in this conversation (the bridge card, the follow-up comments, the personal note) and Erik edits it before the solo run on Nov 24.
- On leaving the demo, its card is added to the real session as an ordinary card (no author, like every card), so the room reacts to it for real. The demo's illustrative reactions and comments don't carry over.
- Phones that open the join link during the demo see a "Starting soon" screen.

### Comments while reacting

- Each card in the reaction deck gets an optional "Add a comment" box under the emojis (same length cap and local identifier hint as cards). One comment per phone per card, sent with that card's reactions; sending again with the card's receipt replaces both, as reactions work today. Comments are stored with no author.
- **Walk-through display:** the projector shows the card, its emoji mix, and up to 5 of its comments, with "+N more" when there are more.
- **Facilitator review:** the facilitator view shows the comments on the current card and the next one, each with Remove, so a comment can be removed before it's ever projected. The trust disclosure says the facilitator can remove any card or comment.
- **Removed:** the anonymous pause (request, hold, the pause comment box on phones, the projector's pause view, the facilitator's pause controls) and the server code behind it.

### The app runs each part; the facilitator confirms each move

- **Between parts, the facilitator confirms.** When a part's time is up (or earlier, when the app knows the part is done: everyone finished reacting, the walk-through reached its end, the finale finished), the facilitator view shows one prominent prompt ("Ready for the walk-through? ▶") and the projector shows "Waiting for the facilitator to confirm". Until the facilitator taps it, the part stays open: phones can still submit or react, so the prompt is never a deadline for the room. The facilitator can also move on before the prompt, go back a part, or add a minute to submit or react; participants can still suggest going back (counted on the projector).
- **Inside a part, the app runs itself:** the walk-through's cards advance on their own (below); the submit and react timers count down with warnings.
- **Walk-through** (Claude's calls, from "a quick run-through with a back/pause button"):
  - The finish time is fixed (minute 21.5 on the talk clock); the talk clock is the guarantee. A pause doesn't push it back: it eats into later cards' time.
  - Each card's time is the walk-through's time left (minus 20 seconds kept for the last slide) divided by the cards left, recomputed whenever a card changes, never less than 15 seconds.
  - When the time runs out with cards left, it goes to the last slide ("Anything else? Out loud.", 20 seconds), then prompts the facilitator: "Ready for the finale?". The skipped cards' reactions still count in the finale. The facilitator view shows "N cards left · ~M:SS each" throughout, so skipping is never a surprise, and Back still works.
  - The projector shows a thin bar on each card that drains as its time runs (no numbers), so someone speaking can see it coming and the facilitator can pause. This is the one place the room sees per-card time: Erik's call that "time is a hint, never pressure" covers submissions and reactions only.
  - The facilitator view has **Pause** (hold this card until resumed), **Back** and **Next**. Phones keep "Stay" and "Go back"; their counts show on the projector so the facilitator can decide to pause. "Move on" goes away (cards move on by themselves).
- **Submit and react at their time** (Claude's calls):
  - Phones warn ahead, as submissions do today: submit at 2 minutes and 1 minute (unchanged); react at 1 minute ("finish the card you're on") and 15 seconds. At zero, the part stays open until the facilitator confirms.
  - Nothing typed is lost: notes not picked stay private on the phone, as today. When reactions close, a phone sends the card it's on if it has an emoji or comment text, and the server accepts reaction and comment sends for 10 seconds after reactions close.
  - Once every phone that has joined has tapped "finished reacting", the facilitator is prompted early, so the spare time goes to the walk-through.
- **Waiting for the facilitator:** whenever the app is waiting on the facilitator (a move to confirm, themes to approve, the shred), the projector says so in plain words ("Waiting for the facilitator to confirm") and the facilitator view highlights the one action needed.

### Haiku per theme

- The grouping call asks Claude Haiku for one extra field per theme: a haiku (three short lines, about 5-7-5, separated by " / ") about what the theme's cards share. Plain and warm, wry where the cards are wry, gentle where they hurt; no names of people or companies, no advice, no judging. Stored on the theme, capped at about 120 characters.
- The facilitator's grouping view shows it under each theme name, editable and clearable (empty means none), so a weak haiku can be rewritten or replaced before it's shown. "Approve all" and per-theme approval cover the name and haiku together. The local fallback (no API key, skipped, failed) produces no haiku.
- The projector shows an approved theme's haiku on each card of that theme, small, below the emoji mix and comments. It is split at " / ", with each slash shown, dimmed, and lines break only between segments: one line when it fits, otherwise breaking at a slash. A segment too wide for its line shrinks (down to 70%) rather than wrap, and wraps only if it still doesn't fit. Not on the overview slide; never on phones.
- **Theme count:** about one theme per 12 cards, at least 2 and at most 5 (5 themes for 60 cards, 2 for 15). Tested on synthetic seed cards (`spike/` in this branch): forcing exactly 4 themes on 60 cards made a 25-card catch-all, and 4 themes on 15 cards gave themes of 1–2 thoughts.
- **The grouping prompt** is the one tested in `spike/haiku-themes.mjs` (Nov 22): group by the shared experience or feeling rather than the surface topic, no catch-all, no theme above about a third of the cards, a stricter near-duplicate rule, and a haiku that captures the shared feeling with one everyday image and a turn in the last line, without borrowing a single card's details. Revised Nov 23: the prompt's list of example images (which included "winter") made one-card themes about traffic come out wintry, so the image now has to come from the world the theme's cards describe, with no season, weather, temperature, or place stereotype the cards don't mention.
- **Effort and timing** (tested on 60 synthetic cards, Nov 22):

  | Effort | Time | Result |
  | --- | --- | --- |
  | low | ~20 s | Over-merged distinct cards as near-duplicates (a sick parent, a grandparent's death and aging parents pooled into one, so most phones would see only one) |
  | medium | ~25 s | Kept them apart; good haiku |
  | high | ~38 s | Best haiku ("Strangers at the door / a folding chair, a warm plate / we become a room") |
  | max | (none) | Ran past 64,000 output tokens without finishing; not usable |

- **Start grouping before submissions close** (Erik's design): at the 1-minute warning, the server starts a full grouping run at **high** effort on the cards so far. The facilitator can read and approve theme names and haiku while people finish submitting.
- **Late arrivals, placed and assessed in one quick call.** When the facilitator confirms "Ready for grouping?", one **low-effort** call (aim: under 10 seconds) gets the existing themes and groups plus the cards that arrived after the run started. For each late card it returns where it goes (an existing group as a near-duplicate, or an existing theme as a new group) and whether it might change the picture: it doesn't fit any theme well, or several late cards together suggest a theme that isn't there.
  - Nothing flagged: the late cards are placed, names and haiku stay as approved, and the facilitator approves as usual.
  - Something flagged: the facilitator view lists just the flagged late cards, with the model's one-line reason, and two choices: **"Keep the themes and add the late arrivals"** (placed as suggested) or **"Regroup everything (~40 seconds)"** (a full high-effort run; names and haiku are approved again). The projector shows "Waiting for the facilitator to confirm" meanwhile.
  - How many cards came late doesn't decide it; whether they'd change the themes does.
- **Why not always regroup:** most cards arrive in the last minute or two (the warnings tell people to pick then), and a full run would reshuffle themes the facilitator has already read, and take about 40 seconds while the room waits. The quick call keeps the early work unless the facilitator decides the picture really changed.
- **Before building, test the quick call** with the spike: split the seed cards into early and late, including a late cluster that deserves its own theme, and check it flags that and stays under 10 seconds.

**Spike result (`spike/late-arrivals.mjs`, Claude Haiku 5.5, effort `low`, `max_tokens` 4000, non-streaming).** The early 52 seed cards were grouped once at effort `high` into 4 themes (`spike/early-grouping.json`). Scenario A is 5 late cards that each have a close sibling among the early cards; scenario B is those 5 plus 3 cards about trucks hitting bridges, a topic no early theme covers. The first prompt worked, so there were no revisions. Two batches of three runs each:

| Run | A seconds (output tokens) | A flags | B seconds (output tokens) | B flags |
|---|---|---|---|---|
| Batch 1, run 1 | 2.6 (176) | none | 7.7 (1224) | missing theme: all 3 truck cards |
| Batch 1, run 2 | 4.3 (802) | none | 5.9 (1220) | missing theme: all 3 truck cards |
| Batch 1, run 3 | 1.2 (174) | none | 6.8 (1165) | missing theme: all 3 truck cards |
| Batch 2, run 1 | 4.6 (858) | none | 6.3 (1080) | missing theme: all 3 truck cards |
| Batch 2, run 2 | 3.9 (764) | none | 5.3 (1104) | missing theme: all 3 truck cards |
| Batch 2, run 3 | 1.2 (175) | none | 7.4 (1415) | missing theme: all 3 truck cards |

B was flagged in 6 of 6 runs, A had 0 false flags in 6 runs, and the slowest call was 7.7 seconds, so the 10-second aim holds with some margin (it grows with the number of flagged cards, since each flag writes a reason). The prompt's key rules: a card that shares a theme's underlying experience fits well even loosely or from a different angle, and only a card no theme covers is flagged; two or more late cards sharing an experience no theme covers are reported as one missing theme even if each could be squeezed into some theme, and one card alone never makes a missing theme. The exact prompt and output schema are `LATE_SYSTEM` and `LATE_SCHEMA` in `spike/late-arrivals.mjs`; the final prompt is the first one, unrevised.

### Folder tabs

- On the projector, each card's theme name is drawn as a manila folder tab on top of the card.
- The overview slide shows the themes as folder tabs in a file drawer, biggest first, with the card count.
- Legible from the back row, in the projector's existing palette. No change to phones.

### Facilitator, not Erik

- Replace "Erik" with "the facilitator" in all app text and in the spec, except the talk's own logistics (who, where, when).

### Said aloud, not built

- At Join: "Anything from funny to heavy belongs here; both are welcome."
- At the end of the walk-through or closing: "If a card hit you, find someone after the event and tell them 'that was me too.'"
- The facilitator's closing slides invite new connections, not only show existing ones: people who want to build community and share how things really feel, in retros like this and beyond, with a way to reach the facilitator after the event.


## Left to the builder

- State shape for the talk clock, demo steps, comments and walk-through timing.
- The demo data file's format, and how the projector draws the phone.
- Which 5 comments show when a card has more (a stable random order is fine).
- Folder tab CSS and the overview layout.
- The haiku prompt wording within the rules above, tuned with the spike.
