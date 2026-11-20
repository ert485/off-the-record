// All session state and every action on it. No HTTP and no disk here: the
// server persists `session.state` after each change and wires up the shred.
import { randomInt } from 'node:crypto';
import { nextPhase, previousPhase, paceMinutes, PLAN, SUBMIT_MINUTES } from './phases.js';
import { buildStream } from './stream.js';
import { isSingleEmoji } from '../public/shared/emoji.js';
import { NUDGES, MIN_CARDS, leastCovered } from './nudges.js';
import { shredTimeline } from '../public/shared/shred-timing.js';

export const LIMITS = { cardsPerPerson: 3, cardMax: 200, commentMax: 200, emojisPerCard: 12, themeName: 60 };
// Anonymous pause: ends once everyone who opened the comment box has
// submitted (but not before minMs, so one fast typist can't end it for
// everyone), or at maxMs followed by a grace period for anyone still typing.
export const PAUSE = { minMs: 15_000, maxMs: 90_000, graceMs: 20_000 };
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

const emptySignals = () => ({ stay: {}, moveOn: {}, back: {} });
const count = (obj) => Object.keys(obj ?? {}).length;

export function freshState(now) {
  return {
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
    walk: { stream: [], index: 0, cardStartedAt: null, signals: emptySignals() },
    pauseRequests: {},
    pauseHeld: false,
    pause: null,
    comments: [],
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
    if (typeof cid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(cid)) fail('Missing phone id');
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
    this.s.pause = null;
    this.s.phase = to;
    this.s.phaseStartedAt = now;
    if (to === 'submit') {
      this.s.clockStart ??= now - PLAN.submit[0] * 60_000;
      this.s.submitEndsAt =
        direction === 'forward' ? now + SUBMIT_MINUTES * 60_000 : Math.max(this.s.submitEndsAt ?? 0, now + 60_000);
    }
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
    if (!force && c.key === key && (c.status === 'done' || c.status === 'failed')) return;
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
        (err) => ({
          themes: normalizeClusters([], ids).map((t) => ({ ...t, name: '' })),
          status: 'failed',
          error: String(err?.message ?? err).slice(0, 200),
          local: true,
        }),
      )
      .then(({ themes, status, error, local }) => {
        if (run !== this.clusterRun || this.shredded) return;
        this.s.themes = themes.map((t) => ({
          id: this.newId(),
          name: t.name,
          approved: false,
          groups: t.groups.map((cardIds) => ({ id: this.newId(), cardIds })),
        }));
        this.s.clustering = { status, error, key, local };
        this.changed();
      });
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

  react(cid, groupId, emojis) {
    if (this.s.phase !== 'react') fail('Reactions are closed');
    const client = this.client(cid);
    const found = this.findGroup(groupId);
    if (!found || this.visibleCardIds(found.group).length === 0) fail('No such card');
    if (!Array.isArray(emojis) || emojis.length > LIMITS.emojisPerCard) fail('Too many emojis');
    const unique = [...new Set(emojis)];
    if (!unique.every(isSingleEmoji)) fail('Reactions are emojis only');
    if (client.reacted >= this.visibleGroups().length) fail('You have reacted to every card');
    client.reacted += 1;
    for (const e of unique) this.s.reactions.push({ g: groupId, e });
    this.changed();
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
    this.s.pause = null;
    this.changed();
  }

  signal(cid, kind, on) {
    if (this.s.phase !== 'walk') fail('Not in the walk-through');
    if (!['stay', 'moveOn', 'back'].includes(kind)) fail('Unknown signal');
    this.client(cid);
    if (on) this.s.walk.signals[kind][cid] = 1;
    else delete this.s.walk.signals[kind][cid];
    this.changed();
  }

  // ---- anonymous pauses -------------------------------------------------

  requestPause(cid, on) {
    if (!['walk', 'lastcall'].includes(this.s.phase)) fail('Pauses happen in the walk-through');
    this.client(cid);
    if (on) this.s.pauseRequests[cid] = 1;
    else delete this.s.pauseRequests[cid];
    if (!count(this.s.pauseRequests)) this.s.pauseHeld = false;
    this.changed();
  }

  acceptPause() {
    if (!['walk', 'lastcall'].includes(this.s.phase)) fail('Pauses happen in the walk-through');
    if (this.s.pause) fail('A pause is already running');
    this.s.pause = {
      about: this.currentItem()?.groupId ?? null,
      startedAt: this.now(),
      graceAt: null,
      opened: {},
      submitted: {},
    };
    this.s.pauseRequests = {};
    this.s.pauseHeld = false;
    this.changed();
  }

  holdPause() {
    this.s.pauseHeld = true;
    this.changed();
  }

  endPause() {
    this.s.pause = null;
    this.changed();
  }

  openComment(cid) {
    const p = this.s.pause;
    if (!p) fail('No pause is running');
    this.client(cid);
    if (p.graceAt !== null && !p.opened[cid]) fail('The pause is ending');
    p.opened[cid] = 1;
    this.changed();
  }

  cancelComment(cid) {
    const p = this.s.pause;
    if (!p) return;
    delete p.opened[cid];
    this.checkPause();
    this.changed();
  }

  submitComment(cid, text) {
    const p = this.s.pause;
    if (!p) fail('No pause is running');
    this.client(cid);
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean || clean.length > LIMITS.commentMax) fail(`Comments are 1 to ${LIMITS.commentMax} characters`);
    if (p.submitted[cid]) fail('One comment per pause');
    if (p.graceAt !== null && !p.opened[cid]) fail('The pause is ending');
    p.opened[cid] = 1;
    p.submitted[cid] = 1;
    this.s.comments.push({ id: this.newId(), g: p.about, text: clean });
    this.checkPause();
    this.changed();
  }

  removeComment(id) {
    const i = this.s.comments.findIndex((c) => c.id === id);
    if (i < 0) fail('No such comment');
    this.s.comments.splice(i, 1);
    this.changed();
  }

  // Returns true when the pause state changed.
  checkPause() {
    const p = this.s.pause;
    if (!p) return false;
    const now = this.now();
    const opened = Object.keys(p.opened);
    const pending = opened.filter((c) => !p.submitted[c]).length;
    if (p.graceAt === null) {
      if (opened.length > 0 && pending === 0 && now - p.startedAt >= PAUSE.minMs) {
        this.s.pause = null;
        return true;
      }
      if (now - p.startedAt >= PAUSE.maxMs) {
        if (pending > 0) p.graceAt = now;
        else this.s.pause = null;
        return true;
      }
    } else if (pending === 0 || now - p.graceAt >= PAUSE.graceMs) {
      this.s.pause = null;
      return true;
    }
    return false;
  }

  tick() {
    if (this.checkPause()) this.changed();
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
    this.state = { phase: 'shred', phaseStartedAt: this.now(), shredded: true, walk: { stream: [], index: 0 } };
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

  pauseView(cid) {
    const p = this.s.pause;
    if (!p) return null;
    return {
      about: p.about,
      text: p.about ? this.groupText(p.about) : null,
      startedAt: p.startedAt,
      endsAt: p.startedAt + PAUSE.maxMs,
      graceEndsAt: p.graceAt === null ? null : p.graceAt + PAUSE.graceMs,
      ...(cid !== undefined && { opened: !!p.opened[cid], submitted: !!p.submitted[cid] }),
      ...(cid === undefined && { openedCount: count(p.opened), submittedCount: count(p.submitted) }),
    };
  }

  phoneView(cid) {
    const s = this.s;
    const v = { role: 'phone', phase: s.phase, now: this.now() };
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
          moveOn: !!s.walk.signals?.moveOn?.[cid],
          back: !!s.walk.signals?.back?.[cid],
          pause: !!s.pauseRequests[cid],
        },
        pause: this.pauseView(cid ?? ''),
      };
    }
    return v;
  }

  commentsFor(groupId) {
    return this.s.comments.filter((c) => c.g === groupId).map(({ id, text }) => ({ id, text }));
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
          ? s.phaseStartedAt + (PLAN[s.phase][1] - PLAN[s.phase][0]) * 60_000
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
        pauseRequests: count(s.pauseRequests),
        pauseHeld: s.pauseHeld,
        pause: this.pauseView(),
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
      moveOn: count(s.walk.signals.moveOn),
      back: count(s.walk.signals.back),
    };
    v.pauseRequests = count(s.pauseRequests);
    v.pauseHeld = s.pauseHeld;
    v.pause = this.pauseView();
    v.comments = this.commentsFor(s.phase === 'walk' ? (item?.groupId ?? null) : s.phase === 'lastcall' ? null : undefined);
    return v;
  }
}
