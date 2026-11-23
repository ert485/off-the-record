import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const MIN = 60_000;
const flush = () => new Promise((r) => setImmediate(r));

function make() {
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => (t += ms), set: (v) => (t = v) };
  const session = new Session({
    now: clock.now,
    // One group per card, so the stream has one card per submitted note.
    clusterCards: async (list) => ({ themes: [{ name: 'All', groups: list.map((c) => [c.id]) }] }),
    shredAnimationMs: 10,
  });
  session.advance(); // teaser to demo
  return { session, clock };
}

// Starts the talk clock at t0, then walks to the walk-through at `minute` on that clock.
async function toWalk({ cards = 4, minute = 15.5 } = {}) {
  const ctx = make();
  const { session, clock } = ctx;
  const t0 = clock.now();
  session.startTalk();
  session.advance(); // join
  session.advance(); // submit
  const texts = Array.from({ length: cards }, (_, i) => `card ${i}`);
  for (let i = 0; i < texts.length; i += 3) session.submitCards(i === 0 ? A : B, texts.slice(i, i + 3));
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  const groups = session.view('phone', { cid: A }).react.groups;
  groups.forEach((g, i) => session.react(A, g.id, ['🦆'], undefined, i === 0 ? 'hello' : undefined));
  clock.set(t0 + minute * MIN);
  session.advance(); // walk
  return { ...ctx, t0 };
}

const fac = (s) => s.view('facilitator', { phoneCount: 0 });
const proj = (s) => s.view('projector');

test('the walk-through ends at minute 21.5 on the talk clock, never shorter than 3 minutes', async () => {
  const a = await toWalk({ minute: 15.5 });
  assert.equal(a.session.state.walk.endsAt, a.t0 + 21.5 * MIN);
  const b = await toWalk({ minute: 20 });
  assert.equal(b.session.state.walk.endsAt, b.clock.now() + 3 * MIN);
});

test('each card gets the time left divided by the cards left, never under 15 seconds', async () => {
  const a = await toWalk({ cards: 4, minute: 15.5 });
  assert.equal(a.session.state.walk.stream.length, 6); // overview, 4 cards, last slide
  a.clock.set(a.session.state.walk.endsAt - 6 * MIN);
  a.session.moveCard(1);
  a.session.moveCard(-1);
  assert.equal(fac(a.session).walk.cardMs, (6 * MIN - 20_000) / 5);
  const b = await toWalk({ cards: 4, minute: 20.5 });
  b.session.state.walk.stream.splice(1, 0, ...Array.from({ length: 6 }, (_, i) => ({ groupId: 90 + i })));
  b.clock.set(b.session.state.walk.endsAt - MIN);
  b.session.moveCard(1);
  b.session.moveCard(-1);
  assert.equal(fac(b.session).walk.cardMs, 15_000);
});

test('cards advance by themselves; a pause holds the card; resume gives it a fresh share', async () => {
  const { session, clock } = await toWalk();
  const w = () => session.state.walk;
  assert.equal(w().index, 0);
  clock.set(w().cardEndsAt - 1);
  session.tick();
  assert.equal(w().index, 0);
  clock.set(w().cardEndsAt);
  session.tick();
  assert.equal(w().index, 1);

  session.pauseWalk(true);
  assert.equal(w().cardEndsAt, null);
  assert.equal(fac(session).walk.paused, true);
  assert.equal(proj(session).walk.paused, true);
  const endsAt = w().endsAt;
  clock.tick(10 * MIN);
  // Even past the finish, a paused walk holds.
  session.tick();
  assert.equal(w().index, 1);
  session.pauseWalk(false);
  assert.equal(w().paused, false);
  assert.equal(w().endsAt, endsAt);
  assert.ok(Number.isFinite(w().cardEndsAt));
  assert.ok(w().cardEndsAt > clock.now());
});

test('when time runs out with cards left, it skips to the last slide, then asks for the finale', async () => {
  const { session, clock } = await toWalk({ cards: 4 });
  session.moveCard(1);
  session.moveCard(1); // card 2 of 4 (index 2)
  const w = session.state.walk;
  clock.set(w.endsAt - 20_000);
  session.tick();
  assert.equal(proj(session).walk.item.last, true);
  assert.equal(fac(session).move, null);
  clock.set(w.cardEndsAt);
  session.tick();
  assert.equal(w.done, true);
  assert.equal(fac(session).move.label, 'Ready for the finale?');
  assert.equal(fac(session).move.to, 'finale');
});

test("skipped cards' reactions still count in the finale", async () => {
  const { session, clock } = await toWalk({ cards: 4 });
  const reactions = session.state.reactions.length;
  assert.ok(reactions > 0);
  clock.set(session.state.walk.endsAt - 20_000);
  session.tick();
  clock.tick(20_000);
  session.tick();
  session.advance({ from: 'walk' });
  assert.equal(proj(session).finale.sequence.length, reactions);
});

test('back from the last slide returns to the last card; next on the last slide finishes', async () => {
  const { session } = await toWalk({ cards: 2 });
  const last = session.state.walk.stream.length - 1;
  while (session.state.walk.index < last) session.moveCard(1);
  assert.equal(proj(session).walk.item.last, true);
  session.moveCard(-1);
  assert.equal(session.state.walk.index, last - 1);
  session.moveCard(1);
  assert.equal(session.state.walk.done, false);
  session.moveCard(1);
  assert.equal(session.state.walk.done, true);
  session.moveCard(-1);
  assert.equal(session.state.walk.done, false);
  assert.equal(session.state.walk.index, last);
});

test('a walk-through with no cards goes from the overview to the last slide', async () => {
  const { session, clock } = make();
  session.startTalk();
  session.advance();
  session.advance();
  session.advance(); // cluster
  await flush();
  session.advance(); // react
  session.advance(); // walk
  assert.equal(session.state.walk.stream.length, 2);
  for (let i = 0; i < 5 && !session.state.walk.done; i++) {
    const f = fac(session);
    assert.ok(Number.isFinite(f.walk.cardMs));
    assert.ok(Number.isFinite(f.walk.cardEndsAt));
    clock.set(session.state.walk.cardEndsAt);
    session.tick();
  }
  assert.equal(session.state.walk.done, true);
});

test('a double-tapped Next moves one card', async () => {
  const { session } = await toWalk();
  session.moveCard(1, { from: 0 });
  session.moveCard(1, { from: 1 });
  assert.throws(() => session.moveCard(1, { from: 1 }), /Already moved on/);
  assert.equal(session.state.walk.index, 2);
});

test('going back into the walk-through holds the card', async () => {
  const { session, clock } = await toWalk();
  clock.set(session.state.walk.endsAt - 20_000);
  session.tick();
  clock.tick(20_000);
  session.tick();
  session.advance({ from: 'walk' }); // finale
  clock.tick(5_000);
  session.back();
  const w = session.state.walk;
  assert.equal(w.paused, true);
  assert.equal(w.done, false);
  assert.equal(w.cardEndsAt, null);
  assert.equal(w.cardStartedAt, clock.now());
  clock.tick(10 * MIN);
  session.tick();
  assert.equal(w.done, false);
});

test('a restart mid-walk keeps its timers', async () => {
  const { session, clock } = await toWalk();
  session.moveCard(1);
  const old = session.state;
  const copy = new Session({
    now: clock.now,
    clusterCards: async () => ({ themes: [] }),
    state: JSON.parse(JSON.stringify(old)),
  });
  assert.equal(copy.state.walk.cardEndsAt, old.walk.cardEndsAt);
  clock.set(old.walk.cardEndsAt);
  copy.tick();
  assert.equal(copy.state.walk.index, 2);
  assert.equal(copy.state.walk.endsAt, old.walk.endsAt);
});

test('a Back near the end holds the card instead of snapping forward', async () => {
  const { session, clock } = await toWalk({ cards: 4 });
  const w = session.state.walk;
  const last = w.stream.length - 1;
  clock.set(w.endsAt - 20_000);
  session.tick();
  assert.equal(w.index, last);
  session.moveCard(-1);
  assert.equal(w.index, last - 1);
  assert.equal(w.paused, true);
  assert.equal(w.cardEndsAt, null);
  for (let i = 0; i < 5; i++) {
    clock.tick(5_000);
    session.tick();
  }
  assert.equal(w.index, last - 1);
  session.moveCard(1);
  assert.equal(w.index, last);
  assert.equal(w.done, false);
  clock.set(w.cardEndsAt);
  session.tick();
  assert.equal(w.done, true);
});

test('resuming a held card after time is up lets it run, then goes to the last slide', async () => {
  const { session, clock } = await toWalk({ cards: 4 });
  const w = session.state.walk;
  const last = w.stream.length - 1;
  clock.set(w.endsAt - 20_000);
  session.tick();
  assert.equal(w.index, last);
  session.moveCard(-1); // held after time-up
  assert.equal(w.index, last - 1);
  assert.equal(w.paused, true);
  clock.tick(3_000);
  session.pauseWalk(false);
  assert.equal(w.paused, false);
  assert.ok(w.cardEndsAt >= clock.now() + 15_000);
  clock.tick(5_000);
  session.tick();
  assert.equal(w.index, last - 1);
  clock.set(w.cardEndsAt);
  session.tick();
  assert.equal(w.index, last);
  assert.equal(w.done, false);
  clock.tick(20_000);
  session.tick();
  assert.equal(w.done, true);
});

test("a hidden card's comments never reach the projector, and the walk moves past it", async () => {
  const { session } = await toWalk({ cards: 4 });
  const w = session.state.walk;
  const commented = session.state.comments[0].g;
  const at = w.stream.findIndex((it) => it.groupId === commented);
  while (w.index < at) session.moveCard(1);
  assert.deepEqual(proj(session).walk.comments.shown.map((c) => c.text), ['hello']);
  for (const id of session.findGroup(commented).group.cardIds) session.hideCard(id, true);
  const p = proj(session);
  assert.equal(p.walk.item.hidden, true);
  assert.deepEqual(p.walk.comments, { shown: [], more: 0 });
  assert.equal(JSON.stringify(p).includes('hello'), false);
  assert.deepEqual(fac(session).comments.current.map((c) => c.text), ['hello']);
  session.tick();
  assert.equal(w.index, at + 1);
});
