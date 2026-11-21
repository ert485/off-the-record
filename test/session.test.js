import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, normalizeClusters, PAUSE } from '../server/session.js';
import { paceMinutes, PHASES } from '../server/phases.js';

const A = 'phone-aaaaaaaa';
const B = 'phone-bbbbbbbb';

function make({ cluster } = {}) {
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
  const { session } = make();
  assert.equal(session.state.phase, 'join');
  assert.throws(() => session.back(), /Nothing to go back/);
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
  session.advance(); // lastcall
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
    { name: 'T', groups: [[1, 2], [3]] },
    { name: 'Other', groups: [[4]] },
  ]);
});

test('reactions are pooled per group and capped at one pass', async () => {
  const { session } = make();
  await toReact(session);
  const groups = session.view('phone', { cid: A }).react.groups;
  assert.equal(groups.length, 3);
  session.react(A, groups[0].id, ['🙋', '🫂', '🙋']);
  session.react(A, groups[1].id, ['🦆']);
  session.react(A, groups[2].id, []);
  assert.throws(() => session.react(A, groups[0].id, ['😂']), /every card/);
  assert.throws(() => session.react(B, groups[0].id, ['hello']), /emojis only/);
  session.reactDone(A);
  assert.equal(session.state.reactions.length, 3);
  assert.equal(session.view('facilitator').react.done, 1);
});

test('walk-through: cards move, signals reset per card, move-on stays private', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  assert.equal(session.state.phase, 'walk');
  session.signal(A, 'stay', true);
  session.signal(B, 'moveOn', true);
  session.signal(B, 'back', true);
  const p = session.view('projector');
  assert.equal(p.walk.stay, 1);
  assert.equal(p.walk.back, 1);
  assert.equal(JSON.stringify(p).includes('moveOn'), false);
  assert.equal(session.view('facilitator').walk.moveOn, 1);
  session.moveCard(1);
  assert.equal(session.view('projector').walk.stay, 0);
  session.moveCard(-1);
  assert.throws(() => session.moveCard(-1), /first card/);
});

test('hidden cards leave the stream and the reaction stack', async () => {
  const { session } = make();
  await toReact(session);
  const card = session.state.cards[0];
  session.hideCard(card.id, true);
  const texts = session.view('phone', { cid: A }).react.groups.flatMap((g) => g.texts);
  assert.equal(texts.includes(card.text), false);
  session.advance();
  assert.equal(session.state.walk.stream.length, 3); // the overview, then 2 cards
  assert.equal(session.state.walk.stream[0].overview, true);
  assert.equal(JSON.stringify(session.view('projector')).includes(card.text), false);
});

test('pause: ends when everyone who opened has submitted (after the minimum)', async () => {
  const { session, clock } = make();
  await toReact(session);
  session.advance();
  session.requestPause(A, true);
  assert.equal(session.view('projector').walk.pauseRequests, 1);
  session.acceptPause();
  assert.equal(session.view('projector').walk.pauseRequests, 0);
  session.openComment(A);
  session.openComment(B);
  session.submitComment(A, 'me too, honestly');
  assert.ok(session.state.pause);
  session.submitComment(B, 'same');
  clock.tick(PAUSE.minMs);
  session.tick();
  assert.equal(session.state.pause, null);
  assert.equal(session.view('projector').walk.comments.length, 2);
});

test('pause: 90 seconds, then 20 seconds grace for anyone still typing', async () => {
  const { session, clock } = make();
  await toReact(session);
  session.advance();
  session.acceptPause();
  session.openComment(A);
  clock.tick(PAUSE.maxMs);
  session.tick();
  assert.ok(session.state.pause.graceAt);
  assert.throws(() => session.openComment(B), /ending/);
  clock.tick(PAUSE.graceMs);
  session.tick();
  assert.equal(session.state.pause, null);
});

test('the facilitator can remove a comment after it appears', async () => {
  const { session } = make();
  await toReact(session);
  session.advance();
  session.acceptPause();
  session.submitComment(A, 'mean comment');
  const id = session.state.comments[0].id;
  session.removeComment(id);
  assert.equal(JSON.stringify(session.state).includes('mean comment'), false);
});

test('finale gets the reaction sequence, nothing else', async () => {
  const { session } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0];
  session.react(A, g.id, ['🎉', '😢']);
  session.advance();
  session.advance();
  session.advance();
  const v = session.view('projector');
  assert.deepEqual(v.finale.sequence, ['🎉', '😢']);
});

test('pace marker: ahead before the plan, behind after it', () => {
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 1 }), 1);
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 4 }), 0);
  assert.equal(paceMinutes({ phase: 'submit', elapsedMinutes: 8 }), -2);
  assert.ok(Math.abs(paceMinutes({ phase: 'walk', elapsedMinutes: 12, walkIndex: 0, walkLength: 10 }) + 1.55) < 1e-9);
  assert.equal(PHASES.length, 9);
});

test('after the shred, the closing screen comes up by itself', async () => {
  const { session } = make();
  await toReact(session);
  for (let i = 0; i < 3; i++) session.advance();
  session.advance({ confirm: true });
  assert.equal(session.state.phase, 'shred');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(session.state.phase, 'closing');
  assert.equal(session.shredPayload, null);
});

test('a new session can start only after the shred', async () => {
  const { session } = make();
  await toReact(session);
  assert.throws(() => session.reset(), /Shred first/);
  for (let i = 0; i < 3; i++) session.advance();
  session.advance({ confirm: true });
  session.advance();
  session.reset();
  assert.equal(session.state.phase, 'join');
  assert.equal(session.state.cards.length, 0);
  assert.equal(session.shredded, false);
  session.advance();
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
  for (let i = 0; i < 3; i++) session.advance();
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
  assert.throws(() => session.react(B, g2.id, [], receipt), /Nothing to change/);
  assert.throws(() => session.react(B, g1.id, [], 'feedfacefeedface'), /Nothing to change/);
  // Receipts carry no phone id.
  assert.equal(JSON.stringify(session.state.receipts).includes(A), false);
});
