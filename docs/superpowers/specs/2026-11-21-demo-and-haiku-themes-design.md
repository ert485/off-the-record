# Demo run-through, haiku themes and folder tabs: design

Nov 21, 2026 · for the Nov 25 DevTalk run · source of truth stays `Off the Record DevTalk Retro Spec.md`, which gets updated in the same commits as the build.

## Intent

What success sounds like, in Erik's words: someone leaves saying **"I had no idea how emotionally rich we are to be in this community."** The point isn't only "you're not alone" (relief for one person); it's the room discovering its own range, the funny and the tender together.

Two things from the practice run at Erik's workplace and the reflection since:

1. **The audience couldn't tell what the app wanted them to do.** Fix: before anyone starts, Erik shares his screen and runs the whole flow once himself (submit, group, react, comment) with a prepared example, then goes back and the real session continues with his card in it. This deliberately bends the spec's "no content or framing before submissions" rule: showing the flow once beats a confused room. Erik keeps a list of example notes with a range of tone (one light, one tender), so the demo shows range rather than setting a single register.
2. **The grouping step is where the room sees itself from a distance** (one card is a close-up; a theme is the long shot, where "only me" becomes "all of us", often with a laugh). Make that moment richer: each theme gets a haiku written by Claude Haiku, and themes look like tabs on paper file folders, matching the office-records world the shredder already lives in.

## Goals

- The facilitator can move forward and back through submit, group, react and walk-through as freely as he likes, and the timing still works: the real submission window isn't eaten by a demo, and the overall clock still protects the event's end time.
- Erik's demo card keeps its reactions and comments after everyone else's cards are grouped with it.
- Every theme can carry a short haiku, approved by Erik with the name, shown on the projector.
- Theme names look like manila folder tabs on the projector.

## Non-goals (this round)

- A separate practice-round mode or button. Erik rejected it: flexibility of back and forward is the mechanism.
- The "people are typing" pause, scaling the UX from one person to thousands, contested-card animations. Kept as later ideas.
- A haiku or written summary before the shred. The spec's reason stands (it would have the AI speaking for the whole room at the ending); the haiku lives at the theme level, where Erik approves it.

## Anti-goals

- Anything that makes the room hold back: no "behind" or "over" shown to the room, no new numbers on the projector.
- Any promise on screen that stops being literally true.
- The facilitator token on a shared screen (see Demo notes).

## Constraints

- Four days to the talk; changes must be small, server-tested, and leave the current flow unchanged when there is no demo.
- The existing principles in the spec's "What the app must get right" apply, especially "nothing a person does is lost" and "the facilitator view works at a glance for a first-time facilitator".
- No new dependencies. Tests (`npm test`) stay green and get new cases for each behaviour below.

## Approaches considered

- **A. Back button plus timing and regroup fixes (chosen).** No new mode. Fix the four things that break today when the facilitator goes back: the submission window, the pace clock, reactions or comments detaching on regroup, and phones stuck on "finished reacting". Also helps any real session that goes back to let stragglers in.
- **B. A "practice round" button** that runs a throwaway session and copies the card into the real one. Cleaner separation, but one more control for a first-time facilitator, and the demo's reactions and comments don't come along. Erik prefers flexibility over a mode.
- **C. No code.** Extend the window by hand, ignore the pace marker, lose the demo card's emoji and comments. Fragile on stage.

## Design

### 1. Timing that survives back and forth

The run order this assumes: **Join (QR and trust disclosure) → demo → real submissions.** (Decided by Claude from "hit the back button a few times and we continue"; see Open questions.)

**Overall clock (pace marker).** Unchanged in spirit: one clock for the whole event, so the session can't quietly run over. Two changes:

- The plan gets a **2-minute demo slot between Join and submissions**, taken from the buffer (2.5 → 0.5 minutes; the optional closing is still the first thing cut). New plan, in minutes: join 0–2, demo 2–4, submit 4–8, cluster 8–9, react 9–11.5, walk 11.5–21, last call 21–21.5, finale 21.5–22.5, shred 22.5–23.5, closing 23.5–24.5, buffer 24.5–25.
- The clock starts the **first time the facilitator moves forward out of Join**, back-dated by Join's planned 2 minutes (today it starts on first entering submissions, back-dated to the plan's submit start, which would count the demo twice). It never restarts, whatever happens next.
- Consequences: skipping the demo reads as "~2 min ahead" (true: the slot is unused, and the walk-through gets it). During the demo itself the facilitator view's pace reads "ahead" because the phases are later in the plan; Erik isn't looking at it then, and it settles once real submissions open. Accepted.

**Submission window: a chess clock.** The window counts only time actually spent in submissions. Leaving submissions (forward or back) stops it and remembers what's left; coming back resumes it, with at least 1 minute. First entry: 4 minutes, as today. So a 45-second demo leaves about 3:15 for the real round (Erik confirmed a little elapsed time is fine), and the phones' 2-minute and 1-minute warnings fire at the right moments. "+1 minute" (extend) works as today.

**React section timer.** Unchanged: restarts each time reactions are entered going forward, with the planned 2.5 minutes.

**Walk-through: absorbs slack, as the spec's timing table already says.** When the walk-through is entered going forward, its allotted time is set so it ends where the plan says it should on the overall clock (minute 21), but never less than half its planned length (4¾ minutes). Ahead of plan, it gets more time; behind, less. The projector's section timer and the facilitator's per-card average ("~2:23 average") both use this allotted time instead of the fixed 9½ minutes, and the ⓘ text says so ("the time left for the walk-through, divided by the cards"). Entering it again going forward recomputes; going back into it doesn't (as today).

### 2. Reactions and comments follow their cards through a regroup

When grouping runs again (new cards came in after the facilitator went back), every group gets a new id today, which cuts reactions and comments off from their cards. Instead, after a regroup, each old group maps to the new group that contains its first card, and reactions, comments and receipts are rewritten to the new group id. If two old groups end up in one new group (near-duplicates), their reactions pool, matching how near-duplicates already work.

Phones remember which cards they reacted to, keyed by group id, with the receipt that lets them change it. They must follow the same mapping (for example, the server includes the old-to-new id map in the phone's snapshot, and the phone rekeys its stored reactions), so a card already reacted to stays reacted to and changing it still replaces rather than adds. Group ids are already visible to phones, so the map reveals nothing new.

Approved theme names are not carried over: a regroup produces new themes, and Erik approves them again ("Approve all" is one tap). The finale already counts every reaction, so it's unaffected.

**"Finished reacting" resets when the deck changes.** Each phone has a server-side "done reacting" flag, and today nothing clears it. Any phone that tapped through the demo (Erik's tab, and anyone who joined early) would open the real reaction round on "That was every card" and never see the real cards, and the facilitator's "share of phones finished" would be too high. Rule (Claude's call): when a regroup adds cards, every phone's done flag clears. Entering reactions again without new cards (going back to fix a theme name, say) leaves it alone, so people who really finished stay finished.

**Merged groups (rare edge, Claude's call).** If two groups a phone already reacted to merge into one, the phone holds two receipts for one card, and the server's one-reaction-per-card cap (a per-phone count against the number of groups) would refuse that phone's last real card, silently. Fix: the cap allows one extra reaction for every group a regroup merged away (a session-wide number, so nothing is tied to a phone). On the phone, the merged card keeps the most recent receipt; the other set of reactions stays counted but can't be changed from that phone. This only arises when several cards submitted before a regroup turn out to be near-duplicates; with the demo shown before the QR (see Open questions), only Erik's own card exists at that point, so it can't happen.

### 3. Haiku per theme

- The grouping call asks Claude Haiku for one extra field per theme: a haiku (three short lines, roughly 5-7-5) about what the theme's cards share. Same rules as the name: plain and warm, no names of people or companies, no judging. Stored on the theme, capped (about 120 characters).
- Erik's grouping view shows it under each theme name, editable, and clearable (empty means no haiku). "Approve all" and per-theme approval cover the name and the haiku together. The local fallback (no API key, skipped, failed) produces no haiku.
- The projector shows an approved theme's haiku on each card of that theme, small, as one line with " / " between the lines, below the emoji mix. Not on the themes overview slide (six haiku is too much text for the back row) and never on phones (they say "look up").

### 4. Folder tabs

- On the projector, the theme name on each card is drawn as a manila folder tab on top of the card (tab shape, paper colour, card position stays where it is).
- The themes overview slide shows the themes as a row or stack of folder tabs in a file drawer, biggest first, with the card count, as now.
- Works in the projector's existing palette and stays legible from the back row. No change to phones or the facilitator view beyond the haiku field.

### Demo notes (said and done, not built)

- Erik demos from his own participant tab. The haiku moment is shown on the **projector** tab. Never screen-share the facilitator view: its URL carries the facilitator token.
- Erik approves the demo theme on his facilitator view on an unshared screen.
- One comment per phone per pause, so two follow-up comments in "a second voice" from one tab need two pauses.
- If people have already joined, their phones follow the demo's phases. That's fine: their notes are kept, and anything they submit or react with carries into the real round.

## Repo easter eggs

On a long-lived branch with a cheeky name (`nobody-did-it`), kept up to date with `main`, so they never get in the way of real work. Small nods (code comments, test fixture text, constant names) to motifs from the talk's thinking: Homer, Saskatoon's bridges, and a few others. They change no behaviour: the full test suite passes on the branch. Claude places them while building; Erik reviews them.

## Left to the builder

- Exact state shape for the chess clock and the walk allotment, and how the phone receives the regroup map.
- Folder tab CSS and the overview layout, within the projector's existing look.
- The haiku prompt wording, within the rules above.

## Open questions

- [ ] Run order: this design assumes Join → demo → submissions. If Erik demos before showing the QR instead, the clock should start at the demo (no back-dating), and the plan's join and demo slots swap.
