// Proves the shred leaves nothing behind.
//
// Runs the real server as a separate process with its own data, temp and
// home directories, plays a whole session where every card and thought
// carries a random marker, shreds, then checks:
//   1. the data directory is empty;
//   2. no file in the project, data, temp or home directories contains the marker;
//   3. nothing the server printed contains the marker or any IP address;
//   4. no screen's view still contains the marker.
// As a control, it first checks the marker *is* on disk before the shred,
// so a broken scan can't pass by finding nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TOKEN = 'test-token-' + randomBytes(4).toString('hex');
const MARKER = 'MARKER' + randomBytes(8).toString('hex');
const PHONES = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

function filesUnder(dir, skip = new Set()) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p, skip));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function filesContaining(paths, needle) {
  const forms = [Buffer.from(needle, 'utf8'), Buffer.from(needle, 'utf16le')];
  return paths.filter((p) => {
    if (statSync(p).size > 50_000_000) return false;
    const buf = readFileSync(p);
    return forms.some((f) => buf.includes(f));
  });
}

test('the shred leaves nothing behind', { timeout: 30_000 }, async (t) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'otr-shred-'));
  const dataDir = join(sandbox, 'data');
  const tmp = join(sandbox, 'tmp');
  const home = join(sandbox, 'home');
  mkdirSync(tmp);
  mkdirSync(home);
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--no-warnings', join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      TMPDIR: tmp,
      HOME: home,
      FACILITATOR_TOKEN: TOKEN,
      ANTHROPIC_API_KEY: '',
      SHRED_ANIMATION_MS: '200',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  t.after(() => child.kill());
  await new Promise((ok, bad) => {
    child.stdout.on('data', () => output.includes('listening') && ok());
    child.on('exit', () => bad(new Error('server exited: ' + output)));
  });

  const post = async (action, body = {}, facilitator = false) => {
    const res = await fetch(`${base}/api/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(facilitator && { 'x-facilitator-token': TOKEN }) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(json)}`);
    return json;
  };
  const run = (action, body) => post(action, body, true);
  const view = async (query) => {
    const ac = new AbortController();
    const res = await fetch(`${base}/events?${query}`, { signal: ac.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value } = await reader.read();
      buf += decoder.decode(value, { stream: true });
      // Only a complete message: one data line ending in a blank line.
      const m = buf.match(/^data: (.*)\n\n/m);
      if (m) {
        ac.abort();
        return JSON.parse(m[1]);
      }
    }
  };
  const facilitatorView = () => view(`role=facilitator&t=${encodeURIComponent(TOKEN)}`);

  // A whole session.
  await run('advance'); // demo
  await run('advance'); // join
  await run('advance'); // submit
  for (const [i, cid] of PHONES.entries()) {
    await post('submit', { cid, texts: [`card ${i} ${MARKER}`, `another ${i} ${MARKER}`] });
  }
  await run('advance'); // cluster
  let f;
  do f = await facilitatorView();
  while (f.clustering.status === 'running');
  await run('approveTheme', { id: f.themes[0].id, name: `Theme ${MARKER}` });
  await run('advance'); // react
  const groups = (await view(`role=phone&cid=${PHONES[0]}`)).react.groups;
  for (const cid of PHONES) {
    for (const g of groups) await post('react', { cid, groupId: g.id, emojis: ['🙋', '🦆'] });
    await post('reactDone', { cid });
    await post('typing', { cid, text: `typed ${MARKER}` }); // extra fields are ignored
    await post('unsent', { cid, on: true, text: `unsent ${MARKER}` });
    await post('afterthought', { cid, text: `thought ${MARKER}` });
  }
  const counted = await facilitatorView();
  assert.equal(counted.writing, PHONES.length, 'control: the writing count arrived');
  assert.equal(counted.unsent, PHONES.length, 'control: the unsent count arrived');
  assert.equal(JSON.stringify(await view(`role=phone&cid=${PHONES[0]}`)).includes('writing'), false, 'phones get no count');
  assert.ok(JSON.stringify(await facilitatorView()).includes(`thought ${MARKER}`), 'control: the thoughts arrived');
  await run('advance'); // walk
  const gone = await fetch(`${base}/api/signal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid: PHONES[0], kind: 'stay', on: true }) });
  assert.equal(gone.status, 404);
  await run('nextCard');
  await run('advance'); // finale
  assert.ok(JSON.stringify(await view('role=projector')).includes('🦆'));

  // Control: the marker really is on disk before the shred.
  const scanned = () => [
    ...filesUnder(ROOT, new Set(['node_modules', '.git'])),
    ...filesUnder(dataDir),
    ...filesUnder(tmp),
    ...filesUnder(home),
  ];
  assert.ok(filesContaining(filesUnder(dataDir), MARKER).length > 0, 'control: marker should be in the database');

  assert.deepEqual(filesContaining(filesUnder(dataDir), 'typedAt'), [], 'even before the shred, the database holds no typing times');

  // The shred.
  const res = await fetch(`${base}/api/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-facilitator-token': TOKEN },
    body: '{}',
  });
  assert.equal(res.status, 400, 'the shred needs a confirm');
  await run('advance', { confirm: true });
  await new Promise((r) => setTimeout(r, 400)); // the projector's animation payload expires

  assert.deepEqual(readdirSync(dataDir), [], 'data directory is empty');
  assert.deepEqual(filesContaining(scanned(), MARKER), [], 'no file contains a card, thought or theme');
  // The writing count was only ever in memory: no file holds when anyone typed, and it is gone.
  assert.deepEqual(filesContaining([...filesUnder(dataDir), ...filesUnder(tmp), ...filesUnder(home)], 'typedAt'), [], 'no data file holds when a phone typed');
  assert.equal((await post('typing', { cid: PHONES[0] })).ok, true, 'typing after the shred is ignored, not an error');
  assert.equal(JSON.stringify(await facilitatorView()).includes('writing'), false, 'no count survives the shred');
  assert.equal(output.includes(MARKER), false, 'server output contains no content');
  assert.equal(/\b\d{1,3}(\.\d{1,3}){3}\b|::1|::ffff:/.test(output), false, 'server output contains no IP address');
  for (const q of [`role=facilitator&t=${encodeURIComponent(TOKEN)}`, 'role=projector', `role=phone&cid=${PHONES[0]}`]) {
    assert.equal(JSON.stringify(await view(q)).includes(MARKER), false, `${q} view is clean`);
  }
  assert.equal(JSON.stringify(await view('role=projector')).includes('🦆'), false, 'reactions are gone too');

  // The closing screen came up by itself, and Back can't undo the shred.
  assert.equal((await view('role=projector')).phase, 'closing');
  const back = await fetch(`${base}/api/back`, { method: 'POST', headers: { 'x-facilitator-token': TOKEN }, body: '{}' });
  assert.equal(back.status, 400);

  // A new session needs a confirm, and starts clean: a fresh, empty database
  // and no marker anywhere.
  const unconfirmed = await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'x-facilitator-token': TOKEN }, body: '{}' });
  assert.equal(unconfirmed.status, 400);
  await run('reset', { confirm: true });
  assert.equal((await view('role=projector')).phase, 'teaser');
  assert.deepEqual(filesContaining(scanned(), MARKER), [], 'still nothing after starting a new session');
});
