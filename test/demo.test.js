import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../server/session.js';
import { validateDemo, loadDemo, DEMO_STEPS } from '../server/demo.js';

const EXAMPLE = resolve(fileURLToPath(new URL('../demo/example.json', import.meta.url)));
const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function make() {
  let t = 1_000_000;
  return new Session({ now: () => t, demo: validateDemo(example()), clusterCards: async () => ({ themes: [] }), shredAnimationMs: 10 });
}

test('the example demo file is valid', () => {
  const demo = validateDemo(example());
  assert.equal(demo.notes.filter((n) => n.share).length, 1);
  assert.deepEqual(DEMO_STEPS, ['notes', 'pick', 'group', 'react', 'reveal']);
});

test('an invalid demo is rejected with the reason', () => {
  const bad = (change, reason) => {
    const d = example();
    change(d);
    assert.throws(() => validateDemo(d), reason);
  };
  bad((d) => (d.notes[1].share = true), /exactly one shared/);
  bad((d) => (d.notes[0].share = false), /exactly one shared/);
  bad((d) => (d.notes[1].text = 'x'.repeat(201)), /1 to 200/);
  bad((d) => (d.react.own = 'ab'), /one emoji/);
  bad((d) => (d.reveal.comments = Array(6).fill('hi')), /up to 5/);
  bad((d) => (d.react.presets = ['🦆']), /preset/);
  bad((d) => (d.reveal.mix = [['🎉', 0]]), /positive/);
  bad((d) => (d.theme.name = ''), /theme name/);
});

test('loadDemo prefers local.json and falls back to the example when it is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'otr-demo-'));
  const logs = [];
  const log = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    writeFileSync(join(dir, 'example.json'), JSON.stringify(example()));
    assert.equal(loadDemo(dir).theme.name, example().theme.name);
    const mine = example();
    mine.theme.name = 'Mine';
    writeFileSync(join(dir, 'local.json'), JSON.stringify(mine));
    assert.equal(loadDemo(dir).theme.name, 'Mine');
    mine.notes = [];
    writeFileSync(join(dir, 'local.json'), JSON.stringify(mine));
    assert.equal(loadDemo(dir).theme.name, example().theme.name);
    assert.deepEqual(logs, ['demo: local file invalid, using the example']);
    rmSync(join(dir, 'example.json'));
    assert.throws(() => loadDemo(dir));
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the demo steps forward and back on the facilitator's taps, only in the demo", () => {
  const s = make();
  assert.deepEqual(s.view('facilitator').demo, { step: 0, steps: 5, name: 'notes' });
  assert.throws(() => s.demoStep(-1), /first step/);
  for (let i = 1; i < 5; i++) s.demoStep(1);
  assert.equal(s.view('facilitator').demo.name, 'reveal');
  assert.throws(() => s.demoStep(1), /last step/);
  s.demoStep(-1);
  assert.equal(s.view('projector').demo.step, 3);
  assert.deepEqual(Object.keys(s.view('projector').demo).sort(), ['notes', 'react', 'reveal', 'step', 'theme']);
  s.advance();
  assert.throws(() => s.demoStep(1), /The demo is over/);
  assert.equal(s.view('facilitator').demo, undefined);
  assert.equal(s.view('projector').demo, undefined);
});

test('phones see only that the session starts soon', () => {
  const s = make();
  assert.deepEqual(Object.keys(s.view('phone', { cid: A })).sort(), ['now', 'phase', 'role', 'session']);
  assert.equal(s.view('phone', { cid: A }).phase, 'demo');
});

test('leaving the demo adds its card once, with no author', () => {
  const s = make();
  const shared = example().notes.find((n) => n.share).text;
  assert.equal(s.state.cards.length, 0);
  s.advance();
  assert.equal(s.state.cards.length, 1);
  const [card] = s.state.cards;
  assert.deepEqual(Object.keys(card).sort(), ['hidden', 'id', 'text']);
  assert.equal(card.text, shared);
  assert.equal(card.hidden, false);
  assert.deepEqual(s.state.clients, {});
  s.back();
  s.advance();
  assert.equal(s.state.cards.length, 1);
});

test("the demo's reactions and comments don't carry over", () => {
  const s = make();
  s.demoStep(1);
  s.advance();
  assert.deepEqual(s.state.reactions, []);
  assert.deepEqual(s.state.comments, []);
});

test('a session without a demo skips straight on, adding no card', () => {
  const s = new Session({ now: () => 1, clusterCards: async () => ({ themes: [] }) });
  assert.equal(s.view('projector').demo, undefined);
  s.advance();
  assert.equal(s.state.cards.length, 0);
});
