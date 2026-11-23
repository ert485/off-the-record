// All session state and every action on it. No HTTP and no disk here: the
// server persists `session.state` after each change and wires up the shred.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { nextPhase, previousPhase, paceMinutes, PLAN, SUBMIT_MINUTES, REACT_MINUTES, REACT_GRACE_MS, TALK_MINUTES, LAST_SLIDE_MS } from './phases.js';
import { pendingMove, walkEndsAt, cardMs, cardsLeft, earlyGroupingDue } from './flow.js';
import { localPlacer } from './cluster.js';
import { buildStream } from './stream.js';
import { isSingleEmoji } from '../public/shared/emoji.js';
import { NUDGES, MIN_CARDS, leastCovered } from './nudges.js';
import { shredTimeline } from '../public/shared/shred-timing.js';
import { DEMO_STEPS } from './demo.js';

export const LIMITS = { cardsPerPerson: 3, cardMax: 200, commentMax: 200, emojisPerCard: 12, themeName: 60, haiku: 120 };
// The projector shows this many comments on a card, the rest as "+N more".
export const COMMENTS_SHOWN = 5;
const OVERVIEW = 'overview';
const LAST = 'last';

export class ActionError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}
const fail = (message) => {
  throw new ActionError(message);
};

const emptySignals = () => ({ stay: {}, back: {} });
const count = (obj) => Object.keys(obj ?? {}).length;

export function freshState(now, talkMinutes = TALK_MINUTES) {
  return {
    // Random per session. Phones compare it with the one their notes were
    // written in, and wipe notes left over from a session they missed the end of.
    sessionId: randomBytes(8).toString('hex'),
    phase: 'demo',
    phaseStartedAt: now,
    // Which step of the demo the projector shows, and the card the demo added.
    demo: { step: 0, cardId: null },
    // The talk clock: starts with one tap, or backdated when the room moves
    // on without it, and never restarts.
    talk: { startedAt: null, minutes: talkMinutes },
    submitEndsAt: null,
    reactEndsAt: null,
    // When the room moved on from reacting, for the 10-second grace.
    reactClosedAt: null,
    // Off until the facilitator turns them on.
    nudgesOn: false,
    // Which nudges phones show: all in turn, one label, or none (mix is varied).
    nudge: { mode: 'all', label: null },
    // Cards carry no author and no timestamp. Ids are random so their order
    // doesn't reveal which cards one phone submitted together.
    cards: [],
    // Per anonymous phone id: counts only, never which cards or reactions.
    clients: {},
    nextId: 1,
    // early: the grouping started at the 1-minute warning (once per session).
    // late: the quick call placing cards that came in after the grouping ran.
    clustering: { status: 'idle', error: null, key: null, local: false, early: false, late: null },
    themes: [],
    // Pooled per group, in the order they happened (the finale replays it).
    reactions: [],
    // Receipt -> card, so a phone can change its reactions to that card.
    receipts: {},
    walk: { stream: [], index: 0, cardStartedAt: null, cardEndsAt: null, endsAt: null, paused: false, done: false, signals: emptySignals() },
    // { id, g, text, r }: no phone id. r is the card's receipt, so sending
    // again replaces the comment along with the reactions.
    comments: [],
    // Receipts whose comment the facilitator removed.
    removedComments: {},
  };
}

// A theme's haiku as one line: newlines become " / ". Not text, or too long to
// show whole, means none (a cut haiku reads broken; the facilitator can write one).
const oneLine = (raw) => raw.replace(/\s*[\r\n]+\s*/g, ' / ').replace(/ {2,}/g, ' ').trim();
export function cleanHaiku(raw) {
  if (typeof raw !== 'string') return '';
  const clean = oneLine(raw);
  return clean.length > LIMITS.haiku ? '' : clean;
}

// Makes the model's grouping safe to use: every visible card exactly once.
export function normalizeClusters(rawThemes, cardIds) {
  const wanted = new Set(cardIds);
  const seen = new Set();
  const themes = [];
  for (const t of rawThemes ?? []) {
    const groups = [];
    for (const g of t?.groups ?? []) {
      const ids = (Array.isArray(g) ? g : []).filter((id) => wanted.has(id) && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) groups.push(ids);
    }
    if (groups.length) themes.push({ name: String(t?.name ?? '').trim().slice(0, LIMITS.themeName), haiku: cleanHaiku(t?.haiku), groups });
  }
  const missing = cardIds.filter((id) => !seen.has(id));
  if (missing.length) themes.push({ name: 'Other', haiku: '', groups: missing.map((id) => [id]) });
  return themes;
}

// Makes the quick call's placements safe to use. Each late card is placed at
// most once, in a theme that exists; a group from another theme becomes a new
// group. Each card is in at most one flag (the first). A late card with no
// valid placement is flagged, and keeping it puts it in "Other".
export const NOT_PLACED = 'Not placed';
export function normalizePlacements(raw, { themeIds, groupIds, lateIds }) {
  const themes = new Set(themeIds);
  const groupTheme = new Map(groupIds);
  const late = new Set(lateIds);
  const placed = new Set();
  const placements = [];
  for (const p of Array.isArray(raw?.placements) ? raw.placements : []) {
    if (!late.has(p?.cardId) || placed.has(p.cardId) || !themes.has(p.themeId)) continue;
    placed.add(p.cardId);
    placements.push({ cardId: p.cardId, themeId: p.themeId, groupId: groupTheme.get(p.groupId) === p.themeId ? p.groupId : null });
  }
  const flagged = new Set();
  const flags = [];
  for (const f of Array.isArray(raw?.flags) ? raw.flags : []) {
    const cardIds = [];
    for (const id of Array.isArray(f?.cardIds) ? f.cardIds : []) {
      if (!late.has(id) || flagged.has(id)) continue;
      flagged.add(id);
      cardIds.push(id);
    }
    if (!cardIds.length) continue;
    const reason = typeof f.reason === 'string' && f.reason.trim() ? f.reason.trim().slice(0, 200) : 'Might not fit the themes';
    flags.push({ cardIds, reason });
  }
  for (const id of lateIds) if (!placed.has(id) && !flagged.has(id)) flags.push({ cardIds: [id], reason: NOT_PLACED });
  return { placements, flags };
}
export const QUICK_CHECK_FAILED = "The quick check didn't finish: ";
// A failed (or skipped) quick call flags every late card, with why. The
// message is a fixed label or the API's error, never card text.
function failedPlacement(lateIds, message) {
  return { placements: [], flags: lateIds.length ? [{ cardIds: lateIds, reason: QUICK_CHECK_FAILED + message }] : [] };
}

// Without the AI (it failed, or the facilitator skipped it): one theme, every
// card its own group, no name until the facilitator gives it one.
export const SKIPPED = 'Skipped';
function fallbackClusters(ids, error) {
  return { themes: normalizeClusters([], ids).map((t) => ({ ...t, name: '' })), status: 'failed', error, local: true };
}

export class Session {
  constructor({
    state,
    now = Date.now,
    clusterCards,
    placeLateCards = localPlacer,
    tagCards = null,
    demo = null,
    nudgeQuietMs = 10_000,
    talkMinutes = TALK_MINUTES,
    onChange = () => {},
    onShred = () => {},
    shredAnimationMs = null, // tests only: overrides the animation's length
    onReset = () => {},
  }) {
    this.now = now;
    this.tagCards = tagCards;
    // The prepared demo content (never stored in the state, never sent to phones).
    this.demo = demo;
    this.nudgeQuietMs = nudgeQuietMs;
    this.nudgeTimer = null;
    this.talkMinutes = talkMinutes;
    this.clusterCards = clusterCards;
    this.placeLateCards = placeLateCards;
    this.onChange = onChange;
    this.onShred = onShred;
    this.shredAnimationMs = shredAnimationMs;
    this.onReset = onReset;
    this.closingTimer = null;
    this.clusterRun = 0;
    this.shredPayload = null;
    this.state = state ?? freshState(now(), talkMinutes);
    this.state.nudge ??= { mode: 'all', label: null };
    this.state.receipts ??= {};
    if (!state?.shredded) {
      this.state.talk ??= { startedAt: null, minutes: talkMinutes };
      this.state.reactEndsAt ??= null;
      this.state.reactClosedAt ??= null;
    }
    if (!this.state.shredded) this.state.removedComments ??= {};
    if (!this.state.shredded) this.state.demo ??= { step: 0, cardId: null };
    this.state.sessionId ??= randomBytes(8).toString('hex');
    this.shredded = !!this.state.shredded;
    const c = this.state.clustering;
    if (c) {
      c.early ??= false;
      c.late ??= null;
      // A restart mid-grouping: run it again. The early run reruns in submit;
      // anywhere else, entering grouping starts what's needed.
      if (c.status === 'running') {
        c.status = 'idle';
        if (this.state.phase === 'submit' || this.state.phase === 'cluster') this.startClustering();
      }
      // A restart mid-placement: place the cards that still have no group again.
      if (c.late?.status === 'running') {
        c.late = null;
        if (this.state.phase === 'cluster') this.continueGrouping();
      }
    }
  }

  get s() {
    return this.state;
  }

  changed() {
    this.onChange();
  }

  // ---- lookups ----------------------------------------------------------

  card(id) {
    return this.s.cards.find((c) => c.id === id);
  }

  visibleCardIds(group) {
    return group.cardIds.filter((id) => this.card(id) && !this.card(id).hidden);
  }

  findGroup(id) {
    for (const theme of this.s.themes) {
      const group = theme.groups.find((g) => g.id === id);
      if (group) return { theme, group };
    }
    return null;
  }

  visibleGroups() {
    return this.s.themes.flatMap((t) => t.groups).filter((g) => this.visibleCardIds(g).length > 0);
  }

  reactionCounts() {
    const counts = new Map();
    for (const r of this.s.reactions) counts.set(r.g, (counts.get(r.g) ?? 0) + 1);
    return counts;
  }

  emojiMix(groupId) {
    const mix = new Map();
    for (const r of this.s.reactions) if (groupId === undefined || r.g === groupId) mix.set(r.e, (mix.get(r.e) ?? 0) + 1);
    return [...mix].sort((a, b) => b[1] - a[1]);
  }

  currentItem() {
    const { stream, index } = this.s.walk;
    return this.s.phase === 'walk' ? (stream[index] ?? null) : null;
  }

  // The card shown for a group: its first visible card.
  groupText(groupId) {
    const found = this.findGroup(groupId);
    const id = found && this.visibleCardIds(found.group)[0];
    return id ? this.card(id).text : null;
  }

  client(cid) {
    // Hex only, as phones make them. This also keeps out names like
    // "__proto__" or "constructor", which every plain object already has.
    if (typeof cid !== 'string' || !/^[0-9a-f]{16,64}$/.test(cid)) fail('Missing phone id');
    return (this.s.clients[cid] ??= { cards: 0, reacted: 0, reactDone: false });
  }

  newId() {
    return this.s.nextId++;
  }

  // ---- phases -----------------------------------------------------------

  // `from` is the phase the facilitator's screen showed when they tapped. If
  // the room has already moved on, the tap is ignored rather than skipping a part.
  advance({ confirm = false, from } = {}) {
    if (from !== undefined && from !== null && from !== this.s.phase) fail('Already moved on');
    const to = nextPhase(this.s.phase);
    if (!to) fail('This is the last phase');
    if (this.s.phase === 'cluster') {
      const c = this.s.clustering;
      if (c.status === 'running' || c.late?.status === 'running') fail('Grouping is still running');
      if (c.late?.status === 'flagged') fail('Choose: keep the themes or regroup');
    }
    if (to === 'shred') {
      if (!confirm) fail('Confirm the shred: it cannot be undone');
      return this.shred();
    }
    this.enter(to, 'forward');
    this.changed();
  }

  back() {
    const to = previousPhase(this.s.phase);
    if (!to) fail(this.shredded ? 'The shred cannot be undone' : 'Nothing to go back to');
    this.enter(to, 'back');
    this.changed();
  }

  enter(to, direction) {
    const now = this.now();
    const from = this.s.phase;
    // The demo's shared note joins the session as an ordinary card, once: no
    // author, and not counted against any phone.
    if (from === 'demo' && direction === 'forward' && this.demo && this.s.demo && this.s.demo.cardId === null) {
      this.s.demo.cardId = this.addCard(this.demo.notes.find((n) => n.share).text);
    }
    if (direction === 'forward' && to !== 'demo' && this.s.talk && this.s.talk.startedAt === null) this.s.talk.startedAt = now - PLAN[to][0] * 60_000;
    if (from === 'react' && direction === 'forward') this.s.reactClosedAt = now;
    this.s.phase = to;
    this.s.phaseStartedAt = now;
    if (to === 'react') {
      this.s.reactEndsAt =
        direction === 'forward' ? now + REACT_MINUTES * 60_000 : Math.max(this.s.reactEndsAt ?? 0, now + 60_000);
    }
    if (to === 'submit') {
      this.s.submitEndsAt =
        direction === 'forward' ? now + SUBMIT_MINUTES * 60_000 : Math.max(this.s.submitEndsAt ?? 0, now + 60_000);
    }
    if (to === 'cluster') this.continueGrouping();
    if (to === 'walk' && direction === 'forward') this.buildWalk();
    // Coming back to the walk-through holds the card until the facilitator resumes.
    if (to === 'walk' && direction === 'back') {
      Object.assign(this.s.walk, { paused: true, done: false, cardStartedAt: now, cardEndsAt: null });
    }
  }

  // The facilitator's taps through the demo's steps. Only while in the demo.
  demoStep(delta) {
    if (this.s.phase !== 'demo') fail('The demo is over');
    const step = this.s.demo.step + delta;
    if (step < 0) fail('This is the first step');
    if (step >= DEMO_STEPS.length) fail('That was the last step');
    this.s.demo.step = step;
    this.changed();
  }

  extendSubmit() {
    if (this.s.phase !== 'submit') fail('Submissions are not open');
    this.s.submitEndsAt = Math.max(this.s.submitEndsAt ?? 0, this.now()) + 60_000;
    this.changed();
  }

  extendReact() {
    if (this.s.phase !== 'react') fail('Reactions are not open');
    this.s.reactEndsAt = Math.max(this.s.reactEndsAt ?? 0, this.now()) + 60_000;
    this.changed();
  }

  // The facilitator's one tap at the start of the talk. A second is a no-op.
  startTalk() {
    if (this.s.talk.startedAt !== null) return;
    this.s.talk.startedAt = this.now();
    this.changed();
  }

  setNudges(on) {
    this.s.nudgesOn = !!on;
    this.changed();
  }

  // ---- submissions ------------------------------------------------------

  submitCards(cid, texts) {
    if (this.s.phase !== 'submit') fail('Submissions are closed');
    const client = this.client(cid);
    if (!Array.isArray(texts) || texts.length === 0) fail('Nothing to submit');
    const clean = texts.map((t) => (typeof t === 'string' ? t.trim() : ''));
    if (clean.some((t) => t.length === 0 || t.length > LIMITS.cardMax)) fail(`Cards are 1 to ${LIMITS.cardMax} characters`);
    if (client.cards + clean.length > LIMITS.cardsPerPerson) fail(`Up to ${LIMITS.cardsPerPerson} cards each`);
    for (const text of clean) {
      this.addCard(text);
    }
    client.cards += clean.length;
    this.changed();
    this.scheduleNudge();
  }

  // A card with a random id, kept in id order rather than arrival order, so
  // neither the database nor the shredder's sheets show which cards one phone
  // sent together.
  addCard(text) {
    let id;
    do id = randomInt(1, 2 ** 31);
    while (this.card(id));
    this.s.cards.push({ id, text, hidden: false });
    this.s.cards.sort((a, b) => a.id - b.id);
    return id;
  }

  hideCard(id, hidden) {
    const card = this.card(id);
    if (!card) fail('No such card');
    card.hidden = !!hidden;
    // A card hidden before clustering was never grouped (or sent to the AI).
    // If it is shown again later, give it a group of its own. While people are
    // still submitting, it waits to be placed with the other late cards instead.
    if (!card.hidden && this.s.phase !== 'submit' && this.s.themes.length && !this.grouped().has(id)) {
      this.otherTheme().groups.push({ id: this.newId(), cardIds: [id] });
    }
    this.changed();
    if (this.s.phase === 'submit') this.scheduleNudge();
  }

  // ---- nudges -----------------------------------------------------------

  // Re-picks the nudge once submissions have been quiet for a moment.
  scheduleNudge() {
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => this.pickNudge(), this.nudgeQuietMs);
    this.nudgeTimer.unref?.();
  }

  async pickNudge() {
    if (this.s.phase !== 'submit' || this.shredded) return;
    const cards = this.s.cards.filter((c) => !c.hidden).map(({ id, text }) => ({ id, text }));
    let nudge = { mode: 'all', label: null };
    if (cards.length >= MIN_CARDS && this.tagCards) {
      try {
        const label = leastCovered(await this.tagCards(cards.sort((a, b) => a.id - b.id)));
        nudge = label ? { mode: 'one', label } : { mode: 'none', label: null };
      } catch {
        return; // keep the current nudge
      }
    }
    if (this.shredded || this.s.phase !== 'submit') return;
    this.s.nudge = nudge;
    this.changed();
  }

  nudgeTexts() {
    const n = this.s.nudge;
    if (!this.s.nudgesOn || n.mode === 'none') return null;
    if (n.mode === 'one') return [NUDGES.find((x) => x.label === n.label).text];
    return NUDGES.map((x) => x.text);
  }

  // ---- clustering -------------------------------------------------------
  //
  // The full grouping starts at the 1-minute warning on the cards so far, so
  // the facilitator can read and approve themes while people finish (or on
  // entering grouping, if it never ran). Cards that come in after it are
  // placed by one quick call on entering grouping, keeping the themes already
  // read; if the call flags them, the facilitator keeps the themes or
  // regroups. Each call carries a run number: a result from a run that has
  // since been replaced (skipped, regrouped, shredded) is ignored.

  // Visible cards, as sent to the AI: id and text only. Hidden cards never are.
  visibleCards() {
    return this.s.cards
      .filter((c) => !c.hidden)
      .map(({ id, text }) => ({ id, text }))
      .sort((a, b) => a.id - b.id);
  }

  grouped() {
    return new Set(this.s.themes.flatMap((t) => t.groups.flatMap((g) => g.cardIds)));
  }

  // Visible cards without a group: the late arrivals the quick call places.
  ungroupedCards() {
    const grouped = this.grouped();
    return this.visibleCards().filter((c) => !grouped.has(c.id));
  }

  otherTheme() {
    let other = this.s.themes.find((t) => t.name === 'Other');
    if (!other) this.s.themes.push((other = { id: this.newId(), name: 'Other', haiku: '', approved: false, groups: [] }));
    return other;
  }

  // Every card a placement covers: placed, flagged, or both.
  lateIds(late) {
    return [...new Set([...late.placements.map((p) => p.cardId), ...late.flags.flatMap((f) => f.cardIds)])];
  }

  // On entering grouping, and whenever a call lands there: wait for a call
  // still running; group everything if there are no themes; place the cards
  // without a group; otherwise keep everything as it is. Coming back to
  // grouping never regroups: that would give every group a new id, cutting
  // reactions off from their cards and losing approved names.
  continueGrouping() {
    const c = this.s.clustering;
    if (c.status === 'running' || c.late?.status === 'running') return;
    if (!this.s.themes.length) return this.startClustering();
    const late = this.ungroupedCards();
    if (!late.length) return;
    // The grouping fell back to one card per group (failed, skipped, or no
    // AI): the late cards join that theme the same way, at once, with no
    // quick call. Retry is the way back to the AI.
    if (c.status === 'failed' || c.local) {
      const placements = late.map((card) => ({ cardId: card.id, themeId: this.s.themes[0].id, groupId: null }));
      c.late = { status: 'done', placements, flags: [] };
      this.placeLate(c.late);
      return;
    }
    // Flagged with nothing new since: the facilitator is choosing.
    if (c.late?.status === 'flagged') {
      const waiting = new Set(this.lateIds(c.late));
      if (late.every((card) => waiting.has(card.id))) return;
    }
    this.startPlacement(late);
  }

  // The full grouping, at high effort, of every visible card. Names, haiku
  // and approvals start over.
  startClustering() {
    const input = this.visibleCards();
    const ids = input.map((x) => x.id);
    const key = ids.join(',');
    const run = ++this.clusterRun;
    const { early } = this.s.clustering;
    if (input.length === 0) {
      this.s.themes = [];
      this.s.clustering = { status: 'done', error: null, key, local: false, early, late: null, empty: true };
      return;
    }
    this.s.clustering = { status: 'running', error: null, key, local: false, early, late: null };
    Promise.resolve()
      .then(() => this.clusterCards(input, { effort: 'high' }))
      .then(
        (result) => ({ themes: normalizeClusters(result.themes, ids), status: 'done', error: null, local: !!result.local }),
        (err) => fallbackClusters(ids, String(err?.message ?? err).slice(0, 200)),
      )
      .then((result) => this.applyClusters(run, key, result));
  }

  applyClusters(run, key, { themes, status, error, local }) {
    if (run !== this.clusterRun || this.shredded) return;
    this.s.themes = themes.map((t) => ({
      id: this.newId(),
      name: t.name,
      haiku: t.haiku ?? '',
      approved: false,
      groups: t.groups.map((cardIds) => ({ id: this.newId(), cardIds })),
    }));
    this.s.clustering = { status, error, key, local, early: this.s.clustering.early, late: null };
    // Cards that came in while it ran (after the warning) are placed now.
    if (this.s.phase === 'cluster') this.continueGrouping();
    this.changed();
  }

  // The quick call: the themes and their groups as they stand (visible cards
  // only), and the late cards.
  startPlacement(late) {
    const themes = this.s.themes
      .map((t) => ({
        id: t.id,
        name: t.name,
        haiku: t.haiku,
        groups: t.groups
          .map((g) => ({ id: g.id, texts: this.visibleCardIds(g).map((id) => this.card(id).text) }))
          .filter((g) => g.texts.length > 0),
      }))
      .filter((t) => t.groups.length > 0);
    // Nothing left to place them next to: group everything instead.
    if (!themes.length) return this.startClustering();
    const run = ++this.clusterRun;
    this.s.clustering.late = { status: 'running', placements: [], flags: [] };
    const lateIds = late.map((c) => c.id);
    const scope = { themeIds: themes.map((t) => t.id), groupIds: themes.flatMap((t) => t.groups.map((g) => [g.id, t.id])), lateIds };
    Promise.resolve()
      .then(() => this.placeLateCards({ themes, late }))
      .then((raw) => normalizePlacements(raw, scope))
      .catch((err) => failedPlacement(lateIds, String(err?.message ?? err).slice(0, 200)))
      .then((result) => this.applyPlacement(run, result));
  }

  // Nothing flagged: placed at once, names, haiku and approvals kept.
  // Anything flagged: held until the facilitator keeps or regroups.
  applyPlacement(run, { placements, flags }) {
    if (run !== this.clusterRun || this.shredded) return;
    const late = { status: flags.length ? 'flagged' : 'done', placements, flags };
    if (!flags.length) this.placeLate(late);
    this.s.clustering.late = late;
    if (this.s.phase === 'cluster') this.continueGrouping();
    this.changed();
  }

  // Each late card where the call suggested (flagged ones too: the model
  // still placed them); one with no valid placement goes to "Other".
  placeLate(late) {
    const grouped = this.grouped();
    const where = new Map(late.placements.map((p) => [p.cardId, p]));
    for (const id of this.lateIds(late)) {
      if (grouped.has(id) || !this.card(id)) continue;
      const p = where.get(id);
      const theme = p && this.s.themes.find((t) => t.id === p.themeId);
      const group = theme && p.groupId !== null ? theme.groups.find((g) => g.id === p.groupId) : null;
      if (group) group.cardIds.push(id);
      else (theme ?? this.otherTheme()).groups.push({ id: this.newId(), cardIds: [id] });
      grouped.add(id);
    }
  }

  keepLate() {
    const late = this.s.clustering.late;
    if (late?.status !== 'flagged') fail('No late arrivals are waiting');
    this.placeLate(late);
    late.status = 'done';
    if (this.s.phase === 'cluster') this.continueGrouping();
    this.changed();
  }

  regroupAll() {
    if (this.s.clustering.late?.status !== 'flagged') fail('No late arrivals are waiting');
    this.startClustering();
    this.changed();
  }

  // While the AI is grouping, the facilitator can stop waiting: every card
  // becomes its own group in one theme, exactly as when grouping fails, and
  // Retry runs the AI again. Skipping the quick call flags the late cards,
  // as if it had failed.
  skipClustering() {
    const c = this.s.clustering;
    if (this.s.phase !== 'cluster' || (c.status !== 'running' && c.late?.status !== 'running')) fail('Grouping is not running');
    const run = ++this.clusterRun;
    if (c.status === 'running') return this.applyClusters(run, c.key, fallbackClusters(this.visibleCards().map((x) => x.id), SKIPPED));
    this.applyPlacement(run, failedPlacement(this.ungroupedCards().map((x) => x.id), SKIPPED));
  }

  recluster() {
    if (this.s.phase !== 'cluster') fail('Clustering runs in the cluster phase');
    this.startClustering();
    this.changed();
  }

  // names: { themeId: name } and haikus: { themeId: haiku } for what was typed
  // but not yet approved. A typed haiku replaces the stored one ('' clears it).
  approveAll(names = {}, haikus = {}) {
    const typed = new Map();
    for (const theme of this.s.themes) {
      const raw = haikus?.[theme.id];
      if (raw === undefined) continue;
      typed.set(theme.id, this.typedHaiku(raw));
    }
    let missing = 0;
    for (const theme of this.s.themes) {
      if (typed.has(theme.id)) theme.haiku = typed.get(theme.id);
      const raw = names?.[theme.id] ?? theme.name;
      const clean = typeof raw === 'string' ? raw.trim().slice(0, LIMITS.themeName) : '';
      if (!clean) {
        missing += 1;
        continue;
      }
      theme.name = clean;
      theme.approved = true;
    }
    this.changed();
    if (missing) fail(`${missing} ${missing === 1 ? 'theme needs' : 'themes need'} a name first`);
  }

  approveTheme(id, name, haiku) {
    const theme = this.s.themes.find((t) => t.id === id);
    if (!theme) fail('No such theme');
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean || clean.length > LIMITS.themeName) fail(`Theme names are 1 to ${LIMITS.themeName} characters`);
    const typed = haiku === undefined ? theme.haiku : this.typedHaiku(haiku);
    theme.name = clean;
    theme.haiku = typed;
    theme.approved = true;
    this.changed();
  }

  // A haiku the facilitator typed: joined onto one line, empty to clear it,
  // refused (not silently dropped) when too long.
  typedHaiku(raw) {
    if (typeof raw !== 'string') return '';
    const clean = oneLine(raw);
    if (clean.length > LIMITS.haiku) fail(`Haiku are up to ${LIMITS.haiku} characters`);
    return clean;
  }

  // ---- reactions --------------------------------------------------------

  // A phone's reactions to one card. The first send returns a random receipt;
  // sending again with it replaces those reactions, so a phone can go back and
  // change its mind. The receipt is tied to that one card's reactions, never
  // to the phone, so reactions stay unlinkable across cards.
  // The optional comment travels with the reactions and is replaced with them.
  react(cid, groupId, emojis, receipt, comment) {
    const graceLeft = this.s.phase === 'walk' && this.s.reactClosedAt !== null && this.now() - this.s.reactClosedAt <= REACT_GRACE_MS;
    if (this.s.phase !== 'react' && !graceLeft) fail('Reactions are closed');
    const client = this.client(cid);
    const found = this.findGroup(groupId);
    if (!found || this.visibleCardIds(found.group).length === 0) fail('No such card');
    if (!Array.isArray(emojis) || emojis.length > LIMITS.emojisPerCard) fail('Too many emojis');
    const unique = [...new Set(emojis)];
    if (!unique.every(isSingleEmoji)) fail('Reactions are emojis only');
    const text = typeof comment === 'string' ? comment.trim() : '';
    if (text.length > LIMITS.commentMax) fail(`Comments are up to ${LIMITS.commentMax} characters`);
    const resend = receipt !== undefined && receipt !== null;
    // Clearing a card with its receipt is fine; a first send needs something.
    if (!resend && unique.length === 0 && !text) fail('Pick an emoji or write a comment');
    if (resend) {
      if (typeof receipt !== 'string' || this.s.receipts[receipt] !== groupId) fail('Nothing to change');
      this.s.reactions = this.s.reactions.filter((r) => r.r !== receipt);
      this.s.comments = this.s.comments.filter((c) => c.r !== receipt);
    } else {
      if (client.reacted >= this.visibleGroups().length) fail('You have reacted to every card');
      client.reacted += 1;
      receipt = randomBytes(8).toString('hex');
      this.s.receipts[receipt] = groupId;
    }
    for (const e of unique) this.s.reactions.push({ g: groupId, e, r: receipt });
    if (text && !this.s.removedComments[receipt]) this.s.comments.push({ id: this.newId(), g: groupId, text, r: receipt });
    this.changed();
    return { receipt };
  }

  reactDone(cid) {
    if (this.s.phase !== 'react') fail('Reactions are closed');
    this.client(cid).reactDone = true;
    this.changed();
  }

  // ---- walk-through -----------------------------------------------------

  buildWalk() {
    const themes = this.s.themes.map((t) => ({
      id: t.id,
      groups: t.groups.map((g) => ({ id: g.id, cardCount: this.visibleCardIds(g).length })).filter((g) => g.cardCount > 0),
    }));
    const now = this.now();
    this.s.walk = {
      // The walk-through opens on an overview of what came up, so the room
      // can take in the whole before the first card, and closes on a last
      // slide that invites the room to speak out loud.
      stream: [{ groupId: OVERVIEW, overview: true }, ...buildStream(themes, this.reactionCounts()), { groupId: LAST, last: true }],
      index: 0,
      cardStartedAt: now,
      cardEndsAt: null,
      endsAt: walkEndsAt(this.s.talk, now),
      paused: false,
      done: false,
      signals: emptySignals(),
    };
    this.s.walk.cardEndsAt = now + cardMs(this.s.walk, now);
  }

  // Shows another card and starts its clock. A paused walk holds the new card too.
  showCard(index) {
    const w = this.s.walk;
    const now = this.now();
    w.index = index;
    w.cardStartedAt = now;
    w.cardEndsAt = w.paused ? null : now + (w.stream[index].last ? LAST_SLIDE_MS : cardMs(w, now));
    w.signals = emptySignals();
  }

  // `from` is the card the facilitator's screen showed when they tapped; if
  // the walk-through has moved on, the tap is ignored (a double-tapped Next).
  moveCard(delta, { from } = {}) {
    if (this.s.phase !== 'walk') fail('Cards move in the walk-through');
    const w = this.s.walk;
    if (from !== undefined && from !== null && from !== w.index) fail('Already moved on');
    const last = w.stream.length - 1;
    if (delta > 0 && w.index === last) {
      if (w.done) fail('That was the last card');
      w.done = true;
      w.cardEndsAt = null;
    } else if (delta < 0 && w.done) {
      w.done = false;
      this.showCard(w.index);
    } else {
      const index = w.index + delta;
      if (index < 0) fail('This is the first card');
      this.showCard(index);
      // After the walk-through's time is up, a Back or Next onto a real card
      // holds it until the facilitator resumes; otherwise the next tick would
      // snap straight back to the last slide. The last slide runs normally.
      if (!w.stream[index].last && this.now() >= w.endsAt - LAST_SLIDE_MS) {
        w.paused = true;
        w.cardEndsAt = null;
      } else if (w.stream[index].last && w.paused) {
        w.paused = false;
        this.showCard(index);
      }
    }
    this.changed();
  }

  // Pausing holds the card; resuming gives it a fresh share. The finish time never moves.
  pauseWalk(paused) {
    if (this.s.phase !== 'walk') fail('Not in the walk-through');
    const w = this.s.walk;
    if (typeof paused !== 'boolean') fail('Pause or resume');
    if (paused === w.paused) return;
    w.paused = paused;
    if (paused) w.cardEndsAt = null;
    else if (!w.done) {
      const now = this.now();
      w.cardEndsAt = now + (w.stream[w.index].last ? LAST_SLIDE_MS : cardMs(w, now));
      w.cardStartedAt = now;
    }
    this.changed();
  }

  signal(cid, kind, on) {
    if (this.s.phase !== 'walk') fail('Not in the walk-through');
    if (!['stay', 'back'].includes(kind)) fail('Unknown signal');
    this.client(cid);
    if (on) this.s.walk.signals[kind][cid] = 1;
    else delete this.s.walk.signals[kind][cid];
    this.changed();
  }

  // ---- comments ---------------------------------------------------------

  removeComment(id) {
    const i = this.s.comments.findIndex((c) => c.id === id);
    if (i < 0) fail('No such comment');
    // Remember the receipt (not the phone) so a resend can't bring it back.
    this.s.removedComments[this.s.comments[i].r] = 1;
    this.s.comments.splice(i, 1);
    this.changed();
  }

  // Called every second by the server. Each timed part has its own check;
  // anything that isn't running does nothing.
  tick() {
    if (this.shredded) return;
    if (this.s.phase === 'submit') this.tickSubmit();
    if (this.s.phase === 'walk') this.tickWalk();
  }

  // At the 1-minute warning, group the cards so far, once per session.
  tickSubmit() {
    if (!earlyGroupingDue(this.s, this.now())) return;
    this.s.clustering.early = true;
    this.startClustering();
    this.changed();
  }

  tickWalk() {
    const w = this.s.walk;
    if (w.paused || w.done) return;
    const now = this.now();
    const last = w.stream.length - 1;
    if (w.index < last && now >= w.endsAt - LAST_SLIDE_MS) this.moveTo(last);
    else if (w.cardEndsAt !== null && now >= w.cardEndsAt) this.moveCard(1);
  }

  moveTo(index) {
    this.showCard(index);
    this.changed();
  }

  // ---- shred ------------------------------------------------------------

  shred() {
    if (this.shredded) fail('Already shredded');
    const cards = this.s.cards.filter((c) => !c.hidden).map((c) => c.text);
    // Kept in memory only, just long enough for the projector's animation.
    this.shredPayload = { emojis: this.emojiMix(), cards };
    this.clusterRun += 1;
    clearTimeout(this.nudgeTimer);
    this.shredded = true;
    this.state = { sessionId: this.s.sessionId, phase: 'shred', phaseStartedAt: this.now(), shredded: true, walk: { stream: [], index: 0 } };
    this.onShred();
    // Once the animation and a beat of black are over, drop the payload and
    // move everyone on to the closing screen.
    const ms = this.shredAnimationMs ?? shredTimeline(this.shredPayload).closingAt;
    this.closingTimer = setTimeout(() => {
      this.shredPayload = null;
      if (this.s.phase === 'shred') this.enter('closing', 'forward');
      this.changed();
    }, ms);
    this.closingTimer.unref?.();
    this.changed();
  }

  // After the shred, start over for another session. Only allowed once
  // everything is already shredded, so it can never delete anything.
  reset() {
    if (!this.shredded) fail('Shred first: a new session starts only after the shred');
    clearTimeout(this.closingTimer);
    this.shredPayload = null;
    this.shredded = false;
    this.state = freshState(this.now(), this.talkMinutes);
    this.onReset();
    this.changed();
  }

  // ---- views: what each screen is allowed to see -------------------------

  view(role, { cid, phoneCount = 0 } = {}) {
    if (role === 'facilitator') return this.facilitatorView({ phoneCount });
    if (role === 'projector') return this.projectorView({ phoneCount });
    return this.phoneView(cid);
  }

  phoneView(cid) {
    const s = this.s;
    const v = { role: 'phone', session: s.sessionId, phase: s.phase, now: this.now() };
    if (this.shredded) return v;
    const c = typeof cid === 'string' ? s.clients[cid] : undefined;
    if (s.phase === 'submit') {
      const texts = this.nudgeTexts();
      v.submit = {
        endsAt: s.submitEndsAt,
        submitted: c?.cards ?? 0,
        max: LIMITS.cardsPerPerson,
        nudgesOn: s.nudgesOn,
        nudge: texts && { texts },
      };
    }
    if (s.phase === 'react') {
      v.react = {
        groups: this.visibleGroups().map((g) => ({ id: g.id, texts: this.visibleCardIds(g).map((id) => this.card(id).text) })),
        done: !!c?.reactDone,
        endsAt: s.reactEndsAt,
      };
    }
    if (s.phase === 'walk') {
      v.walk = {
        cardKey: `${s.walk.index}:${this.currentItem()?.groupId ?? ''}`,
        mine: {
          stay: !!s.walk.signals?.stay?.[cid],
          back: !!s.walk.signals?.back?.[cid],
        },
      };
    }
    return v;
  }

  // Every comment on a card, in an order that is the same on every screen and
  // every refresh but says nothing about when each was sent.
  allCommentsFor(groupId) {
    const order = (id) => createHash('sha256').update(`${this.s.sessionId}:${id}`).digest('hex');
    return this.s.comments
      .filter((c) => c.g === groupId)
      .map(({ id, text }) => ({ id, text }))
      .sort((a, b) => (order(a.id) < order(b.id) ? -1 : 1));
  }

  commentsFor(groupId) {
    const all = this.allCommentsFor(groupId);
    return { shown: all.slice(0, COMMENTS_SHOWN), more: Math.max(0, all.length - COMMENTS_SHOWN) };
  }

  // The themes, biggest first, with how many cards and reactions each drew.
  overviewView() {
    const counts = this.reactionCounts();
    return this.s.themes
      .map((t) => {
        const groups = t.groups.filter((g) => this.visibleCardIds(g).length > 0);
        return {
          name: t.approved ? t.name : null,
          cards: groups.reduce((n, g) => n + this.visibleCardIds(g).length, 0),
          reactions: groups.reduce((n, g) => n + (counts.get(g.id) ?? 0), 0),
        };
      })
      .filter((t) => t.cards > 0)
      .sort((a, b) => b.reactions - a.reactions || b.cards - a.cards);
  }

  // Only real cards carry comments; the overview and the last slide have none.
  commentKey(item) {
    return item && !item.last ? item.groupId : null;
  }

  itemView(item) {
    if (!item) return null;
    if (item.last) return { last: true };
    if (item.overview) return { overview: this.overviewView() };
    const found = this.findGroup(item.groupId);
    const text = this.groupText(item.groupId);
    if (!found || !text) return { hidden: true };
    const { theme } = found;
    return {
      text,
      similar: Math.max(0, this.visibleCardIds(found.group).length - 1),
      moreInTheme: item.moreInTheme,
      theme: theme.approved ? theme.name : null,
      ...(theme.approved && theme.haiku ? { haiku: theme.haiku } : {}),
      mix: this.emojiMix(item.groupId),
    };
  }

  projectorView({ phoneCount }) {
    const s = this.s;
    const v = { role: 'projector', phase: s.phase, now: this.now(), phaseStartedAt: s.phaseStartedAt };
    if (s.phase === 'shred') v.shred = this.shredPayload;
    if (this.shredded) return v;
    if (s.phase === 'demo' && this.demo) v.demo = { step: s.demo.step, ...this.demo };
    if (s.phase === 'join') v.phones = phoneCount;
    // How long this part of the session is planned to take, as a hint the
    // room can see. Only while there's time left: a visible "over" would
    // make people hold back.
    const sectionEnd =
      s.phase === 'submit'
        ? s.submitEndsAt
        : s.phase === 'react'
          ? s.reactEndsAt
          : s.phase === 'walk'
            ? s.walk.endsAt
            : null;
    if (sectionEnd) v.section = { endsAt: sectionEnd };
    // The room is told the app is waiting on the facilitator, never why or
    // how far over anything is.
    v.waiting =
      pendingMove(s, this.now(), { phoneCount }) !== null ||
      (s.phase === 'cluster' && ['done', 'failed'].includes(s.clustering.status) && s.themes.some((t) => !t.approved)) ||
      (s.phase === 'cluster' && s.clustering.late?.status === 'flagged');
    if (s.phase === 'walk') {
      const item = this.currentItem();
      v.walk = {
        index: s.walk.index,
        total: s.walk.stream.length,
        cardStartedAt: s.walk.cardStartedAt,
        cardEndsAt: s.walk.cardEndsAt,
        paused: s.walk.paused,
        item: this.itemView(item),
        comments: this.commentsFor(this.commentKey(item)),
        stay: count(s.walk.signals.stay),
        back: count(s.walk.signals.back),
      };
    }
    if (s.phase === 'finale') v.finale = { sequence: s.reactions.map((r) => r.e) };
    return v;
  }

  facilitatorView({ phoneCount }) {
    const s = this.s;
    const now = this.now();
    const v = {
      role: 'facilitator',
      phase: s.phase,
      now,
      phaseStartedAt: s.phaseStartedAt,
      canBack: !!previousPhase(s.phase),
      prev: previousPhase(s.phase),
      next: nextPhase(s.phase),
      shredded: this.shredded,
      phones: phoneCount,
    };
    if (this.shredded) return v;
    const { startedAt, minutes } = s.talk;
    if (s.phase === 'demo' && this.demo) v.demo = { step: s.demo.step, steps: DEMO_STEPS.length, name: DEMO_STEPS[s.demo.step] };
    v.talk = { startedAt, minutes, leftMs: startedAt === null ? minutes * 60_000 : startedAt + minutes * 60_000 - now };
    v.pace =
      startedAt === null
        ? 0
        : paceMinutes({
            phase: s.phase,
            elapsedMinutes: (now - startedAt) / 60_000,
            walkIndex: s.walk.index,
            walkLength: s.walk.stream.length,
          });
    // Set when a part is over and the facilitator is asked to confirm the move.
    v.move = pendingMove(s, now, { phoneCount: phoneCount });
    v.submit = {
      endsAt: s.submitEndsAt,
      nudgesOn: s.nudgesOn,
      nudge: s.nudge,
      nudgeTexts: this.nudgeTexts(),
      tagging: !!this.tagCards,
      people: Object.values(s.clients).filter((c) => c.cards > 0).length,
    };
    v.cards = [...s.cards].sort((a, b) => a.id - b.id).map(({ id, text, hidden }) => ({ id, text, hidden }));
    // The late cards' flags with their text, for the keep-or-regroup choice
    // (not the suggested placements: those are applied on keep).
    const { late, ...clustering } = s.clustering;
    v.clustering = {
      ...clustering,
      late: late && {
        status: late.status,
        flags: late.flags.map((f) => ({
          cards: f.cardIds.map((id) => this.card(id)).filter(Boolean).map(({ id, text }) => ({ id, text })),
          reason: f.reason,
        })),
      },
    };
    const counts = this.reactionCounts();
    v.themes = s.themes.map((t) => ({
      id: t.id,
      name: t.name,
      haiku: t.haiku,
      approved: t.approved,
      groups: t.groups.map((g) => ({
        id: g.id,
        reactions: counts.get(g.id) ?? 0,
        cards: g.cardIds.map((id) => this.card(id)).filter(Boolean).map(({ id, text, hidden }) => ({ id, text, hidden })),
      })),
    }));
    v.react = {
      done: Object.values(s.clients).filter((c) => c.reactDone).length,
      reactions: s.reactions.length,
      endsAt: s.reactEndsAt,
    };
    const item = this.currentItem();
    const inWalk = s.phase === 'walk';
    v.walk = {
      index: s.walk.index,
      total: s.walk.stream.length,
      // Facilitator only: how many cards are left and each one's share of the time left.
      cardsLeft: inWalk ? cardsLeft(s.walk) : null,
      cardMs: inWalk ? cardMs(s.walk, now) : null,
      cardStartedAt: s.walk.cardStartedAt,
      cardEndsAt: s.walk.cardEndsAt,
      endsAt: s.walk.endsAt,
      paused: s.walk.paused,
      done: s.walk.done,
      stream: s.walk.stream.map((it) =>
        it.overview
          ? { groupId: it.groupId, text: 'Overview: what came up', reactions: s.reactions.length }
          : it.last
            ? { groupId: it.groupId, text: 'Last slide: Anything else? Out loud.', reactions: 0 }
            : { groupId: it.groupId, text: this.groupText(it.groupId), reactions: counts.get(it.groupId) ?? 0 },
      ),
      item: item ? { groupId: item.groupId, ...this.itemView(item) } : null,
      stay: count(s.walk.signals.stay),
      back: count(s.walk.signals.back),
    };
    const upcoming = s.phase === 'walk' ? s.walk.stream[s.walk.index + 1] : null;
    v.comments = {
      current: s.phase === 'walk' ? this.allCommentsFor(this.commentKey(item)) : [],
      next: upcoming && !upcoming.overview && !upcoming.last ? this.allCommentsFor(upcoming.groupId) : [],
    };
    return v;
  }
}
