import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, normalizeClusters, cleanHaiku, SKIPPED } from '../server/session.js';
import { paceMinutes, PHASES, PLAN } from '../server/phases.js';
import { shredTimeline } from '../public/shared/shred-timing.js';

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
  const { session } = make();
  assert.throws(() => session.submitCards(A, ['early']), /closed/);
  session.advance();
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
  const copy = new Session({ now: clock.now, clusterCards: async () => ({ themes: [] }), state: saved });
  assert.equal(JSON.stringify(copy.state).includes('an old comment'), false);
  assert.equal('removedComments' in copy.state, false);
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
