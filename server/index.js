// One small server: static pages, one SSE stream per screen, JSON actions.
//
// Privacy rules this file keeps (see "Privacy and the shred" in the spec):
// - No request logging of any kind. Nothing here prints IPs, URLs or content.
// - Errors print only a fixed label, never card or comment text.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Session, ActionError } from './session.js';
import { openStore } from './db.js';
import { createClusterer } from './cluster.js';
import { createNudgeTagger } from './nudges.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const REPO_URL = process.env.REPO_URL ?? 'https://github.com/ert485/off-the-record';
const FEEDBACK_URL = process.env.FEEDBACK_URL ?? 'https://github.com/ert485/off-the-record/discussions/1';
const TOKEN = process.env.FACILITATOR_TOKEN;
if (!TOKEN || TOKEN.length < 3) {
  console.error('FACILITATOR_TOKEN must be set');
  process.exit(1);
}
const tokenHash = createHash('sha256').update(TOKEN).digest();
const isFacilitator = (t) =>
  typeof t === 'string' && timingSafeEqual(createHash('sha256').update(t).digest(), tokenHash);

let store = openStore(DATA_DIR);
const clusterCards = createClusterer();
const session = new Session({
  state: store.load(),
  clusterCards,
  tagCards: createNudgeTagger(),
  onChange: () => {
    store.save(session.state);
    scheduleBroadcast();
  },
  onShred: () => {
    const left = store.shred();
    if (left.length) console.error('shred: files remain in the data directory');
  },
  shredAnimationMs: process.env.SHRED_ANIMATION_MS ? Number(process.env.SHRED_ANIMATION_MS) : null,
  onReset: () => {
    store = openStore(DATA_DIR);
  },
});
if (!session.shredded) store.save(session.state);

// ---- SSE ----------------------------------------------------------------

const clients = new Set(); // { res, role, cid, last }
const phoneCount = () => new Set([...clients].filter((c) => c.role === 'phone').map((c) => c.cid)).size;

function send(client) {
  const json = JSON.stringify(session.view(client.role, { cid: client.cid, phoneCount: phoneCount() }));
  if (json === client.last) return;
  client.last = json;
  client.res.write(`data: ${json}\n\n`);
}

let broadcastQueued = false;
function scheduleBroadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setTimeout(() => {
    broadcastQueued = false;
    for (const c of clients) send(c);
  }, 50);
}

setInterval(() => session.tick(), 1000).unref();
setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 20_000).unref();

function openStream(req, res, url) {
  const role = url.searchParams.get('role');
  if (role === 'facilitator' && !isFacilitator(url.searchParams.get('t'))) return notFound(res);
  if (!['phone', 'projector', 'facilitator'].includes(role)) return notFound(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  const client = { res, role, cid: url.searchParams.get('cid') ?? undefined, last: null };
  clients.add(client);
  send(client);
  scheduleBroadcast(); // phone counts changed
  req.on('close', () => {
    clients.delete(client);
    scheduleBroadcast();
  });
}

// ---- actions ------------------------------------------------------------

const PHONE_ACTIONS = {
  submit: (b) => session.submitCards(b.cid, b.texts),
  react: (b) => session.react(b.cid, b.groupId, b.emojis, b.receipt),
  reactDone: (b) => session.reactDone(b.cid),
  signal: (b) => session.signal(b.cid, b.kind, b.on),
  requestPause: (b) => session.requestPause(b.cid, b.on),
  openComment: (b) => session.openComment(b.cid),
  cancelComment: (b) => session.cancelComment(b.cid),
  comment: (b) => session.submitComment(b.cid, b.text),
};

const FACILITATOR_ACTIONS = {
  advance: (b) => session.advance({ confirm: b.confirm === true }),
  back: () => session.back(),
  nextCard: () => session.moveCard(1),
  prevCard: () => session.moveCard(-1),
  extend: () => session.extendSubmit(),
  nudges: (b) => session.setNudges(b.on),
  recluster: () => session.recluster(),
  approveTheme: (b) => session.approveTheme(b.id, b.name),
  approveAll: (b) => session.approveAll(b.names),
  reset: (b) => {
    if (b.confirm !== true) throw new ActionError('Confirm the reset');
    session.reset();
  },
  hideCard: (b) => session.hideCard(b.id, b.hidden),
  acceptPause: () => session.acceptPause(),
  holdPause: () => session.holdPause(),
  endPause: () => session.endPause(),
  removeComment: (b) => session.removeComment(b.id),
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new ActionError('Too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ActionError('Bad request');
  }
}

async function handleAction(req, res, name) {
  const facilitator = FACILITATOR_ACTIONS[name];
  const phone = PHONE_ACTIONS[name];
  if (!facilitator && !phone) return notFound(res);
  if (facilitator && !isFacilitator(req.headers['x-facilitator-token'])) return notFound(res);
  try {
    const body = await readJson(req);
    const result = (facilitator ?? phone)(body);
    json(res, 200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
  } catch (err) {
    if (err instanceof ActionError) return json(res, 400, { error: err.message });
    console.error('action failed:', name, err?.name ?? 'Error');
    json(res, 500, { error: 'Something went wrong' });
  }
}

// ---- static -------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const PAGES = { '/': 'phone.html', '/projector': 'projector.html', '/facilitate': 'facilitate.html' };

async function serveFile(res, rel) {
  const path = normalize(join(PUBLIC, rel));
  if (!path.startsWith(PUBLIC + '/')) return notFound(res);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    notFound(res);
  }
}

const qrCache = new Map();
async function serveQr(res, url) {
  if (!qrCache.has(url)) qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
  res.end(qrCache.get(url));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const SECURITY_HEADERS = {
  // The facilitator token lives in a URL: never send it anywhere as a referrer.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://local');
  const path = url.pathname;
  try {
    if (req.method === 'POST' && path.startsWith('/api/')) return await handleAction(req, res, path.slice(5));
    if (req.method !== 'GET') return notFound(res);
    if (path === '/events') return openStream(req, res, url);
    if (path === '/qr.svg') return await serveQr(res, PUBLIC_URL);
    if (path === '/feedback-qr.svg') return await serveQr(res, FEEDBACK_URL);
    if (path === '/favicon.ico') return res.writeHead(204).end();
    if (path === '/config.json') return json(res, 200, { publicUrl: PUBLIC_URL, repoUrl: REPO_URL, feedbackUrl: FEEDBACK_URL });
    if (path === '/facilitate' && !isFacilitator(url.searchParams.get('t'))) return notFound(res);
    if (PAGES[path]) return await serveFile(res, PAGES[path]);
    return await serveFile(res, path.slice(1));
  } catch (err) {
    console.error('request failed:', err?.name ?? 'Error');
    if (!res.headersSent) notFound(res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Off the Record listening on port ${PORT}`);
});
