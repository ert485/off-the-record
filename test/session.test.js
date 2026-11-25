import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, normalizeClusters, cleanHaiku, SKIPPED } from '../server/session.js';
import { paceMinutes, PHASES, PLAN } from '../server/phases.js';
import { shredTimeline } from '../public/shared/shred-timing.js';
import { deck, deckEnd } from '../public/shared/client.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

// Starts at join: the demo before it is covered in flow.test.js.
function make({ cluster, atDemo = false } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => (t += ms) };
  let changes = 0;
  let shreds = 0;
  const session = new Session({
    now: clock.now,
    clusterCards: cluster ?? (async (cards) => ({ themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] })),
    onChange: () => changes++,
    onShred: () => shreds++,
    shredAnimationMs: 10,
  });
  session.advance(); // teaser to demo
  if (!atDemo) session.advance();
  return { session, clock, changes: () => changes, shreds: () => shreds };
}

const flush = () => new Promise((r) => setImmediate(r));

async function toReact(session) {
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  session.submitCards(B, ['three']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
}

test('phases advance in order and back works until the shred', () => {
  const { session } = make({ atDemo: true });
  assert.equal(session.state.phase, 'demo');
  session.back();
  assert.equal(session.state.phase, 'teaser');
  assert.throws(() => session.back(), /Nothing to go back/);
  session.advance();
  session.advance();
  assert.equal(session.state.phase, 'join');
  session.advance();
  assert.equal(session.state.phase, 'submit');
  session.back();
  assert.equal(session.state.phase, 'join');
});

test('phones see the phase; the facilitator sees controls', () => {
  const { session } = make();
  session.advance();
  assert.deepEqual(Object.keys(session.view('phone', { cid: A })).sort(), ['now', 'phase', 'role', 'session', 'submit']);
  const f = session.view('facilitator', { phoneCount: 3 });
  assert.equal(f.next, 'cluster');
  assert.equal(f.canBack, true);
  assert.equal(f.phones, 3);
});

test('the shred needs a confirm and cannot be undone', async () => {
  const { session, shreds } = make();
  await toReact(session);
  session.advance(); // walk
  session.advance(); // finale
  assert.throws(() => session.advance(), /Confirm the shred/);
  session.advance({ confirm: true });
  assert.equal(session.state.phase, 'shred');
  assert.equal(shreds(), 1);
  assert.throws(() => session.back(), /cannot be undone/);
  assert.equal(JSON.stringify(session.state).includes('one'), false);
  session.advance();
  assert.equal(session.state.phase, 'closing');
  assert.throws(() => session.back());
});

test('submissions: up to 3 cards each, only while open, no author stored', () => {
  const { session } = make({ atDemo: true });
  assert.throws(() => session.submitCards(A, ['early']), /closed/);
  session.advance(); // join
  session.advance(); // submit
  session.submitCards(A, ['a', 'b']);
  assert.throws(() => session.submitCards(A, ['c', 'd']), /Up to 3/);
  session.submitCards(A, ['c']);
  assert.throws(() => session.submitCards(B, ['x'.repeat(201)]), /1 to 200/);
  assert.throws(() => session.submitCards('short', ['x']), /phone id/);
  assert.equal(session.state.cards.length, 3);
  for (const card of session.state.cards) assert.deepEqual(Object.keys(card).sort(), ['hidden', 'id', 'text']);
  assert.equal(JSON.stringify(session.state.clients).includes('"a"'), false);
  assert.equal(session.view('phone', { cid: A }).submit.submitted, 3);
});

test('cards can be shared from Join', async () => {
  const sent = [];
  const { session, clock } = make({ cluster: async (cards) => (sent.push(...cards.map((c) => c.text)), { themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] }) });
  assert.equal(session.state.phase, 'join');
  session.submitCards(A, ['early one', 'early two']);
  assert.equal(session.view('phone', { cid: A }).submit.submitted, 2);
  assert.equal(session.state.submitEndsAt, null, 'the 5 minutes start at Submit, not Join');
  // Nothing timed runs at Join: no early grouping, however long it lasts.
  clock.tick(10 * 60_000);
  session.tick();
  assert.equal(session.state.clustering.status, 'idle');
  session.advance(); // submit
  assert.equal(session.state.submitEndsAt, clock.now() + 5 * 60_000);
  // The 3 cards each span Join and Submit.
  session.submitCards(A, ['in submit']);
  assert.throws(() => session.submitCards(A, ['a fourth']), /Up to 3/);
  // The early grouping still comes at the 1-minute warning, and includes the Join cards.
  clock.tick(4 * 60_000);
  session.tick();
  await flush();
  assert.equal(session.state.clustering.early, true);
  assert.deepEqual(sent.sort(), ['early one', 'early two', 'in submit']);
});

test("the phone view in Join carries the notepad's fields, with no timer and no nudge", () => {
  const { session } = make();
  session.setNudges(true);
  const v = session.view('phone', { cid: A });
  assert.deepEqual(Object.keys(v).sort(), ['now', 'phase', 'role', 'session', 'submit']);
  assert.deepEqual(v.submit, { endsAt: null, submitted: 0, max: 3, nudgesOn: false, nudge: null });
  session.advance(); // submit: the timer and the nudges start here
  const s = session.view('phone', { cid: A }).submit;
  assert.equal(typeof s.endsAt, 'number');
  assert.equal(s.nudgesOn, true);
  assert.ok(s.nudge.texts.length > 0);
});

test('extend adds a minute to the submission window', () => {
  const { session } = make();
  session.advance();
  const before = session.state.submitEndsAt;
  session.extendSubmit();
  assert.equal(session.state.submitEndsAt, before + 60_000);
});

test('+1 minute tapped on two devices adds one minute', async () => {
  const { session } = make();
  session.advance(); // submit
  const seen = session.view('facilitator').submit.endsAt;
  session.extendSubmit({ from: seen });
  assert.throws(() => session.extendSubmit({ from: seen }), /Already extended/);
  assert.equal(session.state.submitEndsAt, seen + 60_000);
  session.submitCards(A, ['one']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  const reactSeen = session.view('facilitator').react.endsAt;
  session.extendReact({ from: reactSeen });
  assert.throws(() => session.extendReact({ from: reactSeen }), /Already extended/);
  assert.equal(session.state.reactEndsAt, reactSeen + 60_000);
});

test('clustering groups every card once; hidden cards are never sent', async () => {
  let sent;
  const { session } = make({
    cluster: async (cards) => {
      sent = cards;
      return { themes: [{ name: 'Work', groups: [[cards[0].id, cards[1].id]] }] };
    },
  });
  session.advance();
  session.submitCards(A, ['same thing', 'same thing!', 'secret name']);
  const secret = session.state.cards.find((c) => c.text === 'secret name');
  session.hideCard(secret.id, true);
  session.advance();
  assert.equal(session.state.clustering.status, 'running');
  assert.throws(() => session.advance(), /still running/);
  await flush();
  assert.equal(sent.length, 2);
  assert.equal(sent.some((c) => c.text === 'secret name'), false);
  assert.equal(session.state.themes.length, 1);
  assert.equal(session.state.themes[0].groups[0].cardIds.length, 2);
  session.approveTheme(session.state.themes[0].id, 'Work life');
  assert.equal(session.state.themes[0].approved, true);
});

test('a clustering failure falls back to one card per group', async () => {
  const { session } = make({ cluster: async () => Promise.reject(new Error('boom')) });
  session.advance();
  session.submitCards(A, ['x', 'y']);
  session.advance();
  await flush();
  assert.equal(session.state.clustering.status, 'failed');
  assert.equal(session.state.themes[0].groups.length, 2);
});

test('normalizeClusters drops unknown and duplicate ids and keeps missing ones', () => {
  const themes = normalizeClusters([{ name: 'T', groups: [[1, 2, 99], [2, 3]] }], [1, 2, 3, 4]);
  assert.deepEqual(themes, [
    { name: 'T', haiku: '', groups: [[1, 2], [3]] },
    { name: 'Other', haiku: '', groups: [[4]] },
  ]);
});

test('reactions are pooled per group and capped at one pass', async () => {
  const { session } = make();
  await toReact(session);
  const groups = session.view('phone', { cid: A }).react.groups;
  assert.equal(groups.length, 3);
  session.react(A, groups[0].id, ['🙋', '🫂', '🙋']);
  session.react(A, groups[1].id, ['🦆']);
  session.react(A, groups[2].id, ['🎉']);
  assert.throws(() => session.react(A, groups[0].id, ['😂']), /every card/);
  assert.throws(() => session.react(B, groups[0].id, ['hello']), /emojis only/);
  session.reactDone(A);
  assert.equal(session.state.reactions.length, 4);
  assert.equal(session.view('facilitator').react.done, 1);
});

test('walk-through: cards move, and nothing counts stay or go back', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  assert.equal(session.state.phase, 'walk');
  session.moveCard(1);
  session.moveCard(-1);
  assert.throws(() => session.moveCard(-1), /first card/);
  for (const role of ['projector', 'facilitator']) {
    const w = session.view(role).walk;
    assert.equal('stay' in w, false);
    assert.equal('back' in w, false);
  }
});

test('there is no signal action', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  assert.equal(session.signal, undefined);
  assert.equal('signals' in session.state.walk, false);
});

test("the phone's walk view has no stay or go back", async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  assert.equal(session.view('phone', { cid: A }).walk, undefined);
});

test('a saved state from before still loads, without its signals', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  const saved = JSON.parse(JSON.stringify(session.state));
  saved.walk.signals = { stay: { [A]: 1 }, back: {} };
  const loaded = new Session({ state: saved, now: () => 1_000_000 });
  assert.equal('signals' in loaded.state.walk, false);
  loaded.moveCard(1);
  assert.equal(loaded.view('projector').walk.index, 1);
});

test('hidden cards leave the stream and the reaction stack', async () => {
  const { session } = make();
  await toReact(session);
  const card = session.state.cards[0];
  session.hideCard(card.id, true);
  const texts = session.view('phone', { cid: A }).react.groups.flatMap((g) => g.texts);
  assert.equal(texts.includes(card.text), false);
  session.advance();
  assert.equal(session.state.walk.stream.length, 4); // the overview, 2 cards, the last slide
  assert.equal(session.state.walk.stream[0].overview, true);
  assert.equal(JSON.stringify(session.view('projector')).includes(card.text), false);
});

test('a reaction carries emojis only', async () => {
  const { session } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  assert.throws(() => session.react(A, g, []), /^Error: Pick an emoji$/);
  // Anything sent beside the emojis is ignored, not stored.
  const { receipt } = session.react(A, g, ['🙋'], null, 'a stray comment');
  assert.equal(JSON.stringify(session.state).includes('a stray comment'), false);
  for (const r of session.state.reactions) assert.deepEqual(Object.keys(r).sort(), ['e', 'g', 'r']);
  assert.equal('comments' in session.state, false);
  assert.equal('removedComments' in session.state, false);
  assert.equal(session.removeComment, undefined);
  // An empty list with the receipt clears the card's reactions.
  session.react(A, g, [], receipt);
  assert.equal(session.state.reactions.length, 0);
  assert.equal(session.state.clients[A].reacted, 1);
  assert.throws(() => session.react(A, g, [], 'feedfacefeedface'), /Nothing to change/);
  session.advance(); // walk
  assert.equal('comments' in session.view('facilitator'), false);
  assert.equal('comments' in session.view('projector').walk, false);
});

test('a session saved with comments loads, and the comments are dropped', async () => {
  const { session, clock } = make();
  await toReact(session);
  const saved = JSON.parse(JSON.stringify(session.state));
  saved.comments = [{ id: 99, g: 1, text: 'an old comment', r: 'feedfacefeedface' }];
  saved.removedComments = { feedfacefeedface: 1 };
  delete saved.afterthoughts;
  delete saved.removedAfterthoughts;
  delete saved.walk.lastMs;
  for (const c of Object.values(saved.clients)) delete c.afterthoughts;
  assert.ok(Object.keys(saved.clients).length >= 2);
  const copy = new Session({ now: clock.now, clusterCards: async () => ({ themes: [] }), state: saved });
  assert.equal(JSON.stringify(copy.state).includes('an old comment'), false);
  assert.equal('removedComments' in copy.state, false);
  // Every saved phone gets a thought count on load, not only those that act again.
  for (const c of Object.values(copy.state.clients)) assert.equal(c.afterthoughts, 0);
  copy.afterthought(A, 'still works');
  assert.deepEqual(copy.state.afterthoughts.map((t) => t.text), ['still works']);
  copy.advance(); // walk
  assert.ok(copy.state.walk.lastMs > 0);
});

test('a phone can add one thought at the end and change it with its receipt', async () => {
  const { session } = make();
  await toReact(session);
  const { receipt } = session.afterthought(A, '  a thought  ');
  assert.equal(typeof receipt, 'string');
  assert.deepEqual(session.state.afterthoughts.map((t) => t.text), ['a thought']);
  assert.deepEqual(Object.keys(session.state.afterthoughts[0]), ['id', 'text', 'r']);
  assert.equal(JSON.stringify(session.state.afterthoughts).includes(A), false);
  assert.equal(session.state.clients[A].afterthoughts, 1);
  assert.throws(() => session.afterthought(A, 'another'), /You've already added a thought: change it instead/);
  session.afterthought(B, 'from B');
  // Changing it keeps its place.
  session.afterthought(A, 'changed', receipt);
  assert.deepEqual(session.view('facilitator').react.afterthoughts.map((t) => t.text), ['changed', 'from B']);
  assert.equal(session.state.clients[A].afterthoughts, 1);
  assert.throws(() => session.afterthought(A, 'x'.repeat(201), receipt), /up to 200/);
  session.afterthought(A, 'x'.repeat(200), receipt);
  assert.throws(() => session.afterthought(C, 'x', 'feedfacefeedface'), /Nothing to change/);
  assert.throws(() => session.afterthought(C, '   '), /Write a thought/);
  // A card's receipt can't change a thought, nor a thought's a card.
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  const { receipt: cardReceipt } = session.react(C, g, ['🙋']);
  assert.throws(() => session.afterthought(C, 'x', cardReceipt), /Nothing to change/);
  assert.throws(() => session.react(C, g, ['🙋'], receipt), /Nothing to change/);
});

test('an empty thought with its receipt clears it', async () => {
  const { session } = make();
  await toReact(session);
  const { receipt } = session.afterthought(A, 'second thoughts');
  session.afterthought(A, '', receipt);
  assert.deepEqual(session.state.afterthoughts, []);
  assert.throws(() => session.afterthought(A, 'a new one'), /already added a thought/);
  // The receipt still works: the phone can write it again.
  session.afterthought(A, 'back again', receipt);
  assert.deepEqual(session.state.afterthoughts.map((t) => t.text), ['back again']);
});

test("a removed thought can't come back with its receipt", async () => {
  const { session } = make();
  await toReact(session);
  const { receipt } = session.afterthought(A, 'mean');
  const [t] = session.view('facilitator').react.afterthoughts;
  session.removeAfterthought(t.id);
  assert.deepEqual(session.state.afterthoughts, []);
  assert.throws(() => session.removeAfterthought(t.id), /No such thought/);
  assert.deepEqual(session.afterthought(A, 'mean again', receipt), { receipt });
  assert.deepEqual(session.state.afterthoughts, []);
  assert.equal(JSON.stringify(session.state.removedAfterthoughts).includes(A), false);
});

test('thoughts are closed outside reactions, except the 10-second grace', async () => {
  const { session, clock } = make();
  session.advance(); // submit
  assert.throws(() => session.afterthought(A, 'too early'), /Thoughts are closed/);
  session.submitCards(A, ['one']);
  session.advance(); // cluster
  await flush();
  assert.throws(() => session.afterthought(A, 'too early'), /Thoughts are closed/);
  session.advance(); // react
  const { receipt } = session.afterthought(A, 'in time');
  session.advance(); // walk
  clock.tick(9000);
  session.afterthought(B, 'just in time');
  session.afterthought(A, 'changed in time', receipt);
  clock.tick(2000);
  assert.throws(() => session.afterthought(C, 'too late'), /Thoughts are closed/);
  assert.throws(() => session.afterthought(A, 'too late', receipt), /Thoughts are closed/);
  assert.deepEqual(session.state.afterthoughts.map((t) => t.text).sort(), ['changed in time', 'just in time']);
});

test('phones never receive thoughts', async () => {
  const { session } = make();
  await toReact(session);
  session.afterthought(A, 'zebra thought');
  const phones = () => JSON.stringify([session.view('phone', { cid: A }), session.view('phone', { cid: B })]);
  assert.equal(phones().includes('zebra'), false);
  session.advance(); // walk
  const w = session.state.walk;
  for (let i = 0; i < w.stream.length; i++) {
    session.moveTo(i);
    assert.equal(phones().includes('zebra'), false);
  }
  assert.ok(JSON.stringify(session.view('projector')).includes('zebra'), 'control: the last slide shows it');
});

test("the projector gets the thoughts' text only, on the last slide", async () => {
  const { session } = make();
  await toReact(session);
  session.afterthought(A, 'first thought');
  session.afterthought(B, 'second thought');
  session.advance(); // walk
  const w = session.state.walk;
  const last = w.stream.length - 1;
  for (let i = 0; i < last; i++) {
    session.moveTo(i);
    const p = session.view('projector');
    assert.equal('afterthoughts' in p.walk, false);
    assert.equal(JSON.stringify(p).includes('thought'), false);
  }
  session.moveTo(last);
  const p = session.view('projector');
  assert.deepEqual(p.walk.afterthoughts, [{ text: 'first thought' }, { text: 'second thought' }]);
  // The facilitator sees them with their ids, to remove one.
  const f = session.view('facilitator').walk.afterthoughts;
  assert.deepEqual(f.map((t) => t.text), ['first thought', 'second thought']);
  for (const t of f) assert.deepEqual(Object.keys(t).sort(), ['id', 'text']);
  session.removeAfterthought(f[0].id);
  assert.deepEqual(session.view('projector').walk.afterthoughts, [{ text: 'second thought' }]);
});

test('the emoji limit is 22: 16 presets plus 6 of your own', async () => {
  const { session } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  const many = (n) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x1f600 + i));
  session.react(A, g, many(22));
  assert.throws(() => session.react(B, g, many(23)), /Up to 22 emojis on a card: remove 1$/);
  assert.throws(() => session.react(B, g, many(25)), /remove 3$/);
});

test('the anonymous pause and move on are gone', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  assert.equal(session.requestPause, undefined);
  assert.equal(session.acceptPause, undefined);
});

test('finale gets the reaction sequence, nothing else', async () => {
  const { session } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0];
  session.react(A, g.id, ['🎉', '😢']);
  session.advance();
  session.advance();
  const v = session.view('projector');
  assert.deepEqual(v.finale.sequence, ['🎉', '😢']);
});

test('pace marker: ahead before the plan, behind after it', () => {
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 4 }), 1);
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 7 }), 0);
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 12 }), -2);
  // Walk-through: 6 minutes over 10 steps; at 17 minutes we should be on step 2 (16.7 to 17.3).
  assert.ok(Math.abs(paceMinutes({ phase: 'walk', elapsedMinutes: 18, walkIndex: 0, walkLength: 10 }) + 1.9) < 1e-9);
  assert.deepEqual(PHASES, ['teaser', 'demo', 'join', 'submit', 'cluster', 'react', 'walk', 'finale', 'shred', 'closing']);
  assert.deepEqual(PLAN.walk, [15.5, 21.5]);
});

test('after the shred, the closing screen comes up by itself', async () => {
  const { session } = make();
  await toReact(session);
  for (let i = 0; i < 2; i++) session.advance();
  session.advance({ confirm: true });
  assert.equal(session.state.phase, 'shred');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(session.state.phase, 'closing');
  assert.equal(session.shredPayload, null);
});

test('speeding up the shred brings the closing screen sooner', async () => {
  let t = 1_000_000;
  const session = new Session({
    now: () => t,
    clusterCards: async (cards) => ({ themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] }),
    shredAnimationMs: null, // the real timeline
  });
  session.advance(); // demo
  session.advance(); // join
  await toReact(session);
  for (let i = 0; i < 2; i++) session.advance(); // walk, finale
  session.advance({ confirm: true });
  const start = session.state.phaseStartedAt;
  const { closingAt } = shredTimeline(session.shredPayload);
  assert.ok(closingAt > 5000);
  // 300 ms before the end on the session's clock, the rest is sped up:
  // the closing comes at t + (closingAt - (t - start)) / 3, 100 ms later.
  t = start + closingAt - 300;
  session.speedUp({ from: 'shred' });
  assert.deepEqual(session.view('projector').speedUp, { at: t, factor: 3 });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(session.state.phase, 'shred');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(session.state.phase, 'closing');
  assert.equal(session.shredPayload, null);
});

test('a new session can start only after the shred', async () => {
  const { session } = make();
  await toReact(session);
  assert.throws(() => session.reset(), /Shred first/);
  for (let i = 0; i < 2; i++) session.advance();
  session.advance({ confirm: true });
  session.advance();
  session.reset();
  assert.equal(session.state.phase, 'teaser');
  assert.equal(session.state.cards.length, 0);
  assert.equal(session.shredded, false);
  session.advance(); // demo
  session.advance(); // join
  session.advance(); // submit
  session.submitCards(A, ['a fresh card']);
  assert.equal(session.state.cards.length, 1);
});

test('approve all uses typed names and reports themes without one', async () => {
  const { session } = make({
    cluster: async (cards) => ({ themes: [{ name: 'Work', groups: [[cards[0].id]] }, { name: '', groups: [[cards[1].id]] }] }),
  });
  session.advance();
  session.submitCards(A, ['one', 'two']);
  session.advance();
  await flush();
  const [work, unnamed] = session.state.themes;
  assert.throws(() => session.approveAll({}), /1 theme needs a name/);
  assert.equal(work.approved, true);
  assert.equal(unnamed.approved, false);
  session.approveAll({ [unnamed.id]: 'Life' });
  assert.equal(unnamed.name, 'Life');
  assert.equal(unnamed.approved, true);
});

test('the walk-through opens on an overview of the themes', async () => {
  const { session } = make({
    cluster: async (cards) => ({ themes: [{ name: 'Work', groups: [[cards[0].id, cards[1].id]] }, { name: 'Life', groups: [[cards[2].id]] }] }),
  });
  await toReact(session);
  session.approveAll({});
  const groups = session.view('phone', { cid: A }).react.groups;
  session.react(A, groups.find((g) => g.texts.length === 1).id, ['🎉', '🙋']);
  session.advance();
  const overview = session.view('projector').walk.item.overview;
  assert.deepEqual(overview, [
    { name: 'Life', cards: 1, reactions: 2 },
    { name: 'Work', cards: 2, reactions: 0 },
  ]);
  session.moveCard(1);
  assert.ok(session.view('projector').walk.item.text);
});

test('an empty submission round is reported as empty, not as missing AI', async () => {
  const { session } = make();
  session.advance();
  session.advance();
  assert.equal(session.state.clustering.empty, true);
  assert.equal(session.state.clustering.local, false);
});

test('the projector gets a section timer while there is time left', () => {
  const { session } = make();
  session.advance();
  assert.equal(session.view('projector').section.endsAt, session.state.submitEndsAt);
});

test('each session has its own id, kept through the shred, new after a reset', async () => {
  const { session } = make();
  const first = session.view('phone', { cid: A }).session;
  assert.match(first, /^[0-9a-f]{16}$/);
  await toReact(session);
  for (let i = 0; i < 2; i++) session.advance();
  session.advance({ confirm: true });
  assert.equal(session.view('phone', { cid: A }).session, first);
  session.advance();
  session.reset();
  assert.notEqual(session.view('phone', { cid: A }).session, first);
});

test('a phone can go back and change its reactions to a card', async () => {
  const { session } = make();
  await toReact(session);
  const [g1, g2] = session.view('phone', { cid: A }).react.groups;
  const { receipt } = session.react(A, g1.id, ['😢', '🫂']);
  assert.match(receipt, /^[0-9a-f]{16}$/);
  session.react(A, g2.id, ['🎉']);
  // Back to the first card: swap the reactions, keep the other card's.
  session.react(A, g1.id, ['🎉'], receipt);
  assert.deepEqual(session.emojiMix(g1.id), [['🎉', 1]]);
  assert.deepEqual(session.emojiMix(g2.id), [['🎉', 1]]);
  // Changing doesn't use up the one pass.
  assert.equal(session.state.clients[A].reacted, 2);
  // A receipt only works for its own card.
  assert.throws(() => session.react(B, g2.id, ['🎉'], receipt), /Nothing to change/);
  assert.throws(() => session.react(B, g1.id, ['🎉'], 'feedfacefeedface'), /Nothing to change/);
  // Receipts carry no phone id.
  assert.equal(JSON.stringify(session.state.receipts).includes(A), false);
});

test('cards are kept in id order, so storage never shows who sent which together', () => {
  const { session } = make();
  session.advance();
  session.submitCards(A, ['a1', 'a2', 'a3']);
  session.submitCards(B, ['b1', 'b2', 'b3']);
  const ids = session.state.cards.map((c) => c.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
});

test('phone ids are hex only, so object built-ins can never be one', () => {
  const { session } = make();
  session.advance();
  for (const bad of ['__proto__', 'constructor', 'hasOwnProperty', 'phone-aaaaaaaa']) {
    assert.throws(() => session.submitCards(bad, ['x']), /phone id/);
  }
  assert.equal({}.cards, undefined);
});

test('going back to grouping after hiding a card keeps the groups, names and reactions', async () => {
  const { session } = make();
  await toReact(session);
  session.back(); // cluster
  session.approveAll({ [session.state.themes[0].id]: 'Named' });
  session.advance(); // react
  const [g1] = session.view('phone', { cid: A }).react.groups;
  session.react(A, g1.id, ['🙋']);
  const before = JSON.stringify(session.state.themes.map((t) => t.groups.map((g) => g.id)));
  session.hideCard(session.state.cards.find((c) => !g1.texts.includes(c.text)).id, true);
  session.back(); // cluster
  await flush();
  assert.equal(JSON.stringify(session.state.themes.map((t) => t.groups.map((g) => g.id))), before);
  assert.equal(session.state.themes[0].name, 'Named');
  assert.deepEqual(session.emojiMix(g1.id), [['🙋', 1]]);
});

test('going back to grouping places new cards; existing groups, names and reactions stay', async () => {
  let groupings = 0;
  const { session } = make({
    cluster: async (cards) => {
      groupings += 1;
      return { themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] };
    },
  });
  await toReact(session);
  session.approveAll({});
  const [g1] = session.view('phone', { cid: A }).react.groups;
  session.react(A, g1.id, ['🙋']);
  const before = session.state.themes.flatMap((t) => t.groups.map((g) => g.id));
  session.back(); // cluster
  session.back(); // submit
  session.submitCards(B, ['four']);
  session.advance(); // cluster
  await flush();
  assert.equal(groupings, 1);
  assert.equal(session.state.clustering.late.status, 'done');
  const groups = session.state.themes.flatMap((t) => t.groups);
  assert.equal(groups.flatMap((g) => g.cardIds).length, 4);
  assert.deepEqual(groups.map((g) => g.id).slice(0, before.length), before);
  assert.equal(session.state.themes[0].approved, true);
  assert.deepEqual(session.emojiMix(g1.id), [['🙋', 1]]);
});

test('the facilitator can skip a slow grouping; its late result is ignored', async () => {
  let finish;
  const { session } = make({ cluster: () => new Promise((r) => (finish = r)) });
  session.advance();
  session.submitCards(A, ['one', 'two']);
  assert.throws(() => session.skipClustering(), /not running/);
  session.advance(); // cluster
  await flush();
  assert.equal(session.state.clustering.status, 'running');
  session.skipClustering();
  assert.equal(session.state.clustering.status, 'failed');
  assert.equal(session.state.clustering.error, SKIPPED);
  assert.equal(session.state.themes.flatMap((t) => t.groups).length, 2);
  finish({ themes: [{ name: 'Late', groups: [session.state.cards.map((c) => c.id)] }] });
  await flush();
  assert.equal(session.state.themes[0].name, '');
  session.advance(); // react: no longer blocked
  assert.equal(session.state.phase, 'react');
});

test('going back to the walk-through does not restart its section timer', async () => {
  const { session, clock } = make();
  await toReact(session);
  session.advance(); // walk
  const endsAt = session.view('projector').section.endsAt;
  clock.tick(120_000);
  session.advance(); // finale
  clock.tick(30_000);
  session.back(); // walk
  assert.equal(session.view('projector').section.endsAt, endsAt);
});

const HAIKU = 'Snow on the keyboard / we all stare at the same screen / thaw comes late again';
const withHaiku = (haiku) => async (cards) => ({ themes: [{ name: 'Work', haiku, groups: cards.map((c) => [c.id]) }] });

test('a haiku is cleaned: newlines become " / ", too long is dropped', async () => {
  assert.equal(cleanHaiku(42), '');
  assert.equal(cleanHaiku('  one\ntwo \r\n three  '), 'one / two / three');
  assert.equal(cleanHaiku('a   b'), 'a b');
  assert.equal(cleanHaiku('abc\n'), 'abc');
  assert.equal(cleanHaiku('\nabc'), 'abc');
  assert.equal(cleanHaiku('x'.repeat(121)), '');
  assert.equal(cleanHaiku('x'.repeat(120)).length, 120);
  const themes = normalizeClusters([{ name: 'W', haiku: 'a\nb\nc', groups: [[1]] }], [1]);
  assert.equal(themes[0].haiku, 'a / b / c');
  assert.equal(normalizeClusters([], [1])[0].haiku, '');
});

test('the facilitator can edit or clear a haiku; approving covers both', async () => {
  const { session } = make({ cluster: withHaiku(HAIKU) });
  await toReact(session);
  const t = session.state.themes[0];
  assert.equal(t.haiku, HAIKU);
  assert.equal(t.approved, false);
  assert.throws(() => session.approveTheme(t.id, 'Work', 'x'.repeat(121)), /Haiku are up to 120 characters/);
  assert.equal(t.approved, false);
  session.approveTheme(t.id, 'Work', 'my own / haiku / here');
  assert.equal(t.haiku, 'my own / haiku / here');
  assert.equal(t.approved, true);
  session.approveTheme(t.id, 'Work', '');
  assert.equal(t.haiku, '');
  session.approveTheme(t.id, 'Work', 'kept / as / is');
  session.approveTheme(t.id, 'Work');
  assert.equal(t.haiku, 'kept / as / is');
  session.approveAll({}, { [t.id]: 'typed / in / bulk' });
  assert.equal(t.haiku, 'typed / in / bulk');
  assert.throws(() => session.approveAll({}, { [t.id]: 'x'.repeat(121) }), /Haiku are up to 120 characters/);
  assert.equal(session.view('facilitator').themes[0].haiku, 'typed / in / bulk');
});

test("the projector shows an approved theme's haiku on its cards, never on the overview; phones never get it", async () => {
  const { session } = make({ cluster: withHaiku(HAIKU) });
  const phoneJson = () => JSON.stringify([A, B].map((cid) => session.view('phone', { cid })));
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  session.submitCards(B, ['three']);
  session.advance(); // cluster
  await flush();
  assert.equal(phoneJson().includes('Snow on the keyboard'), false);
  session.advance(); // react
  assert.equal(phoneJson().includes('Snow on the keyboard'), false);
  session.approveAll({});
  session.advance(); // walk
  assert.equal(phoneJson().includes('Snow on the keyboard'), false);
  const overview = session.view('projector').walk.item;
  assert.ok(overview.overview);
  assert.equal(JSON.stringify(overview).includes('Snow on the keyboard'), false);
  session.moveCard(1);
  assert.equal(session.view('projector').walk.item.haiku, HAIKU);
  assert.equal(phoneJson().includes('Snow on the keyboard'), false);
});

test('a theme without a haiku shows none on the projector', async () => {
  const { session } = make({ cluster: withHaiku('') });
  await toReact(session);
  session.approveAll({});
  session.advance();
  session.moveCard(1);
  assert.equal('haiku' in session.view('projector').walk.item, false);
});

// Hex phone ids for a crowd.
const phone = (i) => i.toString(16).padStart(24, '0');

// A room with `count` distinct cards, each its own group, in reactions.
async function toReactWith(session, count) {
  session.advance(); // submit
  for (let i = 0; i < count; i += 3) {
    session.submitCards(phone(i + 1), Array.from({ length: Math.min(3, count - i) }, (_, j) => `card ${i + j}`));
  }
  session.advance(); // cluster
  await flush();
  session.advance(); // react
}

test('a phone can react to deckSize cards, no more', async () => {
  const { session } = make();
  await toReactWith(session, 35);
  const v = session.view('phone', { cid: A }).react;
  assert.equal(v.groups.length, 35);
  assert.equal(v.deckSize, 30); // 5 minutes: (300 - 60) / 8
  const receipts = v.groups.slice(0, 30).map((g) => session.react(A, g.id, ['🙋']).receipt);
  assert.throws(() => session.react(A, v.groups[30].id, ['🙋']), /You have reacted to every card in your deck/);
  // Changing a card already sent still works past the limit.
  session.react(A, v.groups[0].id, ['🎉'], receipts[0]);
  assert.deepEqual(session.emojiMix(v.groups[0].id), [['🎉', 1]]);
  // Another phone's sends count against its own deck, not A's.
  assert.match(session.react(B, v.groups[34].id, ['🙋']).receipt, /^[0-9a-f]{16}$/);
  assert.deepEqual(session.emojiMix(v.groups[34].id), [['🙋', 1]]);
  assert.equal(session.state.clients[B].reacted, 1);
  // Fewer cards than the deck size: every card.
  const small = make().session;
  await toReact(small);
  assert.equal(small.view('phone', { cid: A }).react.deckSize, 3);
});

test("the deck size is fixed when reactions start; +1 minute doesn't change it", async () => {
  const { session, clock } = make();
  await toReactWith(session, 35);
  assert.equal(session.state.deckSize, 30);
  const f = session.view('facilitator').react;
  assert.equal(f.deckSize, 30);
  assert.equal(f.total, 35);
  clock.tick(4 * 60_000);
  session.extendReact();
  assert.equal(session.view('phone', { cid: A }).react.deckSize, 30);
  // Back from the walk-through keeps it (with a minute added to the window).
  session.advance(); // walk
  session.back(); // react
  assert.equal(session.view('phone', { cid: A }).react.deckSize, 30);
  assert.equal(session.view('facilitator').react.deckSize, 30);
  // A session saved before decks had a size gets one when it loads.
  const saved = JSON.parse(JSON.stringify(session.state));
  delete saved.deckSize;
  const loaded = new Session({ state: saved, now: clock.now });
  assert.equal(loaded.view('phone', { cid: A }).react.deckSize, 30);
  assert.equal(loaded.view('facilitator').react.deckSize, 30);
  const groups = loaded.view('phone', { cid: C }).react.groups;
  for (const g of groups.slice(0, 30)) loaded.react(C, g.id, ['🙋']);
  assert.throws(() => loaded.react(C, groups[30].id, ['🙋']), /every card in your deck/);
});

test('a card hidden mid-reaction shrinks the deck without stranding a phone', async () => {
  // Fewer cards than the deck size: the deck shrinks with the cards.
  const { session } = make();
  await toReact(session); // 3 cards, deck of 3
  const [first, ...rest] = session.view('phone', { cid: A }).react.groups;
  session.react(A, first.id, ['🙋']);
  session.hideCard(session.findGroup(first.id).group.cardIds[0], true);
  const v = session.view('phone', { cid: A }).react;
  assert.equal(v.groups.length, 2);
  // A's deck, as the phone works it out: "Card n of 2".
  const aDeck = deck(v.groups.map((g) => g.id), 'seed-a', v.deckSize, new Set([first.id]));
  assert.deepEqual([...aDeck].sort((x, y) => x - y), rest.map((g) => g.id).sort((x, y) => x - y));
  // A has spent one send on the hidden card and can still react to both left.
  for (const g of rest) session.react(A, g.id, ['🙋']);
  // A phone that hadn't started reacts to the two left, and no more.
  for (const g of rest) session.react(B, g.id, ['🙋']);
  assert.throws(() => session.react(B, first.id, ['🙋']), /No such card/);

  // More cards than the deck size: the next card fills the hidden one's slot.
  const big = make().session;
  await toReactWith(big, 35);
  const groups = big.view('phone', { cid: A }).react.groups;
  for (const g of groups.slice(0, 30)) big.react(A, g.id, ['🙋']);
  big.hideCard(big.findGroup(groups[0].id).group.cardIds[0], true);
  // Still a deck of 30 among the 34 left, so A can react to the card that moved up.
  const after = big.view('phone', { cid: A }).react;
  assert.equal(after.groups.length, 34);
  assert.equal(after.deckSize, 30);
  big.react(A, groups[30].id, ['🙋']);
  assert.throws(() => big.react(A, groups[31].id, ['🙋']), /every card in your deck/);
});

// A phone working through its deck the way phone.js does: its own deck from
// the visible cards and the cards it has reacted to, one first send per card.
function reactThroughDeck(session, cid, seed, reacted, max = Infinity) {
  const v = session.view('phone', { cid }).react;
  const mine = deck(v.groups.map((g) => g.id), seed, v.deckSize, reacted);
  let refused = 0;
  for (const id of mine) {
    if (reacted.has(id) || reacted.size >= max) continue;
    try {
      session.react(cid, id, ['🙋']);
      reacted.add(id);
    } catch {
      refused += 1;
    }
  }
  return { deck: mine, refused };
}

test('late cards never push a reacted card out of a deck, so no send is refused', async () => {
  const { session } = make();
  await toReactWith(session, 35);
  const phones = Array.from({ length: 40 }, (_, i) => ({ cid: phone(1000 + i), seed: `seed-${i}`, reacted: new Set() }));
  for (const p of phones) reactThroughDeck(session, p.cid, p.seed, p.reacted, 25);
  assert.ok(phones.every((p) => p.reacted.size === 25));
  session.back(); // cluster
  session.back(); // submit
  session.submitCards(phone(500), ['late 1', 'late 2', 'late 3']);
  session.submitCards(phone(501), ['late 4', 'late 5', 'late 6']);
  session.submitCards(phone(502), ['late 7', 'late 8']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  assert.equal(session.view('phone', { cid: A }).react.groups.length, 43);
  for (const p of phones) {
    const { deck: mine, refused } = reactThroughDeck(session, p.cid, p.seed, p.reacted);
    assert.equal(refused, 0);
    assert.equal(mine.length, 30);
    // Every card the phone reacted to is still in its deck.
    assert.equal(p.reacted.size, 30);
    assert.ok([...p.reacted].every((id) => mine.includes(id)));
  }
});

test('a card unhidden mid-reaction joins every deck when there is time for it', async () => {
  const { session } = make();
  session.advance(); // submit
  for (let i = 0; i < 10; i += 3) session.submitCards(phone(i + 1), Array.from({ length: Math.min(3, 10 - i) }, (_, j) => `card ${i + j}`));
  session.advance(); // cluster
  await flush();
  const hidden = session.state.cards[0].id;
  session.hideCard(hidden, true);
  session.advance(); // react
  assert.equal(session.view('phone', { cid: A }).react.deckSize, 9);
  assert.equal(session.view('facilitator').react.deckSize, 9);
  session.hideCard(hidden, false);
  const v = session.view('phone', { cid: A }).react;
  assert.equal(v.groups.length, 10);
  assert.equal(v.deckSize, 10);
  assert.equal(session.view('facilitator').react.deckSize, 10);
  for (let i = 0; i < 5; i++) {
    const p = { cid: phone(2000 + i), seed: `seed-${i}`, reacted: new Set() };
    const { deck: mine, refused } = reactThroughDeck(session, p.cid, p.seed, p.reacted);
    assert.equal(mine.length, 10);
    assert.equal(refused, 0);
  }
});

// A phone moving through its deck the way phone.js does: Next from the card
// it last showed (the place is kept by card), and past the end, the first
// card in its deck it hasn't seen, before finishing; Next from such a card
// goes on to the next one not seen, or the end.
function navigate(session, p, maxSteps = 50) {
  for (let n = 0; n < maxSteps; n++) {
    const v = session.view('phone', { cid: p.cid }).react;
    const ids = deck(v.groups.map((g) => g.id), p.seed, v.deckSize, p.reacted);
    let next = p.shown === null ? 0 : p.catchingUp ? ids.length : ids.indexOf(p.shown) + 1;
    if (next >= ids.length) {
      const end = deckEnd(ids, v.groups.length, p.seen);
      if (end.unseen === null) return { finished: true, everyCard: end.everyCard };
      next = ids.indexOf(end.unseen);
      p.catchingUp = true;
    }
    p.shown = ids[next];
    p.seen.add(p.shown);
    if (!p.reacted.has(p.shown)) {
      session.react(p.cid, p.shown, ['🙋']);
      p.reacted.add(p.shown);
    }
  }
  return { finished: false };
}

test('a card unhidden behind a phone is still reached before the end of its deck', async () => {
  const { session } = make();
  session.advance(); // submit
  for (let i = 0; i < 10; i += 3) session.submitCards(phone(i + 1), Array.from({ length: Math.min(3, 10 - i) }, (_, j) => `card ${i + j}`));
  session.advance(); // cluster
  await flush();
  const card = session.state.cards[0];
  session.hideCard(card.id, true);
  session.advance(); // react
  const groupId = session.state.themes.flatMap((t) => t.groups).find((g) => g.cardIds.includes(card.id)).id;
  const phones = Array.from({ length: 20 }, (_, i) => ({ cid: phone(3000 + i), seed: `seed-${i}`, reacted: new Set(), seen: new Set(), shown: null }));
  for (const p of phones) navigate(session, p, 5);
  session.hideCard(card.id, false);
  // For some phones the card lands behind where they are.
  const behind = phones.filter((p) => {
    const ids = deck(session.view('phone', { cid: p.cid }).react.groups.map((g) => g.id), p.seed, 10, p.reacted);
    return ids.indexOf(groupId) < ids.indexOf(p.shown);
  });
  assert.ok(behind.length > 0);
  for (const p of phones) {
    const end = navigate(session, p);
    assert.deepEqual(end, { finished: true, everyCard: true });
    assert.equal(p.seen.size, 10);
    assert.ok(p.seen.has(groupId));
  }
});

test('finishing is reset when reactions start again from grouping, kept when coming back from the walk-through', async () => {
  const { session } = make();
  await toReact(session);
  session.reactDone(A);
  session.advance(); // walk
  session.back(); // react
  assert.equal(session.state.clients[A].reactDone, true);
  assert.equal(session.view('phone', { cid: A }).react.done, true);
  session.back(); // cluster
  session.back(); // submit
  session.submitCards(C, ['late']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  assert.equal(session.state.clients[A].reactDone, false);
  assert.equal(session.view('phone', { cid: A }).react.done, false);
  assert.equal(session.view('facilitator').react.done, 0);
});

// ---- the quiet count of people writing ------------------------------------

test('writing counts phones that typed in the last 20 seconds', () => {
  const { session, clock, changes } = make();
  session.advance(); // submit
  session.typing(A);
  clock.tick(15_000);
  session.typing(B);
  assert.equal(session.view('projector').writing, 2);
  assert.equal(session.view('facilitator').writing, 2);
  clock.tick(6_000); // A's last keystroke is now 21 seconds old
  assert.equal(session.view('projector').writing, 1);
  session.typing(B);
  session.typing(B); // the same phone twice is still one person
  assert.equal(session.view('projector').writing, 1);
  // Not a phase that counts, a bad id, or text smuggled in: nothing recorded, no error.
  assert.throws(() => session.typing('nope'), /Missing phone id/);
  assert.throws(() => session.typing('__proto__'), /Missing phone id/);
  session.typing(C, 'secret text');
  assert.deepEqual(Object.keys(session.activity.get(C)).sort(), ['typedAt', 'unsent']);
  assert.equal(JSON.stringify([...session.activity]).includes('secret'), false);
  // Join: the notepad is open and typing counts, but no screen shows the count
  // until Submit, and nothing is broadcast for it.
  session.back();
  clock.tick(30_000);
  session.tick();
  const before = changes();
  session.typing(A);
  session.tick();
  assert.equal(changes(), before, 'nothing shown, nothing broadcast');
  assert.equal(session.view('projector').writing, undefined);
  assert.equal(session.view('facilitator').writing, undefined);
  session.advance(); // submit
  assert.equal(session.view('projector').writing, 1, 'typing at Join counts once the room reaches Submit');
});

test('the count falls on its own, broadcast by tick', () => {
  const { session, clock, changes } = make();
  session.advance(); // submit
  session.typing(A);
  const before = changes();
  session.tick();
  assert.equal(changes(), before, 'nothing changed, nothing broadcast');
  clock.tick(21_000);
  session.tick();
  assert.equal(changes(), before + 1, 'the count fell, so one broadcast');
  assert.equal(session.view('projector').writing, 0);
  session.tick();
  assert.equal(changes(), before + 1);
  assert.equal(session.activity.size, 0, 'old entries are dropped');
});

test('unsent thoughts are counted for the facilitator only', async () => {
  const { session, clock, changes } = make();
  await toReact(session);
  session.unsent(A, true);
  session.unsent(B, true);
  session.unsent(B, true);
  assert.equal(session.view('facilitator').unsent, 2);
  assert.equal(session.view('projector').unsent, undefined);
  assert.equal(session.view('phone', { cid: A }).unsent, undefined);
  assert.equal(session.view('phone', { cid: A }).writing, undefined);
  clock.tick(60_000);
  session.tick();
  assert.equal(session.view('facilitator').unsent, 2, 'an unsent thought outlasts the typing window');
  const before = changes();
  session.unsent(A, false);
  assert.equal(session.view('facilitator').unsent, 1);
  assert.equal(changes(), before + 1);
  session.advance(); // walk: the room moved on
  assert.equal(session.view('facilitator').unsent, undefined);
  session.back();
  assert.equal(session.view('facilitator').unsent, 0, 'leaving react forgets who was unsent');
  session.unsent(C, true);
  session.advance();
  session.unsent(C, true); // not react: ignored
  assert.equal(session.activity.get(C)?.unsent ?? false, false);
});

test('phones never receive the writing count', async () => {
  const { session } = make();
  session.advance();
  session.typing(A);
  assert.equal(JSON.stringify(session.view('phone', { cid: A })).includes('writing'), false);
  await flush();
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  session.typing(A);
  session.unsent(A, true);
  const v = session.view('phone', { cid: A });
  assert.equal('writing' in v || 'unsent' in v || 'writing' in (v.react ?? {}) || 'unsent' in (v.react ?? {}), false);
});

test('the writing count is memory only: never in the saved state, gone at the shred and the reset', async () => {
  const { session } = make();
  await toReact(session);
  session.typing(A);
  session.unsent(B, true);
  const saved = JSON.stringify(session.state);
  assert.equal(/typedAt|activity|unsent/.test(saved), false, 'nothing about typing is in the persisted state');
  session.advance();
  session.advance();
  session.advance({ confirm: true });
  assert.equal(session.activity.size, 0);
  session.reset();
  assert.equal(session.activity.size, 0);
  assert.equal(session.view('facilitator').writing, undefined);
});
