# Off the Record: DevTalk Retro Spec

Nov 1, 2026 · @Erik Tetland

## Talk overview

A facilitated, phone-based, anonymous retro on 2026 for the Saskatoon tech community, ending with everything shredded.

**Title:** Off the Record: A Live Retro on 2026

**Description (final):**

> A live, anonymous retro on 2026, for the humans of Saskatoon tech. Bring your phone and your feelings about the year, whatever they are. We'll see what we share, then shred it all.

**Logistics:** Saskatoon DevTalk, Wednesday, November 25, 2026. Slot is about 25–30 minutes, with a break between speakers. Around 40 guests, all technical people from the local scene.

## Intent and context

The goal is emotional, not productive: a safe place to express how the year felt and see that others in the community felt the same.

- **About humans, not roles.** The retro is about people in this community, not about work output or tech stacks.
- **Facilitator, not lecturer.** Erik facilitates. No content, questions or framing before submissions open, to avoid biasing input. During submissions, only light nudges from a preset list.
- **Release, not production.** No action items or tickets. The ending is the shred.
- **Depth through recognition, not long sharing.** In 30 minutes with 40 people, most won't share deeply, and that's fine. The depth comes from reading a card and thinking "that's exactly how I felt." Don't try to cover everything. The break afterward carries the conversation in person.
- **No presumption of a yearly event.** It could recur, but that isn't promised. The public repo lets anyone run it again without depending on one person or one host company.

## Session flow

The facilitator advances phases; every phone follows. Erik always has a back button (card or phase). Participants can suggest going back, and the projector shows the live count, so the room can steer while Erik decides. In look-up phases, phones mainly say "look up" but keep a few light taps; it's fine that using a phone is visible. Timings target 25 minutes (table below).

1. **Join.** QR code on the projector. Minimal logistics only: it's anonymous, nothing is kept, and you can always speak aloud instead.
2. **Open submissions.** One short prompt, no categories: "Something you experienced, felt, or were surprised by in 2026." Nudges from a preset list appear as rotating placeholder text in the input; whenever submissions go quiet for about 10 seconds, the AI picks the nudge for the least-covered direction. If the mix is already varied, no nudge is shown. Participants first write as many private notes as they like, freely and without self-censoring; notes never leave the phone. Then they intentionally pick up to 3 to submit as cards (anything still in the writing box when they go to pick is saved as a note first, so nothing typed is lost), about 140 characters each (hard cap 200). A loose local check softly flags possible identifiers on the picked notes; the author decides. Projector shows "on your phone". Erik sees a live count and can extend the window if cards are still trickling in.
3. **Cluster.** The AI groups cards into themes, with near-duplicates in one group. Erik approves cluster names. The stream is ordered later, once reactions are in.
4. **React.** Each phone shows one card at a time, shuffled per person, so every distinct thought gets a fair chance. Near-duplicates in a group don't each need a full chance; their reactions are pooled. Tap one or more emojis, then go to the next card. Each person makes one pass, one card per group. There's no fixed cutoff: Erik sees the share of phones finished and the elapsed time, and advances when it feels right (fast if there were few submissions).
5. **Walk through the stream (look-up phase).** Phones say "look up". Erik advances one card at a time on the projector, showing its emoji mix. Aim for 4–6 clusters. Card timers are on Erik's view only (time on the card against a rough per-card share of the walk-through); the projector shows no countdown, since a visible clock makes people feel rushed. People speak aloud by raising a physical hand.
   1. **Anonymous pause:** anyone can request a pause for anonymous comments, and Erik starts it with one tap or holds it for later ("Later": the request keeps waiting and the projector shows "Pause: coming up", so someone speaking can finish first; Erik starts it when ready). The pause ends when everyone who opened the comment box has submitted (but not before 15 seconds, so one fast typist can't end it for everyone), or at 90 seconds. Then there's a 20-second grace period to submit as is or cancel. One comment per person per pause. Erik can also end a pause early.
6. **Last call.** One final chance to request an anonymous pause.
7. **Finale.** The room's whole emoji mix projected as one wordless visual, an emotional fingerprint of the year. A moment of quiet.
8. **Shred.** Everything is visibly destroyed and actually deleted. Visual: a literal shredder; the pooled emojis, then the cards behind them, are pulled down through a slot and fall away as strips, ending on a black screen and a beat of silence. Back can't undo the shred, so it needs a confirm.
9. **Closing (optional).** What the app does, what was left out, and "what do you think?"

**Timing plan (25 minutes)**

| Phase | Minutes | Clock | Flex |
| --- | --- | --- | --- |
| Join + trust disclosure | 2 | 0–2 | LTE stragglers are the risk |
| Submissions (notes, then pick) | 4 | 2–6 | 3–6, Erik's call |
| Cluster + approve names | 1 | 6–7 | Mostly ready from background runs |
| React | 2.5 | 7–9.5 | 2–4, Erik's call |
| Walk-through | 9.5 | 9.5–19 | Absorbs slack either way |
| Last call | 0.5 | 19–19.5 |  |
| Finale (fingerprint + quiet) | 1 | 19.5–20.5 |  |
| Shred | 1 | 20.5–21.5 |  |
| Closing | 1 | 21.5–22.5 | Optional; first thing cut |
| Buffer | 2.5 | 22.5–25 |  |

The walk-through is the overrun risk: cards take about 3 minutes, and each anonymous pause can take nearly 2. A lively walk-through eats the closing and buffer first.

Pace indicator: a wordless ahead/behind marker showing where the session is against where it should be to finish on time. No phase names. Facilitator view only: on the projector, a visible "behind" would make people hold back.

## App spec

Three views, one small server. Keep it minimal: about 40 users needs no heavy realtime infrastructure.

| View | Shows | Actions |
| --- | --- | --- |
| Phone (participant) | The current phase. Input phases: a private notepad, then a pick step with a soft identifier hint; a one-card-at-a-time reaction stack. Look-up phases: a dim "look up" screen | Write unlimited private notes, then pick up to 3 to submit (local check, author decides); tap one or more emojis per card; request an anonymous pause; comment during pauses (about 140 characters); look-up taps: "stay" (counted on the projector), "move on" (private to Erik); suggest going back (counted on the projector) |
| Projector | Join QR (after Join, stays small in a corner for latecomers, hidden during the finale and shred), "on your phone", the current card in the stream with its emoji mix, comments arriving live during pauses, pause countdown, live counts of people asking to stay or suggesting going back, emotional fingerprint, shred animation | None |
| Facilitator | Everything, plus live submission count, share of phones finished reacting and elapsed time, pace indicator, private "move on" signal, and phase controls | Advance phases and cards; go back a card or phase; extend the submission window; turn nudges on or off; approve cluster names; hide a card, or remove a comment after it appears (one tap, no reason needed); accept or hold pause requests; trigger the shred |

**Design rules**

- No dot voting. Emoji reactions are the signal, and they capture mixed feelings.
- Emojis: 8 preset reactions (🙋 me too, 🫂 sending care, 😂 laughed, 🥲 bittersweet, 😢 sad, 😤 frustrated, 😰 anxious, 🎉 glad for you) plus any emoji from the phone keyboard (covers inside jokes).
- The reaction stack is shuffled per person so reactions spread evenly. Advancing is a plain "next", never a left/right swipe that feels like accept or reject.
- Too few cards (under about 10–15): stream every card and spend longer on each, still clustering near-duplicates. Too many: a curated stream with "+N similar".
- Phone vibrates on each phase change where the browser allows it (Android, after a first tap: the join screen has an "I'm here" button for that). iPhones don't support web vibration, so every phone also flashes its screen.
- Steering signals that don't cut a speaker off (stay, suggest back, pause requests) show as live counts on the projector. "Move on" is private to Erik, since projecting "move on" while someone talks would be harsh. No "this one hit me": the emoji mix already shows how much a card landed.
- No digital raise hand; physical hands keep the room human.
- No open anonymous Q&A during the walk-through. Anonymous comments happen only in pauses, about the current card.

**Build notes**

- One server, SQLite, SSE or 2-second polling. As built: Node 22 with no framework, the built-in `node:sqlite`, plain HTML and JavaScript with no build step. SSE sends each screen a full snapshot of what it may see (phones never receive hidden cards, unapproved theme names, "move on" counts or the pace marker), so a phone that drops off LTE just catches up. Two dependencies: the Anthropic SDK and a QR code library.
- Hosting: an EC2 instance in Erik's personal AWS account at `otr.tetl.ca` (DNS at the tetl.ca registrar points to an Elastic IP). Caddy in front for HTTPS with all of its logging discarded; the app logs nothing about requests. No EBS snapshots, no AWS Backup plan, no VPC flow logs, no load balancer. The instance is terminated after the talk, which destroys its disk.
- Phones keep private notes in the tab's sessionStorage: they survive a reload on a flaky connection, and they're wiped when the tab closes or the shred happens.
- Phones warn twice before submissions close: at 2 minutes ("leave time to pick what you share") and at 1 minute ("pick what to share now"), so a slow writer still has time to pick.
- The emoji box on the reaction card takes emojis only: letters are cleared with a hint to switch to the emoji keyboard, and a preset typed from the keyboard selects that preset.
- The projector (Erik's laptop only) loads Noto Color Emoji from Google Fonts; participants' phones load nothing from third parties.
- Test on LTE; don't rely on venue wifi. Render emojis on the projector in one font (such as Noto Color Emoji) so phone styles don't clash.
- QR code must be readable from the back row; projector text legible at a distance.
- Rehearse twice. Tech run, solo, by Nov 18 (code near-final): laptop as facilitator plus 3–4 devices, one on LTE; check phase sync, back, clustering, real deletion, projector legibility. Full run, Nov 20–22, 5–10 people on their own phones on the real 25-minute clock; check timings, nudges, false flags, controls, finale and shred feel. Ask testers: "Did anything make you hold back?"

**Facilitator access (no logins)**

- "One facilitator" means one secret, not one device: a facilitator token, set as an env var for this one event.
- Facilitator view at a secret URL like `/facilitate?t=…`, bookmarked on both laptop and phone. Both work at once, so a crash never locks Erik out. Without the right token the URL returns "not found", and pages send no referrer, so the token can't leak through a link.
- Participants only ever get the join code. The facilitator view has no submit option; Erik can submit his own card from a participant tab like anyone else.

## Facilitation logic

Anonymizing happens locally on each phone, with no AI. The AI only clusters and orders cards after they're submitted.

**Pre-submission check (local, no AI)**

- Loose heuristics on the phone (case-insensitive matching against a list of local company names and a few thousand common first names, minus names that are also common words like "will" or "mark") show a soft indicator: "You might have named or identified someone here. Consider rephrasing if so."
- The author decides whether to edit. Nothing is blocked, and the text stays on the phone until submitted.
- The same check applies to comments.
- No cloud AI anonymizing and no facilitator moderation queue. Accepted tradeoff: a card that slips past the heuristics may be projected. The only safety net is that Erik can hide any card before it's projected. Hidden cards leave the stream and reaction stack and are shredded with everything else.

**Clustering and the stream**

- Groups submitted cards into themes, including near-duplicates when there are few cards.
- Neutral cluster labels, approved by Erik before projection. Whenever submissions go quiet for about 10 seconds, the server re-clusters everything in the background and Erik's view shows the latest draft. On close, a draft with no newer cards is used as is; otherwise one final full run (about 5–10 seconds).
- Orders cards into one stream: split clusters first, a few representative cards per cluster, the rest as "+N similar". Keep the ordering rule simple and transparent, since order is a form of editorial framing. The rule as built (`server/stream.js`): themes in order of total reactions; inside a theme, distinct thoughts in order of reactions; with 15 or fewer distinct thoughts, show them all, otherwise the top 3 per theme, the last one carrying "+N more like this". Near-duplicates always show as one card with "+N similar".
- Hidden cards are never sent to the AI. If clustering fails (or there's no API key), every card becomes its own group in one theme and Erik names it; a Retry button re-runs it.
- Budget about 10 seconds per card shown.

**Nudges (preset, any year)**

Shown as rotating placeholder text. As built (`server/nudges.js`): with fewer than 5 cards, phones rotate all six. After that, once submissions are quiet for 10 seconds, Claude Haiku tags each visible card with the directions it touches, and phones show only the nudge for the first direction no card covers; if every direction is covered, no nudge. Erik's view says which nudge phones are showing, and the toggle turns them off. The AI matches cards to labels and shows the nudge for the least-covered one; "good" and "hard" are a balancing pair. No "someone who…" nudges, since they invite names. Refine after practice rounds.

| Label | Nudge text |
| --- | --- |
| outside work | Something away from the keyboard. |
| small moment | A small moment that stuck with you. |
| change | Something that changed for you. |
| connection | A time you felt connected, or didn't. |
| good | Something you're glad about. |
| hard | Something that was hard. |

**Finale (replaces the written summary)**

A written AI summary would turn the ending into production and have the AI speaking for the room. Instead, project the room's whole emoji mix as one wordless visual.

- An emotional fingerprint of the year: "this is all of us" without a deliverable. Visual: every reaction arrives as a small emoji in the order reactions happened (about a 10-second replay), then pools into one emoji per type, sized by count (area, not radius). Rare keyboard emojis stay small. No count labels: size alone carries scale, keeping the finale wordless and number-free. Optional: a faint trail of the original particles around each pool.
- Let it sit for a moment, then shred it with everything else.
- No note-taker. Recording spoken points would undermine "off the record" and make people self-censor.

## Privacy and the shred

The shred is the core of the vibe: it makes anonymity believable and turns the retro into release rather than production.

Why it works: impermanence invites candor in a small community where everyone knows everyone; ending in destruction says the point was saying it and being heard; it's a ritual with a clear emotional close; and it leaves nothing to maintain.

**Requirements**

- No login, no names stored. Unsubmitted notes never leave the phone and are discarded.
- Cards are stored with no author and no timestamp, under random ids, so their order doesn't reveal which cards one phone submitted together. The server knows each phone only by a random id, and keeps counts against it (cards submitted, cards reacted to), never which cards or reactions.
- The shred deletes the SQLite database and everything else in the data directory (the app writes nothing anywhere else), then keeps the pooled emojis and card text in memory only for the projector's 30-second animation. `test/shred.test.js` proves it: it runs a whole session and then checks that no file, log line or screen still holds any of it, and that the server printed no IP address.
- Identifier checks run locally; the author decides exactly what gets shared.
- After submission, cards go to Anthropic's API (Claude Haiku 5.5, chosen for speed) for clustering. Softened promise, stated in one sentence: the provider doesn't train on the cards and deletes them within its retention window (about 30 days); everything on our server is gone tonight. Checked Nov 19 against Anthropic's privacy center: API inputs and outputs are deleted within 30 days, except content its safety systems flag for a usage-policy violation, which can be kept up to 2 years. Haiku 5.5 is not one of the "Covered Models" with special retention rules.
- The shred must be literally true on our side: delete all server data, including backups and any files on disk. Say so.
- Turn off server access logs (no IP addresses kept) and skip hosting analytics.
- Be honest about the limit: in a room of about 40 people, a card's content can identify someone even with names removed.
- No published results.

**Trust disclosure (keep it short)**

One slide or sentence in plain language, plus the repo link and QR code for anyone who wants to check. On the projector, a short version is big ("Anonymous: no logins, no names. Your notes stay on your phone. Everything is shredded tonight.") and the full disclosure below it is fine print, read aloud. No lengthy security defence; it would read as suspicious and eat the minimal opening. Optionally, one respected community member reviews the repo beforehand and Erik mentions it in one line. The disclosure names every power Erik has, including that he sees cards before they're shown and can remove any card or comment. Comments appear live, so they can only be removed after they show.

Draft (one slide, read aloud during Join, about 20 seconds):

> Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. Submitted cards go to Anthropic (Claude Haiku) for grouping; they don't train on them and delete them within 30 days. I see cards before they're shown and can remove any card or comment to prevent abuse. Everything on our server is shredded tonight. Code: \[short repo URL\]

Controls are explained just in time, not here: at the start of the walk-through, one line that phones can ask Erik to stay, move on, or go back.

## Excluded, later ideas, and open questions

**Deliberately excluded (decided)**

- Pre-submissions before the event, at least for this first run.
- Retro categories (4Ls, Mad/Sad/Glad and so on).
- Dot voting.
- Publishing results.
- Any content or framing from Erik before submissions.
- Cloud AI anonymizing and a facilitator moderation queue.
- A written AI summary (replaced by the emotional fingerprint).
- A note-taker for spoken points.
- A digital raise hand.

**Ideas for later (good material for the closing "what do you think?" segment)**

- AI-assisted custom emoji creator for inside jokes.
- Anonymous free-text questions to the facilitator.
- Making the public repo contributor-friendly so others can run and improve it.
- A written "state of the room" summary, if a future run wants one.

**Open questions**

- [x] The preset nudge list (the main remaining source of bias): light, general enough for any year, kept in the repo, refined after practice rounds
- [x] Minute-by-minute timings per phase
- [x] The 8 preset emotion emojis
- [ ] Compile the company list and first-name list for the local check. Started: `public/lists/first-names.txt` is built by `scripts/build-first-names.mjs` (about 2,500 common names from public-domain US baby-name data since 1950, plus `scripts/first-names-extra.txt`, minus everyday words); `public/lists/companies.txt` is a seed list that still needs a local pass
- [x] Whether Erik can hide a card from the stream (abuse fallback)
- [x] Design of the emotional fingerprint visual
- [x] Model provider for clustering, and its retention terms
- [x] Exact wording of the trust disclosure
- [ ] Optional: ask someone to review the repo (respected locally, not a colleague; about 30 minutes, a week before; checks no logging, real deletion, only card text sent to the API)
- [x] Shred visual on the projector
- [ ] Pick 5–10 testers for the Nov 20–22 full run (comfortable in the real room, not all close friends)
