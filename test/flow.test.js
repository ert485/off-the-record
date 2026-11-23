import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.js';
import { PLAN } from '../server/phases.js';
import { finaleTimeline, arrivalMs } from '../public/shared/finale-timing.js';
import { shredTimeline } from '../public/shared/shred-timing.js';

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
  session.advance(); // teaser to demo
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

test('a session starts on the teaser, then the demo, before join', () => {
  const { session } = make();
  assert.equal(session.state.phase, 'demo');
  assert.deepEqual(Object.keys(session.view('phone', { cid: A })).sort(), ['now', 'phase', 'role', 'session']);
  session.advance();
  assert.equal(session.state.phase, 'join');
  const fresh = new Session({ now: () => 1, clusterCards: async () => ({ themes: [] }) });
  assert.equal(fresh.state.phase, 'teaser');
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

test('finale timeline: replay is 400 ms an emoji up to 5.6 seconds', () => {
  const base = 600 + 700 + 1800 + 3200;
  assert.equal(finaleTimeline(10).doneAt, base + 4000);
  assert.equal(finaleTimeline(100).doneAt, base + 5600);
  assert.equal(finaleTimeline(5000).doneAt, base + 5600);
  assert.equal(finaleTimeline(0).doneAt, 600 + 3200);
});

test('the replay is slow at first, quicker in the middle, slow at the end', () => {
  const n = 400;
  const { replayMs } = finaleTimeline(n);
  const at = Array.from({ length: n }, (_, i) => arrivalMs(i, n, replayMs));
  const gap = (i) => at[i + 1] - at[i];
  assert.ok(at[0] >= 0 && at.at(-1) <= replayMs);
  assert.ok(at.every((t, i) => i === 0 || t > at[i - 1]));
  assert.ok(gap(0) > 3 * gap(n / 2));
  assert.ok(gap(n - 2) > 3 * gap(n / 2));
});

test('the finale and the shred take about 30 seconds with a full room, less with fewer cards', () => {
  const finale = finaleTimeline(400).doneAt;
  const cards = Array.from({ length: 60 }, (_, i) => `card ${i}`);
  const shred = shredTimeline({ emojis: [['🎉', 3]], cards }).closingAt;
  assert.ok(Math.abs(finale - 12_000) <= 500, `finale ${finale}`);
  assert.ok(Math.abs(shred - 18_000) <= 500, `shred ${shred}`);
  assert.ok(Math.abs(finale + shred - 30_000) <= 1000);
  // The sheets take about 11 seconds however many cards; the middle ones go faster.
  const { sheets } = shredTimeline({ emojis: [['🎉', 3]], cards: [...cards, ...cards] });
  assert.equal(sheets.length, 7);
  const end = sheets.at(-1).pullAt + sheets.at(-1).pullMs;
  assert.ok(Math.abs(end - sheets[0].at - 11_000) <= 500);
  assert.ok(sheets[0].pullMs > 1.5 * sheets[3].pullMs);
  // A few cards: shorter.
  assert.ok(shredTimeline({ emojis: [['🎉', 1]], cards: ['one', 'two'] }).closingAt < shred - 4000);
  assert.ok(finaleTimeline(8).doneAt < finale);
});

test('speeding up the finale brings the shred prompt sooner', async () => {
  const { session, clock } = make();
  await toReact(session);
  const g = session.view('phone', { cid: A }).react.groups[0].id;
  session.react(A, g, ['🙋', '🦆']);
  session.advance(); // walk
  session.advance(); // finale
  const start = session.state.phaseStartedAt;
  const { doneAt } = finaleTimeline(2);
  assert.equal(facilitator(session).speedUp, null);
  assert.equal(session.view('projector').speedUp, null);
  clock.tick(3000);
  session.speedUp({ from: 'finale' });
  const t = start + 3000;
  assert.deepEqual(facilitator(session).speedUp, { at: t, factor: 3 });
  assert.deepEqual(session.view('projector').speedUp, { at: t, factor: 3 });
  assert.equal('speedUp' in session.view('phone', { cid: A }), false);
  const promptAt = t + (doneAt - 3000) / 3;
  clock.tick(promptAt - 1 - clock.now());
  assert.equal(facilitator(session).move, null);
  clock.tick(1);
  assert.deepEqual(facilitator(session).move, { to: 'shred', label: 'Ready to shred?' });
});

test('a second speed up does nothing', async () => {
  const { session, clock } = make();
  await toReact(session);
  session.advance(); // walk
  session.advance(); // finale
  clock.tick(1000);
  session.speedUp({ from: 'finale' });
  const first = facilitator(session).speedUp;
  clock.tick(1000);
  session.speedUp({ from: 'finale' });
  assert.deepEqual(facilitator(session).speedUp, first);
});

test('speed up only in the finale and the shred', async () => {
  const { session } = make();
  await toReact(session);
  assert.throws(() => session.speedUp({ from: 'react' }), /only for the finale and the shred/);
  session.advance(); // walk
  assert.throws(() => session.speedUp({ from: 'walk' }), /only for the finale and the shred/);
  session.advance(); // finale
  // A tap from a screen that hasn't caught up yet is ignored.
  assert.throws(() => session.speedUp({ from: 'walk' }), /Already moved on/);
  session.speedUp({ from: 'finale' });
  // Each part starts at its own speed.
  session.back({ from: 'finale' });
  session.advance({ from: 'walk' });
  assert.equal(facilitator(session).speedUp, null);
  session.speedUp({ from: 'finale' });
  session.advance({ from: 'finale', confirm: true });
  assert.equal(facilitator(session).speedUp, null);
  assert.equal(session.view('projector').speedUp, null);
  session.speedUp({ from: 'shred' });
  assert.equal(facilitator(session).speedUp.factor, 3);
  assert.throws(() => session.speedUp({ from: 'finale' }), /Already moved on/);
  session.advance({ from: 'shred' }); // closing
  assert.throws(() => session.speedUp({ from: 'shred' }), /Already moved on/);
  assert.throws(() => session.speedUp({ from: 'closing' }), /only for the finale and the shred/);
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

test('a deadline passing is broadcast even when nothing else happens', async () => {
  let changes = 0;
  let t = 1_000_000;
  const session = new Session({
    now: () => t,
    clusterCards: async (cards) => ({ themes: [{ name: 'All', groups: cards.map((c) => [c.id]) }] }),
    onChange: () => changes++,
  });
  session.advance(); // teaser to demo
  const expectPrompt = (label, to) => {
    t = to;
    const before = changes;
    session.tick();
    assert.equal(changes, before + 1);
    assert.equal(facilitator(session).move.label, label);
    session.tick();
    assert.equal(changes, before + 1);
  };
  session.advance();
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  expectPrompt('Ready for grouping?', session.state.submitEndsAt);
  session.extendSubmit();
  const afterExtend = changes;
  session.tick();
  assert.equal(changes, afterExtend);
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  expectPrompt('Ready for the walk-through?', session.state.reactEndsAt);
  session.advance(); // walk
  session.advance(); // finale
  expectPrompt('Ready to shred?', session.state.phaseStartedAt + finaleTimeline(session.state.reactions.length).doneAt);
});
