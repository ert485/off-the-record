import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../server/session.js';
import { validateDemo, loadDemo, DEMO_STEPS, DEMO_STEP_MS } from '../server/demo.js';
import { struckParts } from '../public/shared/struck.js';

const EXAMPLE = resolve(fileURLToPath(new URL('../demo/example.json', import.meta.url)));
const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// In the demo by default (the session itself starts on the teaser).
function make({ teaser = false, demo = validateDemo(example()) } = {}) {
  const clock = { t: 1_000_000, now: () => clock.t, tick: (ms) => (clock.t += ms) };
  const s = new Session({ now: clock.now, demo, clusterCards: async () => ({ themes: [] }), shredAnimationMs: 10 });
  if (!teaser) s.advance();
  s.clock = clock;
  return s;
}

test('the example demo file is valid', () => {
  const demo = validateDemo(example());
  assert.equal(demo.notes.filter((n) => n.share).length, 2);
  assert.deepEqual(DEMO_STEPS, ['notes', 'pick', 'group', 'react', 'reveal']);
});

test('an invalid demo is rejected with the reason', () => {
  const bad = (change, reason) => {
    const d = example();
    change(d);
    assert.throws(() => validateDemo(d), reason);
  };
  bad((d) => d.notes.forEach((n) => delete n.share), /1 to 3 shared/);
  bad((d) => (d.notes[1].text = 'x'.repeat(201)), /1 to 200/);
  bad((d) => (d.react.own = 'ab'), /one emoji/);
  bad((d) => (d.react.presets = ['🦆']), /preset/);
  bad((d) => (d.reveal.mix = [['🎉', 0]]), /positive/);
  bad((d) => (d.theme.name = ''), /theme name/);
});

test('the demo may tap any of the 16 presets', () => {
  const d = example();
  d.react.presets = ['🔥', '🙋'];
  assert.deepEqual(validateDemo(d).react.presets, ['🔥', '🙋']);
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
  assert.deepEqual(s.view('facilitator').demo, { step: 0, steps: 5, name: 'notes', auto: true });
  assert.throws(() => s.demoStep(-1), /first step/);
  for (let i = 1; i < 5; i++) s.demoStep(1);
  assert.equal(s.view('facilitator').demo.name, 'reveal');
  assert.throws(() => s.demoStep(1), /last step/);
  s.demoStep(-1);
  assert.equal(s.view('projector').demo.step, 3);
  assert.deepEqual(Object.keys(s.view('projector').demo).sort(), ['auto', 'notes', 'react', 'reveal', 'step', 'stepStartedAt', 'theme']);
  s.advance();
  assert.throws(() => s.demoStep(1), /The demo is over/);
  assert.equal(s.view('facilitator').demo, undefined);
  assert.equal(s.view('projector').demo, undefined);
});

test('phones see only that the session starts soon', () => {
  const s = make();
  assert.deepEqual(Object.keys(s.view('phone', { cid: A })).sort(), ['now', 'phase', 'role', 'session']);
  assert.equal(s.view('phone', { cid: A }).phase, 'demo');
  assert.equal(s.view('phone', { cid: A }).teaser, undefined);
});

test('leaving the demo adds every shared note as a card, once', () => {
  const s = make();
  const shared = example().notes.filter((n) => n.share).map((n) => n.text);
  assert.equal(shared.length, 2);
  assert.equal(s.state.cards.length, 0);
  s.advance();
  assert.equal(s.state.cards.length, shared.length);
  for (const card of s.state.cards) {
    assert.deepEqual(Object.keys(card).sort(), ['hidden', 'id', 'text']);
    assert.equal(card.hidden, false);
  }
  assert.deepEqual(s.state.cards.map((c) => c.text).sort(), [...shared].sort());
  assert.deepEqual(s.state.clients, {});
  s.back();
  s.advance();
  assert.equal(s.state.cards.length, shared.length);
});

test('a demo file may share 1 to 3 notes, and no more', () => {
  const sharing = (n) => {
    const d = example();
    d.notes = Array.from({ length: 5 }, (_, i) => ({ text: `Note ${i + 1}`, ...(i < n ? { share: true } : {}) }));
    return d;
  };
  for (const n of [1, 2, 3]) assert.equal(validateDemo(sharing(n)).notes.filter((x) => x.share).length, n);
  for (const n of [0, 4, 5]) assert.throws(() => validateDemo(sharing(n)), /^Error: Demo needs 1 to 3 shared notes$/);
  // A three-note demo carries all three over.
  const s = make({ demo: validateDemo(sharing(3)) });
  s.advance();
  assert.deepEqual(s.state.cards.map((c) => c.text).sort(), ['Note 1', 'Note 2', 'Note 3']);
});

test('comment fields in an old demo file are ignored', () => {
  const d = example();
  d.react.comment = 'An old comment.';
  d.reveal.comments = ['One', 'Two', 'x'.repeat(500), 7];
  const demo = validateDemo(d);
  assert.deepEqual(Object.keys(demo.react).sort(), ['own', 'presets']);
  assert.deepEqual(Object.keys(demo.reveal), ['mix']);
  assert.ok(!JSON.stringify(make({ demo }).view('projector')).includes('An old comment.'));
});

test('the loop steps take 13, 16, 16, 12 and 12 seconds', () => {
  assert.deepEqual(DEMO_STEP_MS, [13_000, 16_000, 16_000, 12_000, 12_000]);
});

test('struckParts splits ~~marked~~ spans and leaves an unpaired ~~ as text', () => {
  assert.deepEqual(struckParts('plain'), [{ text: 'plain', struck: false }]);
  assert.deepEqual(struckParts('We ~~fix it~~ talk about it.'), [
    { text: 'We ', struck: false },
    { text: 'fix it', struck: true },
    { text: ' talk about it.', struck: false },
  ]);
  assert.deepEqual(struckParts('~~a~~ and ~~b~~'), [
    { text: 'a', struck: true },
    { text: ' and ', struck: false },
    { text: 'b', struck: true },
  ]);
  assert.deepEqual(struckParts('~~one~~ then ~~ alone'), [
    { text: 'one', struck: true },
    { text: ' then ~~ alone', struck: false },
  ]);
  assert.deepEqual(struckParts('only ~~ here'), [{ text: 'only ~~ here', struck: false }]);
  assert.deepEqual(struckParts('empty ~~~~ pair'), [{ text: 'empty ~~~~ pair', struck: false }]);
});

test("the demo's reactions and thoughts don't carry over", () => {
  const s = make();
  s.demoStep(1);
  s.advance();
  assert.deepEqual(s.state.reactions, []);
  assert.deepEqual(s.state.afterthoughts, []);
});

test('a session without a demo skips straight on, adding no card', () => {
  const s = new Session({ now: () => 1, clusterCards: async () => ({ themes: [] }) });
  s.advance();
  assert.equal(s.view('projector').demo, undefined);
  s.advance();
  assert.equal(s.state.cards.length, 0);
});

test('a second tap on demo Next is ignored', () => {
  const s = make();
  s.demoStep(1, { from: 0 });
  assert.throws(() => s.demoStep(1, { from: 0 }), /Already moved on/);
  assert.equal(s.state.demo.step, 1);
  s.demoStep(-1, { from: 1 });
  assert.throws(() => s.demoStep(-1, { from: 1 }), /Already moved on/);
  assert.equal(s.state.demo.step, 0);
});

test('a session starts on the teaser, and the teaser shows no demo content', () => {
  const s = make({ teaser: true });
  const teaser = example().teaser;
  assert.equal(s.state.phase, 'teaser');
  const phone = s.view('phone', { cid: A });
  const projector = s.view('projector');
  const facilitator = s.view('facilitator');
  for (const v of [phone, projector, facilitator]) {
    assert.deepEqual(v.teaser, teaser);
    assert.equal(v.demo, undefined);
    const json = JSON.stringify(v);
    for (const n of example().notes) assert.ok(!json.includes(n.text));
    assert.ok(!json.includes(example().theme.haiku));
  }
  assert.equal(facilitator.next, 'demo');
  assert.equal(facilitator.canBack, false);
  assert.deepEqual(Object.keys(phone).sort(), ['now', 'phase', 'role', 'session', 'teaser']);
  assert.throws(() => s.back(), /Nothing to go back/);
  assert.throws(() => s.demoStep(1), /The demo is over/);
  assert.equal(s.state.cards.length, 0);
});

test('leaving the teaser starts the demo on a loop; Back from the demo returns to the teaser', () => {
  const s = make({ teaser: true });
  s.clock.tick(5000);
  s.advance();
  assert.equal(s.state.phase, 'demo');
  assert.deepEqual(s.state.demo, { step: 0, cardIds: null, auto: true, stepStartedAt: s.clock.now() });
  const p = s.view('projector').demo;
  assert.equal(p.auto, true);
  assert.equal(p.stepStartedAt, s.clock.now());
  assert.equal(s.view('facilitator').demo.auto, true);
  assert.equal(s.view('projector').teaser, undefined);
  s.back();
  assert.equal(s.state.phase, 'teaser');
  s.advance();
  assert.equal(s.state.demo.auto, true);
  assert.equal(s.state.demo.step, 0);
});

test('the loop advances on the server and wraps to the first step', () => {
  const s = make();
  let changes = 0;
  s.onChange = () => changes++;
  s.clock.tick(DEMO_STEP_MS[0] - 1);
  s.tick();
  assert.equal(s.state.demo.step, 0);
  assert.equal(changes, 0);
  s.clock.tick(1);
  s.tick();
  assert.equal(s.state.demo.step, 1);
  assert.equal(s.state.demo.stepStartedAt, s.clock.now());
  assert.equal(changes, 1);
  for (let i = 1; i < DEMO_STEPS.length; i++) {
    s.clock.tick(DEMO_STEP_MS[s.state.demo.step]);
    s.tick();
  }
  assert.equal(s.state.demo.step, 0);
  assert.equal(s.view('projector').demo.step, 0);
  assert.equal(DEMO_STEP_MS.length, DEMO_STEPS.length);
});

test('Next or Back takes the demo off the loop; the switch puts it back', () => {
  const s = make();
  s.demoStep(1);
  assert.equal(s.state.demo.auto, false);
  s.clock.tick(60_000);
  s.tick();
  assert.equal(s.state.demo.step, 1);
  s.demoAuto(true);
  assert.equal(s.state.demo.auto, true);
  assert.equal(s.state.demo.stepStartedAt, s.clock.now());
  s.demoStep(1);
  assert.equal(s.state.demo.auto, false);
  s.demoAuto(true);
  s.demoAuto(false);
  assert.equal(s.view('facilitator').demo.auto, false);
  s.advance();
  assert.throws(() => s.demoAuto(true), /The demo is over/);
});

test('play on a loop starts again from the first step', () => {
  const s = make();
  // Stepped by hand to the last step, then put back on the loop.
  for (let i = 1; i < DEMO_STEPS.length; i++) s.demoStep(1);
  assert.equal(s.state.demo.step, DEMO_STEPS.length - 1);
  s.clock.tick(30_000);
  let changes = 0;
  s.onChange = () => changes++;
  s.demoAuto(true);
  assert.deepEqual(
    { step: s.state.demo.step, auto: s.state.demo.auto, stepStartedAt: s.state.demo.stepStartedAt },
    { step: 0, auto: true, stepStartedAt: s.clock.now() },
  );
  assert.equal(changes, 1);
  assert.equal(s.view('projector').demo.step, 0);
  // ...and loops from there: step 2 after the first step's time.
  s.clock.tick(DEMO_STEP_MS[0]);
  s.tick();
  assert.equal(s.state.demo.step, 1);
  // A second tap (another device) while it loops doesn't restart it.
  const startedAt = s.state.demo.stepStartedAt;
  s.clock.tick(1000);
  s.demoAuto(true);
  assert.equal(s.state.demo.step, 1);
  assert.equal(s.state.demo.stepStartedAt, startedAt);
  assert.equal(changes, 2);
});

test('starting the talk clock takes the demo off the loop and back to step 1', () => {
  const s = make();
  s.clock.tick(DEMO_STEP_MS[0]);
  s.tick();
  assert.equal(s.state.demo.step, 1);
  s.startTalk();
  assert.equal(s.state.demo.auto, false);
  assert.equal(s.state.demo.step, 0);
  s.clock.tick(60_000);
  s.tick();
  assert.equal(s.state.demo.step, 0);
});

test('a teaser in the demo file is validated; without one, a plain teaser', () => {
  const bad = (change, reason) => {
    const d = example();
    change(d);
    assert.throws(() => validateDemo(d), reason);
  };
  bad((d) => (d.teaser = 'soon'), /teaser must be an object/);
  bad((d) => (d.teaser.title = ''), /teaser title/);
  bad((d) => (d.teaser.title = 'x'.repeat(61)), /teaser title/);
  bad((d) => (d.teaser.lines = ['a', 'b', 'c', 'd', 'e']), /up to 4 lines/);
  bad((d) => (d.teaser.lines = ['']), /up to 4 lines/);
  bad((d) => (d.teaser.lines = ['x'.repeat(161)]), /up to 4 lines/);
  bad((d) => (d.teaser.lines = 'soon'), /up to 4 lines/);
  const ok = example();
  ok.teaser = { title: 'T'.repeat(60), lines: [] };
  assert.deepEqual(validateDemo(ok).teaser, { title: 'T'.repeat(60), lines: [] });
  const none = example();
  delete none.teaser;
  const plain = { title: 'Off the Record', lines: ['Starting soon.'] };
  assert.deepEqual(validateDemo(none).teaser, plain);
  assert.deepEqual(make({ teaser: true, demo: validateDemo(none) }).view('projector').teaser, plain);
  const noDemo = new Session({ now: () => 1, clusterCards: async () => ({ themes: [] }) });
  assert.deepEqual(noDemo.view('projector').teaser, plain);
});

test("leaving the teaser doesn't start the talk clock", () => {
  const s = make({ teaser: true });
  s.advance();
  assert.equal(s.state.talk.startedAt, null);
  s.advance();
  assert.ok(s.state.talk.startedAt !== null);
});

test('an older saved state loads without the loop fields', () => {
  const s = make();
  const old = JSON.parse(JSON.stringify(s.state));
  delete old.demo.auto;
  delete old.demo.stepStartedAt;
  const again = new Session({ state: old, now: () => 2_000_000, demo: validateDemo(example()), clusterCards: async () => ({ themes: [] }) });
  assert.equal(again.state.demo.auto, false);
  assert.equal(again.state.demo.stepStartedAt, 2_000_000);
  again.tick();
  assert.equal(again.view('projector').demo.step, 0);
  // Saved before a demo could share more than one note: the card it added
  // still counts, so leaving the demo again adds nothing.
  const added = JSON.parse(JSON.stringify(s.state));
  added.demo = { step: 0, cardId: 12345 };
  const later = new Session({ state: added, now: () => 2_000_000, demo: validateDemo(example()), clusterCards: async () => ({ themes: [] }) });
  assert.deepEqual(later.state.demo.cardIds, [12345]);
  assert.equal('cardId' in later.state.demo, false);
  later.advance();
  assert.equal(later.state.cards.length, 0);
});

test('starting the talk clock mid-demo by hand keeps the step', () => {
  const s = make();
  s.demoStep(1);
  s.demoStep(1);
  assert.equal(s.state.demo.auto, false);
  const startedAt = s.state.demo.stepStartedAt;
  s.clock.tick(5000);
  s.startTalk();
  assert.equal(s.state.demo.auto, false);
  assert.equal(s.state.demo.step, 2);
  assert.equal(s.state.demo.stepStartedAt, startedAt);
});

test("back to the teaser and into the demo during the talk doesn't loop", () => {
  const s = make({ teaser: true });
  s.advance();
  s.startTalk();
  s.back();
  assert.equal(s.state.phase, 'teaser');
  s.advance();
  assert.equal(s.state.phase, 'demo');
  assert.equal(s.state.demo.auto, false);
});

test('credits in the demo file are validated and reach the projector only at the closing', () => {
  const bad = (change) => {
    const d = example();
    d.credits = { title: 'Thanks', lines: ['One'] };
    change(d);
    assert.throws(() => validateDemo(d), /credits/);
  };
  bad((d) => (d.credits = 'thanks'));
  bad((d) => (d.credits.title = ''));
  bad((d) => (d.credits.title = 'x'.repeat(61)));
  bad((d) => (d.credits.lines = 'one'));
  bad((d) => (d.credits.lines = Array(13).fill('a')));
  bad((d) => (d.credits.lines = ['']));
  bad((d) => (d.credits.lines = ['x'.repeat(81)]));
  const ok = example();
  ok.credits = { title: 'T'.repeat(60), lines: Array(12).fill('x'.repeat(80)) };
  assert.equal(validateDemo(ok).credits.lines.length, 12);
  ok.credits.lines = [];
  assert.deepEqual(validateDemo(ok).credits, { title: 'T'.repeat(60), lines: [] });
  assert.equal(validateDemo(example()).credits, undefined);

  const withCredits = example();
  withCredits.credits = { title: 'Thank you', lines: ['To the room', 'To the facilitator'] };
  const s = make({ demo: validateDemo(withCredits) });
  const credits = { title: 'Thank you', lines: ['To the room', 'To the facilitator'] };
  const seen = (role) => JSON.stringify(s.view(role, { cid: A }));
  // Every phase before the closing: no screen is sent the credits.
  for (const phase of ['teaser', 'demo', 'join', 'submit', 'cluster', 'react', 'walk', 'finale', 'shred']) {
    s.state.phase = phase;
    for (const role of ['projector', 'phone', 'facilitator']) assert.ok(!seen(role).includes('Thank you'), `${role} at ${phase}`);
  }
  // At the closing (after the shred has wiped the session) only the projector gets them.
  s.state.phase = 'closing';
  s.shredded = true;
  assert.deepEqual(s.view('projector').credits, credits);
  assert.equal(s.view('phone', { cid: A }).credits, undefined);
  assert.equal(s.view('facilitator').credits, undefined);
  assert.ok(!seen('phone').includes('Thank you'));
  assert.ok(!seen('facilitator').includes('Thank you'));
  // Without credits in the file, the closing view carries none.
  const plain = make({ demo: validateDemo(example()) });
  plain.state.phase = 'closing';
  plain.shredded = true;
  assert.equal('credits' in plain.view('projector'), false);
});
