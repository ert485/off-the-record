# Talk flow for Nov 25: demo stage, comments while reacting, auto-advance, haiku themes

Nov 22, 2026 (rewritten from the Nov 21 draft) · for the Nov 25 DevTalk run · `Off the Record DevTalk Retro Spec.md` stays the source of truth and is updated in the same commits as the build.

## Intent

What success sounds like, from someone leaving the room: **"Look at all these people I could be friends with,"** and **"I don't feel so alone, or so scared of what's coming."** The retro is a way to meet each other: people meet the cards alone on their phones first, then together on the projector, and the time after the event is where it turns into conversations. The tool is the open-source part; the talk is the invitation.

What the practice runs and reflection since changed:

1. **The audience couldn't tell what the app wanted them to do.** Fix: a scripted demo stage, before anyone joins, that walks through the whole flow with one prepared card.
2. **The walk-through was slow and the anonymous pauses broke its rhythm.** Fix: comments move into the reaction phase, written privately alongside the emojis. The walk-through becomes a quick reveal (closer to a party game's results screen than a discussion) where the laughs land together, with a pause button for when someone starts talking.
3. **The facilitator had too much to run.** Fix: the app advances by itself on a talk clock, and the projector says when it's waiting on the facilitator.
4. **Grouping is where the room sees itself from a distance.** Each theme gets a haiku from Claude Haiku, and theme names look like tabs on paper file folders, matching the office-records world the shredder already lives in.

## Goals

- A 25-minute talk clock the facilitator starts at the first slide, so the talk can't run into the next speaker's slot.
- The demo runs without fumbling: prepared content, stepped through on the projector.
- Submissions and reactions get generous time (5 minutes each); everything else is quick.
- Comments written while reacting, shown with their card in the walk-through.
- The app moves itself forward; the facilitator steps in only to approve, hide, pause, go back, or confirm the shred.
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

- **A. Demo stage, comments while reacting, auto-advance (chosen).** The demo is its own scripted step before Join, so it never touches the live session's timers or groups. Comments join the reaction step, so the walk-through needs no pauses and can run itself.
- **B. Demo through the back button, plus timing and regroup fixes** (the Nov 21 draft). Live and flexible, but four separate fixes (submission timer, pace clock, regroup, "finished reacting") and more ways to fumble on stage. Dropped once the demo stage came up.
- **C. Keep today's flow and only add haiku and tabs.** Least work, but leaves the two problems the practice run found: a confused start and a slow walk-through.

## Design

### Talk plan (25 minutes, on the talk clock)

| Part | Where | Minutes | Advances |
| --- | --- | --- | --- |
| Intro: who's talking, "show of hands: who's done a retro?", a throwback | Facilitator's slides | 0–1.5 | Facilitator switches to the projector tab |
| Demo | App: demo stage | 1.5–3.5 | Facilitator steps through; then "Start ▶" to Join |
| Join + trust disclosure | App | 3.5–5 | Facilitator |
| Submit | App | 5–10 | Automatically at time; "+1 minute" as today |
| Group + approve themes | App | 10–10.5 | Automatically once grouping is done and every theme is approved |
| React + comment | App | 10.5–15.5 | Automatically at time; "+1 minute" |
| Walk-through (reveal) | App | 15.5–21.5 | Cards advance by themselves; pause, back, next |
| Finale | App | 21.5–22.5 | Automatically to the shred confirm |
| Shred | App | 22.5–23.5 | Facilitator confirms (never automatic) |
| Closing + feedback QR, then the facilitator's own closing slides | App, then slides | 23.5–24.5 | Facilitator |
| Buffer | | 24.5–25 | |

- **Talk clock.** The facilitator starts it with one tap ("Start talk clock") at the first slide; it runs for a configurable length (default 25 minutes) and never restarts. The facilitator view shows time left in the talk and the ahead/behind marker against this plan. The projector shows only the current part's time left, as today.
- **Who absorbs slack.** Submit and react keep their 5 minutes (plus any "+1 minute" the facilitator adds). The walk-through absorbs the difference: when it starts, its length is set so it ends at minute 21.5 on the talk clock, never less than 3 minutes. Every other part has a fixed length.
- **Last call** becomes spoken: the last walk-through slide says "Anything else? Out loud." The separate last-call phase and its anonymous pause go away.

### Demo stage

- A new first phase, before Join, shown on the **projector** (no screen-sharing of a participant or facilitator tab, so the facilitator token can't leak).
- It steps through a phone drawn on the projector, one step per "Next" on the facilitator view (with "Back"):
  1. The notepad with a few private notes, written in advance. One of them is the card to share (light); another is warmer and more personal, to show that both kinds belong.
  2. Picking one to share; it becomes a card.
  3. Grouping: the card under a folder tab with its theme name and a haiku.
  4. Reacting: tapping preset emojis, adding a keyboard emoji (🌉), typing a comment.
  5. The reveal: the card on the projector with its emoji mix and the comment(s).
- Content comes from a small data file, so the haiku and comments in the demo are written ahead of time. A generic example is committed; the facilitator's own file sits next to it, gitignored (it still deploys, since the deploy script copies untracked files), and is used when present. Claude drafts Erik's file from the material in this conversation (the bridge card, the follow-up comments, the personal note) and Erik edits it before the solo run on Nov 24.
- On leaving the demo, its card is added to the real session as an ordinary card (no author, like every card), so the room reacts to it for real. The demo's illustrative reactions and comments don't carry over.
- Phones that open the join link during the demo see a "Starting soon" screen.

### Comments while reacting

- Each card in the reaction deck gets an optional "Add a comment" box under the emojis (same length cap and local identifier hint as cards). One comment per phone per card, sent with that card's reactions; sending again with the card's receipt replaces both, as reactions work today. Comments are stored with no author.
- **Walk-through display:** the projector shows the card, its emoji mix, and up to 5 of its comments, with "+N more" when there are more.
- **Facilitator review:** the facilitator view shows the comments on the current card and the next one, each with Remove, so a comment can be removed before it's ever projected. The trust disclosure says the facilitator can remove any card or comment.
- **Removed:** the anonymous pause (request, hold, the pause comment box on phones, the projector's pause view, the facilitator's pause controls) and the server code behind it.

### Auto-advance and "waiting on the facilitator"

- Parts advance on their own as in the table. The facilitator can always go back a part, skip ahead, or add a minute to submit or react; participants can still suggest going back (counted on the projector).
- **Walk-through** (Claude's calls, from "a quick run-through with a back/pause button"):
  - The finish time is fixed (minute 21.5 on the talk clock); the talk clock is the guarantee. A pause doesn't push it back: it eats into later cards' time.
  - Each card's time is the walk-through's time left (minus 20 seconds kept for the last slide) divided by the cards left, recomputed whenever a card changes, never less than 15 seconds.
  - When the time runs out with cards left, it goes to the last slide ("Anything else? Out loud.", 20 seconds), then the finale starts by itself. The skipped cards' reactions still count in the finale. The facilitator view shows "N cards left · ~M:SS each" throughout, so skipping is never a surprise, and Back still works.
  - The projector shows a thin bar on each card that drains as its time runs (no numbers), so someone speaking can see it coming and the facilitator can pause. This is the one place the room sees per-card time: Erik's call that "time is a hint, never pressure" covers submissions and reactions only.
  - The facilitator view has **Pause** (hold this card until resumed), **Back** and **Next**. Phones keep "Stay" and "Go back"; their counts show on the projector so the facilitator can decide to pause. "Move on" goes away (cards move on by themselves).
- **Submit and react at their time** (Claude's calls):
  - The part ends when its timer reaches zero (the facilitator can add a minute before then). Phones warn ahead, as submissions do today: submit at 2 minutes and 1 minute (unchanged); react at 1 minute ("finish the card you're on") and 15 seconds.
  - Nothing typed is lost: notes not picked stay private on the phone, as today. When reactions close, a phone sends the card it's on if it has an emoji or comment text, and the server accepts reaction and comment sends for 10 seconds after reactions close.
  - Reactions end early once every phone that has joined has tapped "finished reacting", handing the time to the walk-through. Submissions don't end early.
- **Waiting on the facilitator:** whenever the app can't proceed without the facilitator (themes not yet approved, the shred confirm), the projector says so in plain words ("Waiting on the facilitator to approve the themes") and the facilitator view highlights the one action needed.

### Haiku per theme

- The grouping call asks Claude Haiku for one extra field per theme: a haiku (three short lines, about 5-7-5, separated by " / ") about what the theme's cards share. Plain and warm, wry where the cards are wry, gentle where they hurt; no names of people or companies, no advice, no judging. Stored on the theme, capped at about 120 characters.
- The facilitator's grouping view shows it under each theme name, editable and clearable (empty means none), so a weak haiku can be rewritten or replaced before it's shown. "Approve all" and per-theme approval cover the name and haiku together. The local fallback (no API key, skipped, failed) produces no haiku.
- The projector shows an approved theme's haiku on each card of that theme, small, as one line, below the emoji mix and comments. Not on the overview slide; never on phones.
- **Theme count:** about one theme per 12 cards, at least 2 and at most 5 (5 themes for 60 cards, 2 for 15). Tested on synthetic seed cards (`spike/` in this branch): forcing exactly 4 themes on 60 cards made a 25-card catch-all, and 4 themes on 15 cards gave themes of 1–2 thoughts.
- **The grouping prompt** is the one tested in `spike/haiku-themes.mjs` (Nov 22): group by the shared experience or feeling rather than the surface topic, no catch-all, no theme above about a third of the cards, a stricter near-duplicate rule, and a haiku that captures the shared feeling with one everyday image and a turn in the last line, without borrowing a single card's details.
- **Effort: medium** (was low). On 60 cards, low took about 20 seconds and over-merged distinct cards as near-duplicates (a sick parent, a grandparent's death and aging parents pooled into one, so most phones would see only one of them); medium took about 25 seconds, kept them apart, and wrote better haiku. Grouping time comes out of the walk-through, which absorbs slack; "Skip the AI" stays available.

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

## Repo easter eggs

On a long-lived branch with a cheeky name (`nobody-did-it`), kept up to date with `main`, so they never get in the way of real work. Small nods (code comments, test fixture text, constant names) to motifs from the talk's thinking: Homer, Saskatoon's bridges, and a few others. They change no behaviour: the full test suite passes on the branch. Erik left the motifs to Claude's interpretation of the conversation; Claude places them after the main work passes its tests, and they're the first thing dropped if time runs short before Nov 25. Erik reviews them.

## Left to the builder

- State shape for the talk clock, demo steps, comments and walk-through timing.
- The demo data file's format, and how the projector draws the phone.
- Which 5 comments show when a card has more (a stable random order is fine).
- Folder tab CSS and the overview layout.
- The haiku prompt wording within the rules above, tuned with the spike.
