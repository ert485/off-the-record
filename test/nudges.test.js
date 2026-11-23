import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.js';
import { leastCovered, NUDGES } from '../server/nudges.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = (i) => String(i).padStart(24, '0');

function make(tagCards) {
  const s = new Session({
    clusterCards: async () => ({ themes: [] }),
    tagCards,
    nudgeQuietMs: 5,
  });
  s.advance(); // teaser to demo
  s.setNudges(true);
  return s;
}

test('nudges start off', () => {
  const s = new Session({ clusterCards: async () => ({ themes: [] }) });
  s.advance(); s.advance(); s.advance(); // demo, join, submit
  assert.equal(s.view('phone', { cid: cid(1) }).submit.nudge, null);
  assert.equal(s.view('facilitator').submit.nudgesOn, false);
});

test('leastCovered picks the first uncovered direction, balancing good and hard', () => {
  assert.equal(leastCovered({}), 'outside work');
  assert.equal(leastCovered({ 'outside work': 2 }), 'small moment');
  assert.equal(leastCovered({ good: 4 }), 'hard');
  assert.equal(leastCovered({ hard: 4 }), 'good');
  const all = Object.fromEntries(NUDGES.map((n) => [n.label, 1]));
  assert.equal(leastCovered(all), null);
});

test('phones rotate every nudge until there are enough cards', async () => {
  let calls = 0;
  const s = make(async () => (calls++, {}));
  s.advance(); s.advance(); // demo, join: now in submit
  s.submitCards(cid(1), ['one', 'two']);
  await wait(20);
  assert.equal(calls, 0);
  assert.equal(s.view('phone', { cid: cid(1) }).submit.nudge.texts.length, 6);
});

test('with enough cards, phones show only the least-covered nudge, or none', async () => {
  let counts = { good: 3, change: 2 };
  const s = make(async () => counts);
  s.advance(); s.advance(); // demo, join: now in submit
  s.submitCards(cid(1), ['a', 'b', 'c']);
  s.submitCards(cid(2), ['d', 'e']);
  await wait(20);
  assert.deepEqual(s.view('phone', { cid: cid(1) }).submit.nudge.texts, ['Something that was hard.']);

  counts = Object.fromEntries(NUDGES.map((n) => [n.label, 1]));
  s.submitCards(cid(3), ['f']);
  await wait(20);
  assert.equal(s.view('phone', { cid: cid(1) }).submit.nudge, null);
});

test('turning nudges off hides them; hidden cards are never tagged', async () => {
  let sent;
  const s = make(async (cards) => ((sent = cards), {}));
  s.advance(); s.advance(); // demo, join: now in submit
  s.submitCards(cid(1), ['a', 'b', 'c']);
  s.submitCards(cid(2), ['d', 'e', 'secret']);
  s.hideCard(s.state.cards.find((c) => c.text === 'secret').id, true);
  s.submitCards(cid(3), ['f']);
  await wait(20);
  assert.equal(sent.some((c) => c.text === 'secret'), false);
  s.setNudges(false);
  assert.equal(s.view('phone', { cid: cid(1) }).submit.nudge, null);
});
