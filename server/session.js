// All session state and every action on it. No HTTP and no disk here: the
// server persists `session.state` after each change and wires up the shred.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { nextPhase, previousPhase, paceMinutes, PLAN, SUBMIT_MINUTES } from './phases.js';
import { buildStream } from './stream.js';
import { isSingleEmoji } from '../public/shared/emoji.js';
import { NUDGES, MIN_CARDS, leastCovered } from './nudges.js';
import { shredTimeline } from '../public/shared/shred-timing.js';

export const LIMITS = { cardsPerPerson: 3, cardMax: 200, commentMax: 200, emojisPerCard: 12, themeName: 60 };
// The projector shows this many comments on a card, the rest as "+N more".
export const COMMENTS_SHOWN = 5;
const WALK_MS = (PLAN.walk[1] - PLAN.walk[0]) * 60_000;
const OVERVIEW = 'overview';

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

export function freshState(now) {
  return {
    // Random per session. Phones compare it with the one their notes were
    // written in, and wipe notes left over from a session they missed the end of.
    sessionId: randomBytes(8).toString('hex'),
    phase: 'join',
    phaseStartedAt: now,
    clockStart: null,
    submitEndsAt: null,
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
    clustering: { status: 'idle', error: null, key: null, local: false },
    themes: [],
    // Pooled per group, in the order they happened (the finale replays it).
    reactions: [],
    // Receipt -> card, so a phone can change its reactions to that card.
    receipts: {},
    walk: { stream: [], index: 0, cardStartedAt: null, signals: emptySignals() },
    // { id, g, text, r }: no phone id. r is the card's receipt, so sending
    // again replaces the comment along with the reactions.
    comments: [],
    // Receipts whose comment the facilitator removed.
    removedComments: {},
  };
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
    if (groups.length) themes.push({ name: String(t?.name ?? '').trim().slice(0, LIMITS.themeName), groups });
  }
  const missing = cardIds.filter((id) => !seen.has(id));
  if (missing.length) themes.push({ name: 'Other', groups: missing.map((id) => [id]) });
  return themes;
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
    tagCards = null,
    nudgeQuietMs = 10_000,
    onChange = () => {},
    onShred = () => {},
    shredAnimationMs = null, // tests only: overrides the animation's length
    onReset = () => {},
  }) {
    this.now = now;
    this.tagCards = tagCards;
    this.nudgeQuietMs = nudgeQuietMs;
    this.nudgeTimer = null;
    this.clusterCards = clusterCards;
    this.onChange = onChange;
    this.onShred = onShred;
    this.shredAnimationMs = shredAnimationMs;
    this.onReset = onReset;
    this.closingTimer = null;
    this.clusterRun = 0;
    this.shredPayload = null;
    this.state = state ?? freshState(now());
    this.state.nudge ??= { mode: 'all', label: null };
    this.state.receipts ??= {};
    if (!this.state.shredded) this.state.removedComments ??= {};
    this.state.sessionId ??= randomBytes(8).toString('hex');
    this.shredded = !!this.state.shredded;
    // A restart mid-clustering: run it again.
    if (this.state.clustering?.status === 'running') {
      this.state.clustering.status = 'idle';
      if (this.state.phase === 'cluster') this.startClustering(true);
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

  advance({ confirm = false } = {}) {
    const to = nextPhase(this.s.phase);
    if (!to) fail('This is the last phase');
    if (this.s.phase === 'cluster' && this.s.clustering.status === 'running') fail('Clustering is still running');
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
    this.s.phase = to;
    this.s.phaseStartedAt = now;
    if (to === 'submit') {
      this.s.clockStart ??= now - PLAN.submit[0] * 60_000;
      this.s.submitEndsAt =
        direction === 'forward' ? now + SUBMIT_MINUTES * 60_000 : Math.max(this.s.submitEndsAt ?? 0, now + 60_000);
    }
    // The room's section timer starts when a part is entered going forward,
    // so going back (from last call to the walk-through, say) doesn't
    // restart it.
    if ((to === 'react' || to === 'walk') && direction === 'forward') this.s.sectionStartedAt = { ...this.s.sectionStartedAt, [to]: now };
    if (to === 'cluster') this.startClustering(false);
    if (to === 'walk' && direction === 'forward') this.buildWalk();
    if (to === 'walk' && direction === 'back') this.s.walk.cardStartedAt = now;
  }

  extendSubmit() {
    if (this.s.phase !== 'submit') fail('Submissions are not open');
    this.s.submitEndsAt = Math.max(this.s.submitEndsAt ?? 0, this.now()) + 60_000;
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
      let id;
      do id = randomInt(1, 2 ** 31);
      while (this.card(id));
      this.s.cards.push({ id, text, hidden: false });
    }
    // Kept in id order, not the order they arrived, so neither the database
    // nor the shredder's sheets show which cards one phone sent together.
    this.s.cards.sort((a, b) => a.id - b.id);
    client.cards += clean.length;
    this.changed();
    this.scheduleNudge();
  }

  hideCard(id, hidden) {
    const card = this.card(id);
    if (!card) fail('No such card');
    card.hidden = !!hidden;
    // A card hidden before clustering was never grouped (or sent to the AI).
    // If it is shown again later, give it a group of its own.
    if (!card.hidden && this.s.themes.length && !this.s.themes.some((t) => t.groups.some((g) => g.cardIds.includes(id)))) {
      let other = this.s.themes.find((t) => t.name === 'Other');
      if (!other) this.s.themes.push((other = { id: this.newId(), name: 'Other', approved: false, groups: [] }));
      other.groups.push({ id: this.newId(), cardIds: [id] });
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

  startClustering(force) {
    const cards = this.s.cards.filter((c) => !c.hidden);
    const key = cards.map((c) => c.id).sort((a, b) => a - b).join(',');
    const c = this.s.clustering;
    // Coming back to grouping only regroups when there are cards without a
    // group (new submissions). A card hidden since doesn't regroup: that
    // would give every group a new id, cutting reactions off from their
    // cards and losing approved names.
    const grouped = new Set(this.s.themes.flatMap((t) => t.groups.flatMap((g) => g.cardIds)));
    const settled = c.key === key || (this.s.themes.length > 0 && cards.every((card) => grouped.has(card.id)));
    if (!force && settled && (c.status === 'done' || c.status === 'failed')) return;
    const run = ++this.clusterRun;
    if (cards.length === 0) {
      this.s.themes = [];
      this.s.clustering = { status: 'done', error: null, key, local: false, empty: true };
      return;
    }
    this.s.clustering = { status: 'running', error: null, key, local: false };
    const input = cards.map(({ id, text }) => ({ id, text })).sort((a, b) => a.id - b.id);
    const ids = input.map((x) => x.id);
    Promise.resolve()
      .then(() => this.clusterCards(input))
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
      approved: false,
      groups: t.groups.map((cardIds) => ({ id: this.newId(), cardIds })),
    }));
    this.s.clustering = { status, error, key, local };
    this.changed();
  }

  // While the AI is grouping, the facilitator can stop waiting: every card
  // becomes its own group in one theme, exactly as when grouping fails, and
  // Retry runs the AI again.
  skipClustering() {
    if (this.s.phase !== 'cluster' || this.s.clustering.status !== 'running') fail('Grouping is not running');
    const ids = this.s.cards.filter((c) => !c.hidden).map((c) => c.id).sort((a, b) => a - b);
    const run = ++this.clusterRun;
    this.applyClusters(run, this.s.clustering.key, fallbackClusters(ids, SKIPPED));
  }

  recluster() {
    if (this.s.phase !== 'cluster') fail('Clustering runs in the cluster phase');
    this.startClustering(true);
    this.changed();
  }

  // names: { themeId: name } for names typed but not yet approved.
  approveAll(names = {}) {
    let missing = 0;
    for (const theme of this.s.themes) {
      const raw = names[theme.id] ?? theme.name;
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

  approveTheme(id, name) {
    const theme = this.s.themes.find((t) => t.id === id);
    if (!theme) fail('No such theme');
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean || clean.length > LIMITS.themeName) fail(`Theme names are 1 to ${LIMITS.themeName} characters`);
    theme.name = clean;
    theme.approved = true;
    this.changed();
  }

  // ---- reactions --------------------------------------------------------

  // A phone's reactions to one card. The first send returns a random receipt;
  // sending again with it replaces those reactions, so a phone can go back and
  // change its mind. The receipt is tied to that one card's reactions, never
  // to the phone, so reactions stay unlinkable across cards.
  // The optional comment travels with the reactions and is replaced with them.
  react(cid, groupId, emojis, receipt, comment) {
    if (this.s.phase !== 'react') fail('Reactions are closed');
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
    this.s.walk = {
      // The walk-through opens on an overview of what came up, so the room
      // can take it in before the first card.
      stream: [{ groupId: OVERVIEW, overview: true }, ...buildStream(themes, this.reactionCounts())],
      index: 0,
      cardStartedAt: this.now(),
      signals: emptySignals(),
    };
  }

  moveCard(delta) {
    if (this.s.phase !== 'walk') fail('Cards move in the walk-through');
    const w = this.s.walk;
    const index = w.index + delta;
    if (index < 0 || index >= w.stream.length) fail(delta > 0 ? 'That was the last card' : 'This is the first card');
    w.index = index;
    w.cardStartedAt = this.now();
    w.signals = emptySignals();
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

  // Nothing is timed any more, but the server still calls this every second.
  tick() {}

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
    this.state = freshState(this.now());
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
      };
    }
    if (s.phase === 'walk' || s.phase === 'lastcall') {
      v.walk = {
        cardKey: s.phase === 'walk' ? `${s.walk.index}:${this.currentItem()?.groupId ?? ''}` : 'last',
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

  itemView(item) {
    if (!item) return null;
    if (item.overview) return { overview: this.overviewView() };
    const found = this.findGroup(item.groupId);
    const text = this.groupText(item.groupId);
    if (!found || !text) return { hidden: true };
    return {
      text,
      similar: Math.max(0, this.visibleCardIds(found.group).length - 1),
      moreInTheme: item.moreInTheme,
      theme: found.theme.approved ? found.theme.name : null,
      mix: this.emojiMix(item.groupId),
    };
  }

  projectorView({ phoneCount }) {
    const s = this.s;
    const v = { role: 'projector', phase: s.phase, now: this.now(), phaseStartedAt: s.phaseStartedAt };
    if (s.phase === 'shred') v.shred = this.shredPayload;
    if (this.shredded) return v;
    if (s.phase === 'join') v.phones = phoneCount;
    // How long this part of the session is planned to take, as a hint the
    // room can see. Only while there's time left: a visible "over" would
    // make people hold back.
    const sectionEnd =
      s.phase === 'submit'
        ? s.submitEndsAt
        : ['react', 'walk'].includes(s.phase)
          ? (s.sectionStartedAt?.[s.phase] ?? s.phaseStartedAt) + (PLAN[s.phase][1] - PLAN[s.phase][0]) * 60_000
          : null;
    if (sectionEnd) v.section = { endsAt: sectionEnd };
    if (s.phase === 'walk' || s.phase === 'lastcall') {
      const item = this.currentItem();
      v.walk = {
        index: s.walk.index,
        total: s.walk.stream.length,
        cardStartedAt: s.walk.cardStartedAt,
        item: this.itemView(item),
        comments: this.commentsFor(s.phase === 'walk' ? (item?.groupId ?? null) : null),
        stay: s.phase === 'walk' ? count(s.walk.signals.stay) : 0,
        back: s.phase === 'walk' ? count(s.walk.signals.back) : 0,
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
    const elapsedMs = s.clockStart === null ? 0 : now - s.clockStart;
    v.clock = {
      startedAt: s.clockStart,
      elapsedMs,
      pace:
        s.clockStart === null
          ? 0
          : paceMinutes({
              phase: s.phase,
              elapsedMinutes: elapsedMs / 60_000,
              walkIndex: s.walk.index,
              walkLength: s.walk.stream.length,
            }),
    };
    v.submit = {
      endsAt: s.submitEndsAt,
      nudgesOn: s.nudgesOn,
      nudge: s.nudge,
      nudgeTexts: this.nudgeTexts(),
      tagging: !!this.tagCards,
      people: Object.values(s.clients).filter((c) => c.cards > 0).length,
    };
    v.cards = [...s.cards].sort((a, b) => a.id - b.id).map(({ id, text, hidden }) => ({ id, text, hidden }));
    v.clustering = s.clustering;
    const counts = this.reactionCounts();
    v.themes = s.themes.map((t) => ({
      id: t.id,
      name: t.name,
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
    };
    const item = this.currentItem();
    v.walk = {
      index: s.walk.index,
      total: s.walk.stream.length,
      cardStartedAt: s.walk.cardStartedAt,
      // Facilitator only: a rough per-card share of the walk-through's time.
      budgetMs: Math.min(180_000, Math.max(20_000, WALK_MS / Math.max(1, s.walk.stream.length))),
      stream: s.walk.stream.map((it) =>
        it.overview
          ? { groupId: it.groupId, text: 'Overview: what came up', reactions: s.reactions.length }
          : { groupId: it.groupId, text: this.groupText(it.groupId), reactions: counts.get(it.groupId) ?? 0 },
      ),
      item: item ? { groupId: item.groupId, ...this.itemView(item) } : null,
      stay: count(s.walk.signals.stay),
      back: count(s.walk.signals.back),
    };
    const upcoming = s.phase === 'walk' ? s.walk.stream[s.walk.index + 1] : null;
    v.comments = {
      current: s.phase === 'walk' ? this.allCommentsFor(item?.groupId ?? null) : [],
      next: upcoming && !upcoming.overview ? this.allCommentsFor(upcoming.groupId) : [],
    };
    return v;
  }
}
