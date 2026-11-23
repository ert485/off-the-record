import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, normalizePlacements } from '../server/session.js';
import { localPlacer, readPlacements, lateRequest, groupingRequest, LATE_SCHEMA, LATE_SYSTEM } from '../server/cluster.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const MIN = 60_000;
const HAIKU = 'Snow on the keyboard / we all stare at the same screen / thaw comes late again';
const flush = () => new Promise((r) => setImmediate(r));

// Fake grouping and placement calls: each records its input and waits until
// the test resolves or rejects it.
function fakeCall() {
  const calls = [];
  const fn = (input, opts) =>
    new Promise((resolve, reject) => {
      calls.push({ input, opts, resolve, reject });
    });
  return { fn, calls };
}

function make({ state } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => (t += ms) };
  const cluster = fakeCall();
  const place = fakeCall();
  const session = new Session({ state, now: clock.now, clusterCards: cluster.fn, placeLateCards: place.fn });
  return { session, clock, cluster, place };
}

const idOf = (session, text) => session.state.cards.find((c) => c.text === text).id;
const groupOf = (session, cardId) => {
  for (const t of session.state.themes) for (const g of t.groups) if (g.cardIds.includes(cardId)) return { theme: t, group: g };
  return null;
};

// To submit, with 3 cards in; then the 1-minute warning starts the early run.
async function toEarlyRun(made) {
  const { session, clock } = made;
  session.advance(); // join
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  session.submitCards(B, ['three']);
  clock.tick(4 * MIN);
  session.tick();
  await flush();
}

// The early run lands: "one" and "two" are near-duplicates in Work, "three" is in Life.
async function landEarly(made) {
  const { session, cluster } = made;
  const ids = ['one', 'two', 'three'].map((t) => idOf(session, t));
  cluster.calls.at(-1).resolve({
    themes: [
      { name: 'Work', haiku: HAIKU, groups: [[ids[0], ids[1]]] },
      { name: 'Life', haiku: 'a / b / c', groups: [[ids[2]]] },
    ],
  });
  await flush();
}

// Early themes approved, two late cards in, submissions closed: the quick call runs.
async function toPlacement(made) {
  const { session, clock } = made;
  await toEarlyRun(made);
  await landEarly(made);
  session.approveAll({});
  session.submitCards(C, ['four', 'five']);
  clock.tick(MIN);
  session.advance(); // cluster
  await flush();
}

const fits = (session) => {
  const work = session.state.themes.find((t) => t.name === 'Work');
  const life = session.state.themes.find((t) => t.name === 'Life');
  return [
    { cardId: idOf(session, 'four'), themeId: work.id, groupId: work.groups[0].id },
    { cardId: idOf(session, 'five'), themeId: life.id, groupId: null },
  ];
};

test('at the 1-minute warning, a full high-effort grouping starts on the cards so far', async () => {
  const made = make();
  const { session, clock, cluster } = made;
  session.advance(); // join
  session.advance(); // submit
  session.submitCards(A, ['one', 'two']);
  session.submitCards(B, ['three']);
  clock.tick(3 * MIN);
  session.tick();
  assert.equal(cluster.calls.length, 0);
  assert.equal(session.state.clustering.early, false);
  clock.tick(MIN);
  session.tick();
  await flush();
  assert.equal(cluster.calls.length, 1);
  assert.deepEqual(cluster.calls[0].opts, { effort: 'high' });
  assert.deepEqual(cluster.calls[0].input.map((c) => c.text).sort(), ['one', 'three', 'two']);
  assert.equal(session.state.clustering.early, true);
  session.extendSubmit();
  session.submitCards(C, ['four']);
  session.tick();
  clock.tick(2 * MIN);
  session.tick();
  await flush();
  assert.equal(cluster.calls.length, 1);
  assert.equal(session.state.phase, 'submit');
});

test('the facilitator can approve themes while people are still submitting', async () => {
  const made = make();
  const { session } = made;
  await toEarlyRun(made);
  await landEarly(made);
  assert.equal(session.state.phase, 'submit');
  const f = session.view('facilitator');
  assert.deepEqual(f.themes.map((t) => t.name), ['Work', 'Life']);
  assert.equal(f.themes[0].haiku, HAIKU);
  session.approveTheme(f.themes[0].id, 'Work life');
  session.approveAll({});
  assert.deepEqual(session.state.themes.map((t) => [t.name, t.approved]), [['Work life', true], ['Life', true]]);
  session.submitCards(C, ['four']);
  assert.equal(session.state.cards.length, 4);
});

test('confirming with no late cards keeps the early themes as approved', async () => {
  const made = make();
  const { session, clock, place, cluster } = made;
  await toEarlyRun(made);
  await landEarly(made);
  session.approveAll({});
  const before = JSON.stringify(session.state.themes);
  clock.tick(MIN);
  session.advance(); // cluster
  await flush();
  assert.equal(place.calls.length, 0);
  assert.equal(cluster.calls.length, 1);
  assert.equal(JSON.stringify(session.state.themes), before);
  assert.ok(session.state.themes.every((t) => t.approved));
  assert.equal(session.view('projector').waiting, false);
  session.advance(); // react
  assert.equal(session.state.phase, 'react');
});

test('late cards that fit are placed without asking; names, haiku and approvals stay', async () => {
  const made = make();
  const { session, place } = made;
  await toPlacement(made);
  assert.equal(place.calls.length, 1);
  const { input } = place.calls[0];
  assert.deepEqual(input.late.map((c) => c.text).sort(), ['five', 'four']);
  assert.deepEqual(input.late.map((c) => Object.keys(c).sort()), [['id', 'text'], ['id', 'text']]);
  assert.deepEqual(
    input.themes.map((t) => ({ name: t.name, haiku: t.haiku, texts: t.groups.map((g) => [...g.texts].sort()) })),
    [
      { name: 'Work', haiku: HAIKU, texts: [['one', 'two']] },
      { name: 'Life', haiku: 'a / b / c', texts: [['three']] },
    ],
  );
  assert.equal(session.state.clustering.late.status, 'running');
  assert.throws(() => session.advance(), /Grouping is still running/);
  const before = session.state.themes.map((t) => [t.id, t.name, t.haiku, t.approved]);
  const placements = fits(session);
  place.calls[0].resolve({ placements, flags: [] });
  await flush();
  assert.equal(session.state.clustering.late.status, 'done');
  assert.deepEqual(session.state.themes.map((t) => [t.id, t.name, t.haiku, t.approved]), before);
  const four = groupOf(session, idOf(session, 'four'));
  assert.equal(four.group.id, placements[0].groupId);
  assert.equal(four.group.cardIds.length, 3);
  const five = groupOf(session, idOf(session, 'five'));
  assert.equal(five.theme.name, 'Life');
  assert.deepEqual(five.group.cardIds, [idOf(session, 'five')]);
  assert.equal(session.view('projector').waiting, false);
  session.advance(); // react
  assert.equal(session.state.phase, 'react');
});

test('flagged late cards wait for the facilitator; keep places them as suggested', async () => {
  const made = make();
  const { session, place } = made;
  await toPlacement(made);
  const placements = fits(session);
  const five = idOf(session, 'five');
  place.calls[0].resolve({ placements, flags: [{ cardIds: [five], reason: 'Nothing about bridges yet' }] });
  await flush();
  assert.equal(session.state.clustering.late.status, 'flagged');
  assert.equal(groupOf(session, five), null);
  assert.equal(groupOf(session, idOf(session, 'four')), null);
  assert.throws(() => session.advance(), /keep the themes or regroup/);
  assert.equal(session.view('projector').waiting, true);
  const late = session.view('facilitator').clustering.late;
  assert.deepEqual(late, { status: 'flagged', flags: [{ cards: [{ id: five, text: 'five' }], reason: 'Nothing about bridges yet' }] });
  const phones = JSON.stringify([A, B, C].map((cid) => session.view('phone', { cid })));
  assert.equal(/bridges|flag|late/i.test(phones), false);
  assert.equal(JSON.stringify(session.view('projector')).includes('bridges'), false);
  session.keepLate();
  assert.equal(session.state.clustering.late.status, 'done');
  assert.equal(groupOf(session, idOf(session, 'four')).group.id, placements[0].groupId);
  assert.equal(groupOf(session, five).theme.name, 'Life');
  assert.ok(session.state.themes.every((t) => t.approved));
  assert.throws(() => session.keepLate(), /No late arrivals/);
  session.advance(); // react
  assert.equal(session.state.phase, 'react');
});

test('regroup runs a full grouping and asks for approval again', async () => {
  const made = make();
  const { session, place, cluster } = made;
  await toPlacement(made);
  assert.throws(() => session.regroupAll(), /No late arrivals/);
  place.calls[0].resolve({ placements: fits(session), flags: [{ cardIds: [idOf(session, 'five')], reason: 'New' }] });
  await flush();
  session.regroupAll();
  await flush();
  assert.equal(cluster.calls.length, 2);
  assert.deepEqual(cluster.calls[1].opts, { effort: 'high' });
  assert.deepEqual(cluster.calls[1].input.map((c) => c.text).sort(), ['five', 'four', 'one', 'three', 'two']);
  assert.equal(session.state.clustering.late, null);
  assert.throws(() => session.advance(), /Grouping is still running/);
  cluster.calls[1].resolve({ themes: [{ name: 'Everything', haiku: '', groups: cluster.calls[1].input.map((c) => [c.id]) }] });
  await flush();
  assert.deepEqual(session.state.themes.map((t) => [t.name, t.approved]), [['Everything', false]]);
  assert.equal(place.calls.length, 1);
  assert.equal(session.view('projector').waiting, true); // an unapproved theme
  assert.throws(() => session.keepLate(), /No late arrivals/);
  session.advance(); // react
});

test("if the quick call fails, the late cards are flagged with the reason; keep puts them in Other", async () => {
  const made = make();
  const { session, place } = made;
  await toPlacement(made);
  place.calls[0].reject(new Error('Request timed out.'));
  await flush();
  const late = session.state.clustering.late;
  assert.equal(late.status, 'flagged');
  assert.deepEqual(late.flags, [
    { cardIds: [idOf(session, 'four'), idOf(session, 'five')].sort((a, b) => a - b), reason: "The quick check didn't finish: Request timed out." },
  ]);
  session.keepLate();
  const other = session.state.themes.find((t) => t.name === 'Other');
  assert.equal(other.approved, false);
  assert.deepEqual(other.groups.map((g) => g.cardIds.length), [1, 1]);
  assert.equal(groupOf(session, idOf(session, 'four')).theme, other);
  assert.equal(session.state.themes.filter((t) => t.name !== 'Other').every((t) => t.approved), true);
});

test('skipping the quick call counts as a failure; its late result is ignored', async () => {
  const made = make();
  const { session, place } = made;
  await toPlacement(made);
  const placements = fits(session);
  session.skipClustering();
  assert.equal(session.state.clustering.late.status, 'flagged');
  assert.match(session.state.clustering.late.flags[0].reason, /^The quick check didn't finish: /);
  place.calls[0].resolve({ placements, flags: [] });
  await flush();
  assert.equal(session.state.clustering.late.status, 'flagged');
  assert.equal(groupOf(session, idOf(session, 'four')), null);
});

test('confirming before the early run finishes waits for it, then places the late cards', async () => {
  const made = make();
  const { session, clock, place } = made;
  await toEarlyRun(made);
  session.submitCards(C, ['four', 'five']);
  clock.tick(MIN);
  session.advance(); // cluster
  await flush();
  assert.equal(session.state.clustering.status, 'running');
  assert.throws(() => session.advance(), /Grouping is still running/);
  assert.equal(place.calls.length, 0);
  await landEarly(made);
  assert.equal(place.calls.length, 1);
  assert.deepEqual(place.calls[0].input.late.map((c) => c.text).sort(), ['five', 'four']);
  place.calls[0].resolve({ placements: fits(session), flags: [] });
  await flush();
  assert.equal(session.state.clustering.late.status, 'done');
  assert.equal(session.state.themes.flatMap((t) => t.groups.flatMap((g) => g.cardIds)).length, 5);
});

test('a restart during placement runs it again', async () => {
  const made = make();
  await toPlacement(made);
  const saved = JSON.parse(JSON.stringify(made.session.state));
  assert.equal(saved.clustering.late.status, 'running');
  const restarted = make({ state: saved });
  await flush();
  assert.equal(restarted.place.calls.length, 1);
  assert.equal(restarted.cluster.calls.length, 0);
  assert.deepEqual(restarted.place.calls[0].input.late.map((c) => c.text).sort(), ['five', 'four']);
  // The old process's result can't land in the new one; the new call's does.
  restarted.place.calls[0].resolve({ placements: fits(restarted.session), flags: [] });
  await flush();
  assert.equal(restarted.session.state.clustering.late.status, 'done');
});

test('a restart during the early run runs it again', async () => {
  const made = make();
  await toEarlyRun(made);
  const saved = JSON.parse(JSON.stringify(made.session.state));
  assert.equal(saved.clustering.status, 'running');
  const restarted = make({ state: saved });
  await flush();
  assert.equal(restarted.cluster.calls.length, 1);
  assert.deepEqual(restarted.cluster.calls[0].opts, { effort: 'high' });
  assert.equal(restarted.session.state.clustering.early, true);
  await landEarly(restarted);
  assert.equal(restarted.session.state.themes.length, 2);
});

test('hidden cards are never sent for placement', async () => {
  const made = make();
  const { session, clock, place } = made;
  await toEarlyRun(made);
  await landEarly(made);
  session.submitCards(C, ['four', 'secret five']);
  session.hideCard(idOf(session, 'secret five'), true);
  session.hideCard(idOf(session, 'two'), true);
  clock.tick(MIN);
  session.advance(); // cluster
  await flush();
  const sent = JSON.stringify(place.calls[0].input);
  assert.equal(sent.includes('secret five'), false);
  assert.equal(sent.includes('"two"'), false);
  assert.deepEqual(place.calls[0].input.late.map((c) => c.text), ['four']);
});

test('normalizePlacements drops unknown ids and duplicates; unplaced cards are flagged', () => {
  const groupIds = new Map([[10, 1], [20, 2]]);
  const raw = {
    placements: [
      { cardId: 100, themeId: 1, groupId: 10 },
      { cardId: 100, themeId: 2, groupId: null }, // duplicate
      { cardId: 999, themeId: 1, groupId: null }, // not a late card
      { cardId: 101, themeId: 7, groupId: null }, // unknown theme
      { cardId: 102, themeId: 1, groupId: 20 }, // group from another theme: a new group
    ],
    flags: [
      { cardIds: [102, 104, 999], reason: 'Bridges' },
      { cardIds: [102], reason: 'Again' },
    ],
  };
  assert.deepEqual(normalizePlacements(raw, { themeIds: [1, 2], groupIds, lateIds: [100, 101, 102, 103, 104] }), {
    placements: [
      { cardId: 100, themeId: 1, groupId: 10 },
      { cardId: 102, themeId: 1, groupId: null },
    ],
    flags: [
      { cardIds: [102, 104], reason: 'Bridges' },
      { cardIds: [101], reason: 'Not placed' },
      { cardIds: [103], reason: 'Not placed' },
    ],
  });
  assert.deepEqual(normalizePlacements(null, { themeIds: [1], groupIds, lateIds: [5] }), {
    placements: [],
    flags: [{ cardIds: [5], reason: 'Not placed' }],
  });
});

test('the placer reads the model JSON: group 0 is a new group, each misfit and missing theme is a flag', () => {
  const out = readPlacements({
    placements: [
      { card: 5, theme: 1, group: 10, fits_well: true, reason: '' },
      { card: 6, theme: 2, group: 0, fits_well: false, reason: 'No theme about bridges' },
    ],
    missing_themes: [{ cards: [6, 7], reason: 'Trucks hitting bridges' }],
  });
  assert.deepEqual(out.placements, [
    { cardId: 5, themeId: 1, groupId: 10 },
    { cardId: 6, themeId: 2, groupId: null },
  ]);
  assert.deepEqual(out.flags, [
    { cardIds: [6, 7], reason: 'Trucks hitting bridges' },
    { cardIds: [6], reason: 'No theme about bridges' },
  ]);
});

test('the quick call numbers themes, groups and cards as the spike did, and maps the answer back to real ids', () => {
  const request = lateRequest({
    themes: [
      { id: 7, name: 'Work', haiku: 'h', groups: [{ id: 70, texts: ['one', 'two'] }, { id: 71, texts: ['three'] }] },
      { id: 8, name: 'Life', haiku: '', groups: [{ id: 80, texts: ['six'] }] },
    ],
    late: [
      { id: 1234567890, text: 'four' },
      { id: 987654321, text: 'five' },
    ],
  });
  assert.deepEqual(request.content.split('\n').map((l) => JSON.parse(l)), [
    { theme: 101, name: 'Work', haiku: 'h', groups: [{ group: 1001, texts: ['one', 'two'] }, { group: 1002, texts: ['three'] }] },
    { theme: 102, name: 'Life', haiku: '', groups: [{ group: 1003, texts: ['six'] }] },
    { card: 1, text: 'four' },
    { card: 2, text: 'five' },
  ]);
  assert.equal(request.content.includes('1234567890'), false);
  const out = request.read({
    placements: [
      { card: 1, theme: 101, group: 1002, fits_well: true, reason: '' },
      { card: 2, theme: 102, group: 0, fits_well: false, reason: 'Bridges' },
      { card: 9, theme: 101, group: 0, fits_well: true, reason: '' },
    ],
    missing_themes: [{ cards: [2, 1], reason: 'Trucks' }],
  });
  assert.deepEqual(out.placements, [
    { cardId: 1234567890, themeId: 7, groupId: 71 },
    { cardId: 987654321, themeId: 8, groupId: null },
    { cardId: undefined, themeId: 7, groupId: null },
  ]);
  assert.deepEqual(out.flags, [
    { cardIds: [987654321, 1234567890], reason: 'Trucks' },
    { cardIds: [987654321], reason: 'Bridges' },
  ]);
  assert.ok(LATE_SYSTEM.startsWith('You place late-arriving anonymous cards'));
  assert.deepEqual(LATE_SCHEMA.required, ['placements', 'missing_themes']);
});

test('the full grouping sends cards as 1 to N and maps the groups back to real ids', () => {
  const request = groupingRequest([
    { id: 1234567890, text: 'one' },
    { id: 2000000000, text: 'two' },
  ]);
  assert.deepEqual(request.content.split('\n').map((l) => JSON.parse(l)), [
    { id: 1, text: 'one' },
    { id: 2, text: 'two' },
  ]);
  assert.deepEqual(request.read([{ name: 'Work', haiku: 'h', groups: [[2, 1], [5]] }]), [
    { name: 'Work', haiku: 'h', groups: [[2000000000, 1234567890], [undefined]] },
  ]);
  assert.deepEqual(request.read(undefined), []);
});

test('the local placer puts every late card in a new group of the first theme, unflagged', async () => {
  const out = await localPlacer({ themes: [{ id: 1, groups: [] }, { id: 2, groups: [] }], late: [{ id: 5, text: 'x' }] });
  assert.deepEqual(out, { placements: [{ cardId: 5, themeId: 1, groupId: null }], flags: [] });
});
