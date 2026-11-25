// All session state and every action on it. No HTTP and no disk here: the
// server persists `session.state` after each change and wires up the shred.
import { randomBytes, randomInt } from 'node:crypto';
import { PHASES, nextPhase, previousPhase, paceMinutes, PLAN, SUBMIT_MINUTES, REACT_MINUTES, REACT_GRACE_MS, TALK_MINUTES, LAST_SLIDE_MS, WRITING_WINDOW_MS, HARSHNESS_QUIET_MS, HARSHNESS_MAX_WAIT_MS, HARSHNESS_BATCH } from './phases.js';
import { pendingMove, walkEndsAt, cardMs, cardsLeft, earlyGroupingDue, spedUp, SPEED_UP, lastSlideMs, deckTimeSize } from './flow.js';
import { localPlacer } from './cluster.js';
import { buildStream } from './stream.js';
import { isSingleEmoji } from '../public/shared/emoji.js';
import { NUDGES, MIN_CARDS, leastCovered } from './nudges.js';
import { shredTimeline } from '../public/shared/shred-timing.js';
import { DEMO_STEPS, DEMO_STEP_MS, DEFAULT_TEASER } from './demo.js';

export const LIMITS = { cardsPerPerson: 3, cardMax: 200, afterthoughtMax: 200, emojisPerCard: 22, themeName: 60, haiku: 120 };
const OVERVIEW = 'overview';
const LAST = 'last';
// What an afterthought's receipt maps to (a card's receipt maps to its group id).
const AFTERTHOUGHT = 'afterthought';

// The parts where phones can share cards: the notepad opens at Join, and the
// 5-minute timer (and everything timed by it) starts at Submit.
const SHARING_PHASES = ['join', 'submit'];
// The parts where a phone's typing is counted (wherever its notepad is open),
// and the parts whose screens show that count.
const TYPING_PHASES = ['join', 'submit', 'react'];
const WRITING_SHOWN = ['submit', 'react'];

export class ActionError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}
const fail = (message) => {
  throw new ActionError(message);
};

export function freshState(now, talkMinutes = TALK_MINUTES) {
  return {
    // Random per session. Phones compare it with the one their notes were
    // written in, and wipe notes left over from a session they missed the end of.
    sessionId: randomBytes(8).toString('hex'),
    phase: 'teaser',
    phaseStartedAt: now,
    // Which step of the demo the projector shows, whether it plays on its own
    // (and since when), and the cards the demo added (null until it has).
    demo: { step: 0, cardIds: null, auto: false, stepStartedAt: now },
    // The talk clock: starts with one tap, or backdated when the room moves
    // on without it, and never restarts.
    talk: { startedAt: null, minutes: talkMinutes },
    submitEndsAt: null,
    reactEndsAt: null,
    // When the room moved on from reacting, for the 10-second grace.
    reactClosedAt: null,
    // How many cards fit the reaction window, set when reactions start. Each
    // phone's deck is this many, or every visible card when there are fewer.
    deckSize: null,
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
    // Receipt -> card (or AFTERTHOUGHT), so a phone can change its reactions
    // to that card, or its thought.
    receipts: {},
    // Receipt -> card id, so a phone can take back a card it shared while
    // sharing is open. Random, never tied to a phone, never in any view.
    cardReceipts: {},
    // held: the timer stopped before an item nobody has reviewed (a pause);
    // holdTo: the stream index it was moving to.
    walk: { stream: [], index: 0, cardStartedAt: null, cardEndsAt: null, endsAt: null, lastMs: LAST_SLIDE_MS, paused: false, done: false, held: false, holdTo: null },
    // The one thought each phone may add at the end of its deck, shown on the
    // last slide. { id, text, r }: no phone id. r is its receipt, so sending
    // again with it replaces the text. Cards and thoughts also carry, for the
    // facilitator only, harsh ({ level, reason } from the harshness check) and
    // reviewed (the facilitator has looked at it).
    afterthoughts: [],
    // Receipts whose thought the facilitator removed.
    removedAfterthoughts: {},
  };
}

// A theme's haiku as one line: newlines become " / ". Not text, or too long to
// show whole, means none (a cut haiku reads broken; the facilitator can write one).
const oneLine = (raw) => raw.trim().replace(/\s*[\r\n]+\s*/g, ' / ').replace(/ {2,}/g, ' ');
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

// How harsh an item reads, for sorting: harsh, edgy, not checked, fine.
const harshRank = (item) => (item.harsh ? [0, 2, 3][item.harsh.level] : 1);
// Unreviewed first, then harshest first, then in id order.
const byReview = (a, b) => (a.reviewed ? 1 : 0) - (b.reviewed ? 1 : 0) || harshRank(b) - harshRank(a) || a.id - b.id;
const reviewFields = (item) => ({ harsh: item.harsh ?? null, reviewed: !!item.reviewed });

// The receipt map in receipt order, so the saved state never shows the order
// cards arrived in, nor which ones a phone sent together (the same reason
// cards are kept in id order). A receipt is 16 hex characters: never an
// integer-like key, which objects would order first whatever the insertion.
function byReceipt(map) {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export class Session {
  constructor({
    state,
    now = Date.now,
    clusterCards,
    placeLateCards = localPlacer,
    tagCards = null,
    // createHarshnessCheck() in moderation.js, or null (no API key): nothing is checked.
    checkHarshness = null,
    // Fixed labels only, never card or thought text.
    log = (line) => console.error(line),
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
    this.checkHarshness = checkHarshness;
    this.log = log;
    // The harshness check: when it is due (once things are quiet), whether a
    // call is in flight, and a run number so a result after the shred is ignored.
    // checkFirstAt: when the oldest item still waiting arrived (the check never
    // waits more than HARSHNESS_MAX_WAIT_MS past it). checkRetried: a failed
    // run is retried once.
    this.checkDueAt = null;
    this.checkFirstAt = null;
    this.checkRetried = false;
    this.checking = false;
    this.checkRun = 0;
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
    this.closingAt = null; // when the closing screen is due, before any speed-up
    this.clusterRun = 0;
    this.shredPayload = null;
    // Which phones typed lately, and which hold an unsent thought: cid ->
    // { typedAt, unsent }. In memory only, never in this.state (which is
    // saved), so it never reaches the database; dropped at the shred. Neither
    // the text nor a length is ever sent, only that someone is typing.
    this.activity = new Map();
    this.activityKey = '';
    this.state = state ?? freshState(now(), talkMinutes);
    this.state.nudge ??= { mode: 'all', label: null };
    this.state.receipts ??= {};
    if (!state?.shredded) {
      this.state.talk ??= { startedAt: null, minutes: talkMinutes };
      this.state.reactEndsAt ??= null;
      this.state.reactClosedAt ??= null;
    }
    if (!this.state.shredded) {
      // Saved before reactions became emojis only: the comments are dropped.
      delete this.state.comments;
      delete this.state.removedComments;
      this.state.afterthoughts ??= [];
      this.state.removedAfterthoughts ??= {};
      // Saved before shared cards could be taken back: those have no receipt.
      this.state.cardReceipts = byReceipt(this.state.cardReceipts ?? {});
      if (this.state.walk) {
        this.state.walk.lastMs ??= LAST_SLIDE_MS;
        this.state.walk.held ??= false;
        this.state.walk.holdTo ??= null;
      }
      for (const client of Object.values(this.state.clients ?? {})) client.afterthoughts ??= 0;
      // Saved before decks had a size: reactions have started, so size it now.
      if (this.state.deckSize === undefined) {
        this.state.deckSize = PHASES.indexOf(this.state.phase) >= PHASES.indexOf('react') ? deckTimeSize(REACT_MINUTES * 60_000) : null;
      }
    }
    if (!this.state.shredded) {
      this.state.demo ??= { step: 0, cardIds: null };
      // Saved when the demo added a single card.
      if ('cardId' in this.state.demo) {
        this.state.demo.cardIds ??= this.state.demo.cardId === null ? null : [this.state.demo.cardId];
        delete this.state.demo.cardId;
      }
      this.state.demo.auto ??= false;
      this.state.demo.stepStartedAt ??= now();
    }
    // Saved before the room's stay and go-back taps were removed.
    if (this.state.walk) delete this.state.walk.signals;
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
    // A restart with cards or thoughts still unchecked: check them soon.
    if (!this.shredded && this.uncheckedItems().length) this.scheduleCheck();
  }

  get s() {
    return this.state;
  }

  changed() {
    // Whatever this broadcast carries already includes the prompt, so tick()
    // need not announce it again.
    this.promptKey = this.timedPromptKey();
    this.activityKey = this.activityCounts();
    this.onChange();
  }

  // The prompt that appears by time alone (phoneCount 0 leaves out the
  // "everyone finished reacting" path, which broadcasts by itself).
  timedPromptKey() {
    const move = pendingMove(this.s, this.now(), { phoneCount: 0 });
    return move ? `${move.to}:${move.label}` : '';
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

  // Hex only, as phones make them. This also keeps out names like
  // "__proto__" or "constructor", which every plain object already has.
  checkCid(cid) {
    if (typeof cid !== 'string' || !/^[0-9a-f]{16,64}$/.test(cid)) fail('Missing phone id');
    return cid;
  }

  client(cid) {
    this.checkCid(cid);
    return (this.s.clients[cid] ??= { cards: 0, reacted: 0, reactDone: false, afterthoughts: 0 });
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

  // `from` is the phase the facilitator's screen showed; if the room has moved
  // on, the tap is ignored (a double-tapped Back).
  back({ from } = {}) {
    if (from !== undefined && from !== null && from !== this.s.phase) fail('Already moved on');
    const to = previousPhase(this.s.phase);
    if (!to) fail(this.shredded ? 'The shred cannot be undone' : 'Nothing to go back to');
    this.enter(to, 'back');
    this.changed();
  }

  enter(to, direction) {
    const now = this.now();
    const from = this.s.phase;
    // Thoughts left unsent when the room moves on are not carried to the next part.
    if (from === 'react' && to !== 'react') for (const a of this.activity.values()) a.unsent = false;
    // The demo's shared notes join the session as ordinary cards, once each: no
    // author, and not counted against any phone. addCard's random ids put them
    // in a random order.
    if (from === 'demo' && direction === 'forward' && this.demo && this.s.demo && this.s.demo.cardIds === null) {
      this.s.demo.cardIds = this.demo.notes.filter((n) => n.share).map((n) => this.addCard(n.text));
    }
    if (direction === 'forward' && PLAN[to] && to !== 'demo' && this.s.talk && this.s.talk.startedAt === null) this.s.talk.startedAt = now - PLAN[to][0] * 60_000;
    if (from === 'react' && direction === 'forward') this.s.reactClosedAt = now;
    this.s.phase = to;
    this.s.phaseStartedAt = now;
    this.s.speedUp = null; // each part starts at its own speed
    // The demo plays on a loop when the room first reaches it; coming back to
    // it later waits for the facilitator.
    if (to === 'demo') Object.assign(this.s.demo, { auto: from === 'teaser' && direction === 'forward' && this.s.talk.startedAt === null, step: from === 'teaser' ? 0 : this.s.demo.step, stepStartedAt: now });
    if (to === 'react') {
      this.s.reactEndsAt =
        direction === 'forward' ? now + REACT_MINUTES * 60_000 : Math.max(this.s.reactEndsAt ?? 0, now + 60_000);
      // The deck is sized to the window when reactions start; coming back
      // from the walk-through (or "+1 minute") keeps it.
      if (direction === 'forward') this.s.deckSize = deckTimeSize(REACT_MINUTES * 60_000);
      // Starting again from grouping may bring new cards: nobody has finished yet.
      if (direction === 'forward') for (const client of Object.values(this.s.clients)) client.reactDone = false;
    }
    if (to === 'submit') {
      this.s.submitEndsAt =
        direction === 'forward' ? now + SUBMIT_MINUTES * 60_000 : Math.max(this.s.submitEndsAt ?? 0, now + 60_000);
    }
    if (to === 'cluster') this.continueGrouping();
    if (to === 'walk' && direction === 'forward') this.buildWalk();
    // Coming back to the walk-through holds the card until the facilitator resumes.
    if (to === 'walk' && direction === 'back') {
      Object.assign(this.s.walk, { paused: true, done: false, held: false, holdTo: null, cardStartedAt: now, cardEndsAt: null });
    }
  }

  // The facilitator's taps through the demo's steps. Only while in the demo.
  // `from` is the step the facilitator's screen showed; a double tap moves once.
  demoStep(delta, { from } = {}) {
    if (this.s.phase !== 'demo') fail('The demo is over');
    if (from !== undefined && from !== null && from !== this.s.demo.step) fail('Already moved on');
    const step = this.s.demo.step + delta;
    if (step < 0) fail('This is the first step');
    if (step >= DEMO_STEPS.length) fail('That was the last step');
    this.s.demo.step = step;
    this.s.demo.auto = false;
    this.s.demo.stepStartedAt = this.now();
    this.changed();
  }

  // The facilitator's switch for the loop: on starts again from the first
  // step, so the room sees the loop begin at once. A second tap while it
  // already loops (another device) leaves it where it is. Off stays put.
  demoAuto(on) {
    if (this.s.phase !== 'demo') fail('The demo is over');
    if (on && this.s.demo.auto) return;
    Object.assign(this.s.demo, { auto: !!on, stepStartedAt: this.now() }, on ? { step: 0 } : {});
    this.changed();
  }

  // `from` is the end time the facilitator's screen showed: "+1 minute" tapped
  // on two devices (or twice) adds one minute.
  extendSubmit({ from } = {}) {
    if (this.s.phase !== 'submit') fail('Submissions are not open');
    if (from !== undefined && from !== null && from !== this.s.submitEndsAt) fail('Already extended');
    this.s.submitEndsAt = Math.max(this.s.submitEndsAt ?? 0, this.now()) + 60_000;
    this.changed();
  }

  extendReact({ from } = {}) {
    if (this.s.phase !== 'react') fail('Reactions are not open');
    if (from !== undefined && from !== null && from !== this.s.reactEndsAt) fail('Already extended');
    this.s.reactEndsAt = Math.max(this.s.reactEndsAt ?? 0, this.now()) + 60_000;
    this.changed();
  }

  // The facilitator's one tap at the start of the talk. A second is a no-op.
  startTalk() {
    if (this.s.talk.startedAt !== null) return;
    this.s.talk.startedAt = this.now();
    // The talk has begun: a looping demo stops and waits on its first step; one
    // the facilitator is stepping by hand is left where it is.
    if (this.s.phase === 'demo' && this.s.demo.auto) Object.assign(this.s.demo, { auto: false, step: 0, stepStartedAt: this.now() });
    this.changed();
  }

  setNudges(on) {
    this.s.nudgesOn = !!on;
    this.changed();
  }

  // ---- submissions ------------------------------------------------------

  // Shares cards, takes cards back (by their receipts), or both at once, so a
  // phone can swap one of its 3 for another note. Everything is checked
  // before anything changes. Each new card gets a random receipt, returned in
  // the order sent; the receipt maps to the card only, never to the phone.
  submitCards(cid, texts, withdraw = []) {
    if (!SHARING_PHASES.includes(this.s.phase)) {
      const takingBack = Array.isArray(withdraw) && withdraw.length > 0;
      fail(takingBack && PHASES.indexOf(this.s.phase) > PHASES.indexOf('submit') ? "Grouping has started: shared cards can't be taken back now" : 'Submissions are closed');
    }
    const client = this.client(cid);
    if (!Array.isArray(texts) || !Array.isArray(withdraw)) fail('Nothing to submit');
    if (texts.length === 0 && withdraw.length === 0) fail('Nothing to submit');
    const clean = texts.map((t) => (typeof t === 'string' ? t.trim() : ''));
    if (clean.some((t) => t.length === 0 || t.length > LIMITS.cardMax)) fail(`Cards are 1 to ${LIMITS.cardMax} characters`);
    const live = (r) => typeof r === 'string' && Object.hasOwn(this.s.cardReceipts, r) && this.card(this.s.cardReceipts[r]);
    if (!withdraw.every(live) || new Set(withdraw).size !== withdraw.length || withdraw.length > client.cards) fail('Nothing to take back');
    if (client.cards - withdraw.length + clean.length > LIMITS.cardsPerPerson) fail(`Up to ${LIMITS.cardsPerPerson} cards at a time: take one back first`);
    for (const r of withdraw) this.removeCard(this.s.cardReceipts[r]);
    const receipts = clean.map((text) => {
      const receipt = randomBytes(8).toString('hex');
      this.s.cardReceipts[receipt] = this.addCard(text);
      return receipt;
    });
    this.s.cardReceipts = byReceipt(this.s.cardReceipts);
    client.cards += clean.length - withdraw.length;
    this.changed();
    // Nudges are for Submit: a card shared at Join waits for the next one.
    if (this.s.phase === 'submit') this.scheduleNudge();
    return { receipts };
  }

  // Deletes a card (not just hiding it), and everything about it: its
  // receipt, its place in a group (a group left empty goes, and so does a
  // theme left with no groups), and its place in a late-card placement.
  removeCard(id) {
    this.s.cards = this.s.cards.filter((c) => c.id !== id);
    for (const [r, cardId] of Object.entries(this.s.cardReceipts)) if (cardId === id) delete this.s.cardReceipts[r];
    this.pruneThemes();
    const late = this.s.clustering.late;
    if (!late) return;
    Object.assign(late, this.livePlacement(late));
    // Its flag was the only one: nothing is left to choose on, so the rest are
    // placed, as when nothing is flagged.
    if (late.status === 'flagged' && !late.flags.length) {
      this.placeLate(late);
      late.status = 'done';
    }
  }

  // Drops ids whose card no longer exists from the groups, then the groups
  // and themes left empty.
  pruneThemes() {
    for (const theme of this.s.themes) {
      for (const g of theme.groups) g.cardIds = g.cardIds.filter((id) => this.card(id));
      theme.groups = theme.groups.filter((g) => g.cardIds.length);
    }
    this.s.themes = this.s.themes.filter((t) => t.groups.length);
  }

  // A placement with only cards that still exist (one taken back is dropped).
  livePlacement({ placements, flags }) {
    return {
      placements: placements.filter((p) => this.card(p.cardId)),
      flags: flags.map((f) => ({ ...f, cardIds: f.cardIds.filter((id) => this.card(id)) })).filter((f) => f.cardIds.length),
    };
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
    this.scheduleCheck();
    return id;
  }

  hideCard(id, hidden) {
    const card = this.card(id);
    if (!card) fail('No such card');
    card.hidden = !!hidden;
    // A card hidden before clustering was never grouped (or sent to the AI).
    // If it is shown again later, give it a group of its own. While people are
    // still sharing, it waits to be placed with the other late cards instead.
    if (!card.hidden && !SHARING_PHASES.includes(this.s.phase) && this.s.themes.length && !this.grouped().has(id)) {
      this.otherTheme().groups.push({ id: this.newId(), cardIds: [id] });
    }
    // Shown again: check it, if it never was.
    if (!card.hidden && !card.harsh) this.scheduleCheck();
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
    // A card taken back while the AI was grouping doesn't come back.
    this.pruneThemes();
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
  applyPlacement(run, result) {
    if (run !== this.clusterRun || this.shredded) return;
    // A card taken back while the call ran is dropped from its result.
    const { placements, flags } = this.livePlacement(result);
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
  // to the phone, so reactions stay unlinkable across cards. Emojis only.
  react(cid, groupId, emojis, receipt) {
    if (!this.reactionsOpen()) fail('Reactions are closed');
    const client = this.client(cid);
    const found = this.findGroup(groupId);
    if (!found || this.visibleCardIds(found.group).length === 0) fail('No such card');
    if (!Array.isArray(emojis)) fail('Reactions are emojis only');
    if (emojis.length > LIMITS.emojisPerCard) fail(`Up to ${LIMITS.emojisPerCard} emojis on a card: remove ${emojis.length - LIMITS.emojisPerCard}`);
    const unique = [...new Set(emojis)];
    if (!unique.every(isSingleEmoji)) fail('Reactions are emojis only');
    const resend = receipt !== undefined && receipt !== null;
    // Clearing a card with its receipt is fine; a first send needs an emoji.
    if (!resend && unique.length === 0) fail('Pick an emoji');
    if (resend) {
      if (typeof receipt !== 'string' || this.s.receipts[receipt] !== groupId) fail('Nothing to change');
      this.s.reactions = this.s.reactions.filter((r) => r.r !== receipt);
    } else {
      if (client.reacted >= this.reactLimit()) fail('You have reacted to every card in your deck');
      client.reacted += 1;
      receipt = randomBytes(8).toString('hex');
      this.s.receipts[receipt] = groupId;
    }
    for (const e of unique) this.s.reactions.push({ g: groupId, e, r: receipt });
    this.changed();
    return { receipt };
  }

  // How many cards a phone may send first reactions to: its deck, which is
  // the deck size or every card if there are fewer. A card hidden after
  // someone reacted to it adds one, since a phone may have spent a send on it
  // before it left the deck. Counted from receipts, never from the phone.
  reactLimit() {
    const visible = new Set(this.visibleGroups().map((g) => g.id));
    const hiddenReacted = new Set(Object.values(this.s.receipts).filter((g) => g !== AFTERTHOUGHT && !visible.has(g)));
    return this.deckNow() + hiddenReacted.size;
  }

  // Each phone's deck size right now: the stored size (what fits the time),
  // or every visible card when there are fewer.
  deckNow() {
    const visible = this.visibleGroups().length;
    return Math.min(this.s.deckSize ?? visible, visible);
  }

  // Reactions and thoughts: open while reacting, and for the 10-second grace
  // after the room moves on, so a send in flight isn't lost.
  reactionsOpen() {
    if (this.s.phase === 'react') return true;
    return this.s.phase === 'walk' && this.s.reactClosedAt !== null && this.now() - this.s.reactClosedAt <= REACT_GRACE_MS;
  }

  // The one thought a phone may add at the end of its deck. The first send
  // returns a random receipt; sending again with it replaces the text, and an
  // empty text clears it. Like a card's receipt, it is never tied to the
  // phone: only the phone's count says it has added one. A thought the
  // facilitator removed stays removed.
  afterthought(cid, text, receipt) {
    if (!this.reactionsOpen()) fail('Thoughts are closed');
    const client = this.client(cid);
    const clean = typeof text === 'string' ? text.trim() : '';
    if (clean.length > LIMITS.afterthoughtMax) fail(`Thoughts are up to ${LIMITS.afterthoughtMax} characters`);
    const resend = receipt !== undefined && receipt !== null;
    let keepId; // a changed thought keeps its id, so it keeps its place in the order
    if (resend) {
      if (typeof receipt !== 'string' || this.s.receipts[receipt] !== AFTERTHOUGHT) fail('Nothing to change');
      keepId = this.s.afterthoughts.find((t) => t.r === receipt)?.id;
      this.s.afterthoughts = this.s.afterthoughts.filter((t) => t.r !== receipt);
    } else {
      if (!clean) fail('Write a thought first');
      if (client.afterthoughts >= 1) fail("You've already added a thought: change it instead");
      client.afterthoughts += 1;
      receipt = randomBytes(8).toString('hex');
      this.s.receipts[receipt] = AFTERTHOUGHT;
    }
    // A new or changed thought starts unchecked and unreviewed.
    if (clean && !this.s.removedAfterthoughts[receipt]) {
      this.s.afterthoughts.push({ id: keepId ?? this.newId(), text: clean, r: receipt });
      this.scheduleCheck();
    }
    this.refreshLastMs();
    this.changed();
    return { receipt };
  }

  removeAfterthought(id) {
    const i = this.s.afterthoughts.findIndex((t) => t.id === id);
    if (i < 0) fail('No such thought');
    // Remember the receipt (not the phone) so a resend can't bring it back.
    this.s.removedAfterthoughts[this.s.afterthoughts[i].r] = 1;
    this.s.afterthoughts.splice(i, 1);
    this.refreshLastMs();
    this.changed();
  }

  // Every thought, oldest first (ids are sequential, and a change keeps its id).
  afterthoughtList() {
    return this.s.afterthoughts.map(({ id, text }) => ({ id, text })).sort((a, b) => a.id - b.id);
  }

  // The facilitator's list: with each thought's check and reviewed mark,
  // unreviewed first, then harshest first.
  afterthoughtReviewList() {
    return this.s.afterthoughts.map((t) => ({ id: t.id, text: t.text, ...reviewFields(t) })).sort(byReview);
  }

  reactDone(cid) {
    if (this.s.phase !== 'react') fail('Reactions are closed');
    this.client(cid).reactDone = true;
    this.changed();
  }

  // ---- the harshness check and reviewed marks ------------------------------
  //
  // After each new card or thought, once there's been HARSHNESS_QUIET_MS with
  // nothing new (or HARSHNESS_MAX_WAIT_MS since the first one waiting, however
  // busy), every unchecked visible card and thought goes to the check, in calls
  // of at most HARSHNESS_BATCH. A failed call leaves its items unchecked and
  // blocks nothing; the run is retried once after the quiet time. The
  // facilitator marks items reviewed; the walk-through holds before an item
  // nobody has reviewed (see tickWalk). Hidden cards are never sent and never
  // need review.

  scheduleCheck() {
    if (!this.checkHarshness || this.shredded) return;
    const now = this.now();
    this.checkFirstAt ??= now;
    this.checkDueAt = Math.min(now + HARSHNESS_QUIET_MS, this.checkFirstAt + HARSHNESS_MAX_WAIT_MS);
  }

  // Visible cards (in id order) then thoughts (oldest first) with no answer
  // yet, each with a key for this call: cards and thoughts are numbered apart,
  // so their ids could clash.
  uncheckedItems() {
    const cards = this.s.cards.filter((c) => !c.hidden && !c.harsh).map((c) => ({ kind: 'card', id: c.id, text: c.text }));
    const thoughts = (this.s.afterthoughts ?? []).filter((t) => !t.harsh).sort((a, b) => a.id - b.id).map((t) => ({ kind: 'afterthought', id: t.id, text: t.text }));
    return [...cards, ...thoughts].map((item, i) => ({ ...item, key: i + 1 }));
  }

  tickCheck() {
    if (this.checkDueAt === null || this.checking || this.now() < this.checkDueAt) return;
    this.checkDueAt = null;
    this.checkFirstAt = null;
    const items = this.uncheckedItems();
    if (!items.length) return;
    const run = ++this.checkRun;
    this.checking = true;
    this.runCheck(run, items);
  }

  // One in-flight run works through the batches in turn. A batch that fails
  // is logged (a fixed line) and the rest still go.
  async runCheck(run, items) {
    let failed = false;
    for (let i = 0; i < items.length; i += HARSHNESS_BATCH) {
      if (run !== this.checkRun) return;
      // Only what is still visible and unchanged: a card hidden or taken back,
      // or a thought removed or edited, since the run began is not sent.
      const batch = items.slice(i, i + HARSHNESS_BATCH).filter((item) => this.stillSendable(item));
      if (!batch.length) continue;
      try {
        const answers = await this.checkHarshness(batch.map(({ key, text }) => ({ id: key, text })));
        if (!(answers instanceof Map)) throw new Error('No answers');
        this.applyCheck(run, batch, answers);
      } catch {
        failed = true;
        if (run === this.checkRun) this.log('moderation: check failed');
      }
    }
    if (run !== this.checkRun) return;
    this.checking = false;
    if (!failed) this.checkRetried = false;
    else if (!this.checkRetried) {
      this.checkRetried = true;
      this.scheduleCheck();
    }
  }

  // The card or thought an item came from, if it is still there with the same text.
  findCheckTarget(item) {
    const target = item.kind === 'card' ? this.card(item.id) : this.s.afterthoughts.find((t) => t.id === item.id);
    return target && target.text === item.text ? target : undefined;
  }

  stillSendable(item) {
    const target = this.findCheckTarget(item);
    return Boolean(target) && !target.hidden;
  }

  // Stores each answer on its item, if the item is still there with the same
  // text (a thought changed while the call ran is checked again later).
  applyCheck(run, items, answers) {
    if (run !== this.checkRun || this.shredded) return;
    let any = false;
    for (const item of items) {
      const a = answers.get(item.key);
      if (!a || ![0, 1, 2].includes(a.level)) continue;
      const target = this.findCheckTarget(item);
      if (!target) continue;
      target.harsh = { level: a.level, reason: typeof a.reason === 'string' ? a.reason : '' };
      any = true;
    }
    if (any) this.changed();
  }

  // The facilitator's "Reviewed" toggle on one card or thought.
  review(kind, id, on) {
    let item;
    if (kind === 'afterthought') item = this.s.afterthoughts.find((t) => t.id === id) ?? fail('No such thought');
    else if (kind === 'card') item = this.card(id) ?? fail('No such card');
    else fail('No such card');
    item.reviewed = on === true;
    this.changed();
  }

  // "Mark the rest reviewed": every visible card and thought not yet
  // reviewed that the check found fine, or never checked. Edgy and harsh ones
  // are reviewed one by one.
  reviewRest() {
    for (const item of [...this.s.cards.filter((c) => !c.hidden), ...this.s.afterthoughts]) {
      if (!item.reviewed && (!item.harsh || item.harsh.level === 0)) item.reviewed = true;
    }
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
      // slide: the afterthoughts, or, with none, an invitation to speak out loud.
      stream: [{ groupId: OVERVIEW, overview: true }, ...buildStream(themes, this.reactionCounts()), { groupId: LAST, last: true }],
      index: 0,
      cardStartedAt: now,
      cardEndsAt: null,
      endsAt: walkEndsAt(this.s.talk, now),
      // The last slide's time, kept back from the cards: more with more thoughts.
      lastMs: lastSlideMs(this.s.afterthoughts.length),
      paused: false,
      done: false,
      held: false,
      holdTo: null,
    };
    this.s.walk.cardEndsAt = now + cardMs(this.s.walk, now);
  }

  // The reserve for the last slide follows the thoughts: one sent in the grace
  // window, or one the facilitator removed, changes it, but only while the
  // walk-through's time isn't up yet. After that, the reserve decides which
  // cards were shown late (held, then resumed for a full share), so it stays
  // put until the last slide is shown (itemMs).
  refreshLastMs() {
    const w = this.s.walk;
    if (this.s.phase === 'walk' && this.now() < w.endsAt - w.lastMs) w.lastMs = lastSlideMs(this.s.afterthoughts.length);
  }

  // How long the current item runs: the last slide its own time (worked out
  // again from the thoughts it shows), a card its share.
  itemMs(w, now) {
    if (!w.stream[w.index].last) return cardMs(w, now);
    w.lastMs = lastSlideMs(this.s.afterthoughts.length);
    return w.lastMs;
  }

  // Shows another card and starts its clock. A paused walk holds the new card too.
  showCard(index) {
    const w = this.s.walk;
    const now = this.now();
    w.index = index;
    w.cardStartedAt = now;
    w.cardEndsAt = w.paused ? null : now + this.itemMs(w, now);
  }

  // The facilitator's Back and Next. `from` is the card their screen showed
  // when they tapped; if the walk-through has moved on, the tap is ignored (a
  // double-tapped Next). Next marks the next item's cards (or, before the last
  // slide, its thoughts) reviewed: the facilitator chose to show them. During
  // a hold, Next goes where the timer was going.
  moveCard(delta, { from } = {}) {
    if (this.s.phase !== 'walk') fail('Cards move in the walk-through');
    const w = this.s.walk;
    if (from !== undefined && from !== null && from !== w.index) fail('Already moved on');
    if (delta > 0 && w.held) {
      const to = this.upcoming(w.holdTo);
      this.markReviewed(to);
      Object.assign(w, { held: false, holdTo: null, paused: false });
      this.showAt(to);
      return this.changed();
    }
    // Back during a hold ends it, and its pause: the facilitator never tapped
    // Pause (a paused walk-through never holds, since its timer doesn't run).
    if (delta < 0 && w.index === 0 && !w.done) fail('This is the first card');
    if (w.held) Object.assign(w, { held: false, holdTo: null, paused: false });
    if (delta > 0 && w.index < w.stream.length - 1) this.markReviewed(this.upcoming(w.index + 1));
    this.stepWalk(delta);
    this.changed();
  }

  // One step back or forward in the stream (forward from the last slide finishes).
  stepWalk(delta) {
    const w = this.s.walk;
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
      this.showAt(index);
    }
  }

  // Shows the item at `index` for a move the facilitator made.
  showAt(index) {
    const w = this.s.walk;
    this.showCard(index);
    // After the walk-through's time is up, a Back or Next onto a real card
    // holds it until the facilitator resumes; otherwise the next tick would
    // snap straight back to the last slide. The last slide runs normally.
    if (!w.stream[index].last && this.now() >= w.endsAt - w.lastMs) {
      w.paused = true;
      w.cardEndsAt = null;
    } else if (w.stream[index].last && w.paused) {
      w.paused = false;
      this.showCard(index);
    }
  }

  // The first item from `index` on that the room would see: hidden cards are
  // passed over (the overview and the last slide never are).
  upcoming(index) {
    const { stream } = this.s.walk;
    let i = index;
    while (i < stream.length - 1 && !stream[i].overview && !stream[i].last && this.itemCards(i).length === 0) i += 1;
    return i;
  }

  // What the room sees at `index`: a card's visible cards, the last slide's
  // thoughts, or nothing to review (the overview).
  itemCards(index) {
    const item = this.s.walk.stream[index];
    if (!item || item.overview) return [];
    if (item.last) return this.s.afterthoughts;
    const found = this.findGroup(item.groupId);
    return found ? this.visibleCardIds(found.group).map((id) => this.card(id)) : [];
  }

  needsReview(index) {
    return this.itemCards(index).some((item) => !item.reviewed);
  }

  markReviewed(index) {
    for (const item of this.itemCards(index)) item.reviewed = true;
  }

  // Pausing holds the card; resuming gives it a fresh share. The finish time never moves.
  // Resuming during a hold gives the current card another share, then the
  // timer checks the next one again.
  pauseWalk(paused) {
    if (this.s.phase !== 'walk') fail('Not in the walk-through');
    const w = this.s.walk;
    if (typeof paused !== 'boolean') fail('Pause or resume');
    if (paused === w.paused) return;
    w.paused = paused;
    if (!paused) Object.assign(w, { held: false, holdTo: null });
    if (paused) w.cardEndsAt = null;
    else if (!w.done) {
      const now = this.now();
      w.cardEndsAt = now + this.itemMs(w, now);
      w.cardStartedAt = now;
    }
    this.changed();
  }

  // Called every second by the server. Each timed part has its own check;
  // anything that isn't running does nothing.
  tick() {
    if (this.shredded) return;
    this.tickCheck();
    if (this.s.phase === 'demo') this.tickDemo();
    if (this.s.phase === 'submit') this.tickSubmit();
    if (this.s.phase === 'walk') this.tickWalk();
    // A deadline simply passing changes the prompt with no event to broadcast it.
    if (this.timedPromptKey() !== this.promptKey) this.changed();
    // The count falls with no event to say so.
    this.pruneActivity();
    if (this.activityCounts() !== this.activityKey) this.changed();
  }

  // On the loop, the server moves the demo on, so every projector shows the
  // same step; the last step wraps to the first.
  tickDemo() {
    const d = this.s.demo;
    const now = this.now();
    if (!this.demo || !d.auto || now < d.stepStartedAt + DEMO_STEP_MS[d.step]) return;
    d.step = (d.step + 1) % DEMO_STEPS.length;
    d.stepStartedAt = now;
    this.changed();
  }

  // At the 1-minute warning, group the cards so far, once per session.
  tickSubmit() {
    if (!earlyGroupingDue(this.s, this.now())) return;
    this.s.clustering.early = true;
    this.startClustering();
    this.changed();
  }

  // When the walk-through's time is up, a card that was already running skips
  // to the last slide. A card shown or resumed after that (it was held) runs
  // its own fresh share, then goes to the last slide. A hidden card gets no time.
  // Before moving onto an item with a card or thought nobody has reviewed, it
  // holds on the current one instead (a pause: the finish doesn't move).
  tickWalk() {
    const w = this.s.walk;
    if (w.held) return this.tickHeld();
    if (w.paused || w.done) return;
    const now = this.now();
    const last = w.stream.length - 1;
    const timeUp = w.endsAt - w.lastMs;
    const shownLate = w.cardStartedAt !== null && w.cardStartedAt >= timeUp;
    if (w.index < last && !shownLate && now >= timeUp) return this.timerMove(last);
    const over = this.itemView(this.currentItem())?.hidden || (w.cardEndsAt !== null && now >= w.cardEndsAt);
    if (!over) return;
    if (w.index < last && shownLate) this.timerMove(last);
    else if (w.index < last) this.timerMove(w.index + 1);
    else {
      this.stepWalk(1); // the last slide is over: done
      this.changed();
    }
  }

  // The timer's move: on, or a hold if the item the room would see next needs review.
  timerMove(index) {
    const to = this.upcoming(index);
    if (!this.needsReview(to)) return this.moveTo(index);
    Object.assign(this.s.walk, { held: true, holdTo: to, paused: true, cardEndsAt: null });
    this.changed();
  }

  // Held: once the item is reviewed, the timer moves on as it would have.
  // If it was hidden instead and the next one also needs review, the hold
  // moves on to that one, so the facilitator sees what Next would show.
  tickHeld() {
    const w = this.s.walk;
    const to = this.upcoming(w.holdTo);
    if (this.needsReview(to)) {
      if (to !== w.holdTo) {
        w.holdTo = to;
        this.changed();
      }
      return;
    }
    Object.assign(w, { held: false, holdTo: null, paused: false, cardEndsAt: this.now() });
    this.tickWalk();
  }

  moveTo(index) {
    this.showCard(index);
    this.changed();
  }

  // The facilitator's "Speed up" during the finale or the shred: the rest of
  // the part plays three times faster, once (a second tap does nothing more).
  // The finale's prompt and the closing screen come sooner to match.
  speedUp({ from } = {}) {
    if (from !== undefined && from !== null && from !== this.s.phase) fail('Already moved on');
    if (this.s.phase !== 'finale' && this.s.phase !== 'shred') fail('Speed up is only for the finale and the shred');
    if (this.s.speedUp) return;
    this.s.speedUp = { at: this.now(), factor: SPEED_UP };
    if (this.s.phase === 'shred') this.scheduleClosing();
    this.changed();
  }

  // ---- the quiet count of people writing -----------------------------------
  // Phones only say "I'm typing" (and "I hold an unsent thought"), never what.
  // Typing counts from Join (TYPING_PHASES); screens show it from Submit.

  typing(cid) {
    this.checkCid(cid);
    if (this.shredded || !TYPING_PHASES.includes(this.s.phase)) return;
    const a = this.activityOf(cid);
    const before = this.activityCounts();
    a.typedAt = this.now();
    if (this.activityCounts() !== before) this.changed();
  }

  unsent(cid, on) {
    this.checkCid(cid);
    if (this.shredded || this.s.phase !== 'react') return;
    const a = this.activityOf(cid);
    const before = this.activityCounts();
    a.unsent = on === true;
    if (this.activityCounts() !== before) this.changed();
  }

  activityOf(cid) {
    let a = this.activity.get(cid);
    if (!a) this.activity.set(cid, (a = { typedAt: -Infinity, unsent: false }));
    return a;
  }

  writingCount() {
    const now = this.now();
    let n = 0;
    for (const a of this.activity.values()) if (now - a.typedAt < WRITING_WINDOW_MS) n += 1;
    return n;
  }

  unsentCount() {
    let n = 0;
    for (const a of this.activity.values()) if (a.unsent) n += 1;
    return n;
  }

  // What the screens show of this, as one comparable string; '' where nothing is shown.
  activityCounts() {
    const p = this.s.phase;
    if (this.shredded || !WRITING_SHOWN.includes(p)) return '';
    return `${this.writingCount()}:${p === 'react' ? this.unsentCount() : 0}`;
  }

  // Forgets phones that stopped typing and hold nothing unsent.
  pruneActivity() {
    const now = this.now();
    for (const [cid, a] of this.activity) if (!a.unsent && now - a.typedAt >= WRITING_WINDOW_MS) this.activity.delete(cid);
  }

  // ---- shred ------------------------------------------------------------

  // Nothing due, and a call still in flight is ignored when it lands.
  stopChecks() {
    this.checkRun += 1;
    this.checkDueAt = null;
    this.checkFirstAt = null;
    this.checkRetried = false;
    this.checking = false;
  }

  shred() {
    if (this.shredded) fail('Already shredded');
    const cards = this.s.cards.filter((c) => !c.hidden).map((c) => c.text);
    // Kept in memory only, just long enough for the projector's animation.
    this.shredPayload = { emojis: this.emojiMix(), cards };
    this.clusterRun += 1;
    clearTimeout(this.nudgeTimer);
    this.activity.clear();
    this.stopChecks();
    this.shredded = true;
    this.state = {
      sessionId: this.s.sessionId,
      phase: 'shred',
      phaseStartedAt: this.now(),
      shredded: true,
      speedUp: null,
      walk: { stream: [], index: 0 },
    };
    this.onShred();
    this.closingAt = this.now() + (this.shredAnimationMs ?? shredTimeline(this.shredPayload).closingAt);
    this.scheduleClosing();
    this.changed();
  }

  // Once the animation and a beat of black are over (sooner if sped up), drop
  // the payload and move everyone on to the closing screen.
  scheduleClosing() {
    clearTimeout(this.closingTimer);
    this.closingTimer = setTimeout(() => {
      this.shredPayload = null;
      if (this.s.phase === 'shred') this.enter('closing', 'forward');
      this.changed();
    }, Math.max(0, spedUp(this.closingAt ?? this.now(), this.s.speedUp) - this.now()));
    this.closingTimer.unref?.();
  }

  // After the shred, start over for another session. Only allowed once
  // everything is already shredded, so it can never delete anything.
  reset() {
    if (!this.shredded) fail('Shred first: a new session starts only after the shred');
    clearTimeout(this.closingTimer);
    this.shredPayload = null;
    this.shredded = false;
    this.activity.clear();
    this.stopChecks();
    this.state = freshState(this.now(), this.talkMinutes);
    this.onReset();
    this.changed();
  }

  // ---- views: what each screen is allowed to see -------------------------

  // The page anyone sees before the event; the only part of the demo file that is public.
  teaser() {
    return this.demo?.teaser ?? DEFAULT_TEASER;
  }

  view(role, { cid, phoneCount = 0 } = {}) {
    if (role === 'facilitator') return this.facilitatorView({ phoneCount });
    if (role === 'projector') return this.projectorView({ phoneCount });
    return this.phoneView(cid);
  }

  phoneView(cid) {
    const s = this.s;
    const v = { role: 'phone', session: s.sessionId, phase: s.phase, now: this.now() };
    if (this.shredded) return v;
    if (s.phase === 'teaser') v.teaser = this.teaser();
    const c = typeof cid === 'string' ? s.clients[cid] : undefined;
    // The notepad is open from Join. Its timer and nudges start at Submit.
    if (SHARING_PHASES.includes(s.phase)) {
      const timed = s.phase === 'submit';
      const texts = timed ? this.nudgeTexts() : null;
      v.submit = {
        endsAt: timed ? s.submitEndsAt : null,
        submitted: c?.cards ?? 0,
        max: LIMITS.cardsPerPerson,
        nudgesOn: timed && s.nudgesOn,
        nudge: texts && { texts },
      };
    }
    if (s.phase === 'react') {
      v.react = {
        groups: this.visibleGroups().map((g) => ({ id: g.id, texts: this.visibleCardIds(g).map((id) => this.card(id).text) })),
        done: !!c?.reactDone,
        endsAt: s.reactEndsAt,
        // The phone reacts to deckSize cards of its own shuffle.
        deckSize: this.deckNow(),
      };
    }
    return v;
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
    if (s.phase === 'finale' || s.phase === 'shred') v.speedUp = s.speedUp ?? null;
    if (this.shredded) return v;
    if (s.phase === 'teaser') v.teaser = this.teaser();
    if (s.phase === 'demo' && this.demo) {
      const { teaser, ...content } = this.demo;
      v.demo = { step: s.demo.step, auto: s.demo.auto, stepStartedAt: s.demo.stepStartedAt, ...content };
    }
    if (s.phase === 'join') v.phones = phoneCount;
    if (WRITING_SHOWN.includes(s.phase)) v.writing = this.writingCount();
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
      };
      // On the last slide only, and the text only: ids come from one
      // session-wide counter, so they could hint at when each was sent.
      if (item?.last) v.walk.afterthoughts = this.afterthoughtList().map(({ text }) => ({ text }));
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
    if (s.phase === 'finale' || s.phase === 'shred') v.speedUp = s.speedUp ?? null;
    if (this.shredded) return v;
    const { startedAt, minutes } = s.talk;
    if (s.phase === 'teaser') v.teaser = this.teaser();
    if (s.phase === 'demo' && this.demo) v.demo = { step: s.demo.step, steps: DEMO_STEPS.length, name: DEMO_STEPS[s.demo.step], auto: s.demo.auto };
    if (WRITING_SHOWN.includes(s.phase)) v.writing = this.writingCount();
    if (s.phase === 'react') v.unsent = this.unsentCount();
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
    // Unreviewed first, then harshest first; hidden cards (no review needed) last.
    v.cards = s.cards
      .map((c) => ({ id: c.id, text: c.text, hidden: c.hidden, ...reviewFields(c) }))
      .sort((a, b) => a.hidden - b.hidden || byReview(a, b));
    // Whether there is a check at all (no API key: every item reads "not
    // checked"), and how many visible items nobody has reviewed yet.
    const unreviewed = [...s.cards.filter((c) => !c.hidden), ...s.afterthoughts].filter((x) => !x.reviewed);
    v.review = {
      checking: !!this.checkHarshness,
      left: unreviewed.length,
      // What "Mark the rest reviewed" would mark: fine or never checked.
      rest: unreviewed.filter((x) => !x.harsh || x.harsh.level === 0).length,
    };
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
        cards: g.cardIds.map((id) => this.card(id)).filter(Boolean).map((c) => ({ id: c.id, text: c.text, hidden: c.hidden, ...reviewFields(c) })),
      })),
    }));
    const afterthoughts = this.afterthoughtReviewList();
    v.react = {
      done: Object.values(s.clients).filter((c) => c.reactDone).length,
      reactions: s.reactions.length,
      endsAt: s.reactEndsAt,
      // Each phone gets deckSize of the total cards (all of them if fewer).
      deckSize: s.deckSize === null ? null : this.deckNow(),
      total: this.visibleGroups().length,
      afterthoughts,
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
      // Holding before an unreviewed item, and which (an index into the stream).
      held: inWalk && !!s.walk.held,
      // Resolved past hidden cards, so it is always what Next would show.
      holdTo: inWalk && s.walk.held ? this.upcoming(s.walk.holdTo) : null,
      stream: s.walk.stream.map((it) =>
        it.overview
          ? { groupId: it.groupId, text: 'Overview: what came up', reactions: s.reactions.length }
          : it.last
            ? { groupId: it.groupId, text: afterthoughts.length ? `Last slide: Afterthoughts (${afterthoughts.length})` : 'Last slide: Anything else? Out loud.', reactions: 0 }
            : { groupId: it.groupId, text: this.groupText(it.groupId), reactions: counts.get(it.groupId) ?? 0 },
      ),
      item: item ? { groupId: item.groupId, ...this.itemView(item) } : null,
      // Every thought, to remove one before the last slide shows it.
      afterthoughts,
    };
    return v;
  }
}
