import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.js';
import { PLAN } from '../server/phases.js';
import { finaleTimeline } from '../public/shared/finale-timing.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const MIN = 60_000;

function make() {
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => (t += ms) };
  const session = new Session({
    now: clock.now,
    clusterCards: async (cards) => ({ themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] }),
    shredAnimationMs: 10,
  });
  return { session, clock };
}

const flush = () => new Promise((r) => setImmediate(r));
const facilitator = (session, phoneCount = 0) => session.view('facilitator', { phoneCount });

async function toReact(session) {
  session.advance(); // join
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
}

test('a session starts on the demo, before join', () => {
  const { session } = make();
  assert.equal(session.state.phase, 'demo');
  assert.deepEqual(Object.keys(session.view('phone', { cid: A })).sort(), ['now', 'phase', 'role', 'session']);
  session.advance();
  assert.equal(session.state.phase, 'join');
});

test('the talk clock starts with one tap and never restarts', () => {
  const { session, clock } = make();
  const first = clock.now();
  session.startTalk();
  clock.tick(MIN);
  session.startTalk();
  assert.equal(session.state.talk.startedAt, first);
  assert.equal(facilitator(session).talk.startedAt, first);
  assert.equal(facilitator(session).talk.minutes, 25);
});

test('the talk length can be set', () => {
  const session = new Session({ now: () => 5, clusterCards: async () => ({ themes: [] }), talkMinutes: 12 });
  assert.equal(session.state.talk.minutes, 12);
});

test('without a tap, the talk clock starts backdated when the room moves on', () => {
  const { session, clock } = make();
  assert.equal(session.state.talk.startedAt, null);
  session.advance(); // join
  assert.equal(session.state.talk.startedAt, clock.now() - PLAN.join[0] * MIN);
  assert.equal(session.state.talk.startedAt, clock.now() - 3.5 * MIN);
});

test('a tapped talk clock is not backdated', () => {
  const { session, clock } = make();
  const first = clock.now();
  session.startTalk();
  clock.tick(2 * MIN);
  session.advance();
  assert.equal(session.state.talk.startedAt, first);
});

test('submissions and reactions get 5 minutes; +1 minute extends them', async () => {
  const { session, clock } = make();
  session.advance();
  session.advance(); // submit
  assert.equal(session.state.submitEndsAt, clock.now() + 5 * MIN);
  session.extendSubmit();
  assert.equal(session.state.submitEndsAt, clock.now() + 6 * MIN);
  session.submitCards(A, ['one']);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  assert.equal(session.state.reactEndsAt, clock.now() + 5 * MIN);
  assert.equal(session.view('phone', { cid: A }).react.endsAt, session.state.reactEndsAt);
  session.extendReact();
  assert.equal(session.state.reactEndsAt, clock.now() + 6 * MIN);
  assert.equal(facilitator(session).react.endsAt, session.state.reactEndsAt);
  assert.throws(() => session.extendSubmit(), /not open/);
});

test('at time, the facilitator is asked and the part stays open', () => {
  const { session, clock } = make();
  session.advance();
  session.advance(); // submit
  assert.equal(facilitator(session).move, null);
  assert.equal(session.view('projector').waiting, false);
  clock.tick(5 * MIN);
  session.tick();
  assert.deepEqual(facilitator(session).move, { to: 'cluster', label: 'Ready for grouping?' });
  assert.equal(session.view('projector').waiting, true);
  session.submitCards(A, ['late but welcome']);
  assert.equal(session.state.cards.length, 1);
});

test('+1 minute after the time is up clears the prompt', () => {
  const { session, clock } = make();
  session.advance();
  session.advance();
  clock.tick(5 * MIN + 1000);
  session.tick();
  assert.notEqual(facilitator(session).move, null);
  session.extendSubmit();
  assert.equal(facilitator(session).move, null);
  assert.equal(session.view('phone', { cid: A }).submit.endsAt, clock.now() + MIN);
});

test('everyone finished reacting prompts early', async () => {
  const { session } = make();
  await toReact(session);
  session.reactDone(A);
  session.reactDone(B);
  session.tick();
  assert.equal(facilitator(session, 2).move.label, 'Ready for the walk-through?');
  assert.deepEqual(facilitator(session, 2).move.to, 'walk');
  assert.equal(facilitator(session, 3).move, null);
  assert.equal(facilitator(session, 0).move, null);
  assert.equal(session.view('projector', { phoneCount: 2 }).waiting, true);
  session.reactDone(C);
  assert.notEqual(facilitator(session, 3).move, null);
});

test('reactions are accepted for 10 seconds after they close', async () => {
  const { session, clock } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  session.advance(); // walk
  clock.tick(9000);
  session.react(A, g, ['🙋']);
  clock.tick(2000);
  assert.throws(() => session.react(B, g, ['🙋']), /Reactions are closed/);
});

test('a second tap on the same move is ignored', async () => {
  const { session } = make();
  session.advance();
  session.advance(); // submit
  session.advance({ from: 'submit' });
  assert.equal(session.state.phase, 'cluster');
  assert.throws(() => session.advance({ from: 'submit' }), /Already moved on/);
  assert.equal(session.state.phase, 'cluster');
  await flush();
});

test('a second tap on Back is ignored', async () => {
  const { session } = make();
  await toReact(session);
  session.back({ from: 'react' });
  assert.equal(session.state.phase, 'cluster');
  assert.throws(() => session.back({ from: 'react' }), /Already moved on/);
  assert.equal(session.state.phase, 'cluster');
});

test('the finale asks for the shred once it has played', async () => {
  const { session, clock } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  session.react(A, g, ['🙋', '🦆']);
  session.advance(); // walk
  session.advance(); // finale
  const { doneAt } = finaleTimeline(2);
  clock.tick(doneAt - 1);
  assert.equal(facilitator(session).move, null);
  assert.equal(session.view('projector').waiting, false);
  clock.tick(1);
  assert.deepEqual(facilitator(session).move, { to: 'shred', label: 'Ready to shred?' });
});

test('finale timeline: replay is 400 ms an emoji up to 10 seconds', () => {
  const base = 1200 + 2000 + 1300 + 8000;
  assert.equal(finaleTimeline(10).doneAt, base + 4000);
  assert.equal(finaleTimeline(100).doneAt, base + 10_000);
  assert.equal(finaleTimeline(5000).doneAt, base + 10_000);
});

test('phones never get the talk clock or the pending move', async () => {
  const { session, clock } = make();
  session.startTalk();
  session.advance();
  session.advance();
  clock.tick(6 * MIN);
  const text = JSON.stringify(session.view('phone', { cid: A }));
  assert.equal(/talk|move|waiting|pace/.test(text), false);
});
