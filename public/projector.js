// The projector. Shows only what the room should see; it has no controls.
import { subscribe, fill, h, formatClock, serverNow } from './shared/client.js';
import { START_DELAY_MS, REPLAY_MS, STEP_MS, MAX_PARTICLES, POOL_DELAY_MS, POOL_MS } from './shared/finale-timing.js';
import { cardSheets, shredTimeline, PRELUDE_MS, FIRST_SHEET_MS, PULL_MS, SHEET_GAP_MS, FADE_MS } from './shared/shred-timing.js';

const app = document.getElementById('app');
const cornerQr = document.getElementById('corner-qr');
const status = document.getElementById('status');
const section = document.getElementById('section');
let latest = null;
// Shown while the app waits on the facilitator; never during the finale, shred or closing.
const waiting = h('div', { class: 'waiting', hidden: true }, 'Waiting for the facilitator to confirm');
document.body.append(waiting);

// The planned time left for this part of the session: a hint for the room,
// hidden once it runs out.
function tickSection() {
  const left = latest?.section ? latest.section.endsAt - serverNow() : 0;
  section.hidden = left <= 0;
  if (left > 0) section.textContent = `${formatClock(left)} left for this part`;
}
setInterval(tickSection, 1000);
let config = { publicUrl: location.origin, repoUrl: '', feedbackUrl: '' };
fetch('/config.json').then((r) => r.json()).then((c) => (config = c)).catch(() => {});

let screen = null;
let screenPhase = null;

subscribe(
  'role=projector',
  (view) => {
    if (view.phase !== screenPhase) {
      screen?.destroy?.();
      screenPhase = view.phase;
      screen = SCREENS[view.phase](view);
      fill(app, screen.el);
    }
    screen.update?.(view);
    latest = view;
    waiting.hidden = !view.waiting || ['finale', 'shred', 'closing'].includes(view.phase);
    tickSection();
    // The join QR stays small in a corner for latecomers, and is hidden for
    // the finale, the shred and the closing.
    cornerQr.classList.toggle('hidden', ['join', 'finale', 'shred', 'closing'].includes(view.phase));
  },
  (online) => status.classList.toggle('offline', !online),
);

const host = () => config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const message = (title, sub) => ({ el: h('div', { class: 'center' }, h('div', {}, h('div', { class: 'huge' }, title), sub && h('div', { class: 'sub' }, sub))) });

const SCREENS = {
  // Task 11 draws the demo; until then, a plain title.
  demo: () => message('Off the Record'),
  join: joinScreen,
  submit: () => message('On your phone'),
  cluster: () => message('Grouping the cards…'),
  react: () => message('On your phone'),
  walk: walkScreen,
  finale: finaleScreen,
  shred: shredScreen,
  closing: () => ({
    el: h(
      'div',
      { class: 'center closing' },
      h(
        'div',
        { class: 'closing-inner' },
        h('img', { class: 'qr', src: '/feedback-qr.svg', alt: '' }),
        h('div', {}, h('h1', {}, 'What do you think?'), h('div', { class: 'url' }, config.feedbackUrl.replace(/^https?:\/\//, ''))),
      ),
    ),
  }),
};

// ---- join ------------------------------------------------------------------

function joinScreen() {
  const phones = h('div', { class: 'phones' });
  const url = h('div', { class: 'url' }, host());
  const repo = h('span');
  const el = h(
    'div',
    { class: 'join' },
    h('img', { class: 'qr', src: '/qr.svg', alt: '' }),
    h(
      'div',
      {},
      h('h1', {}, 'Off the Record'),
      url,
      // The short version, big. The full disclosure (read aloud) as fine print.
      h(
        'ul',
        { class: 'promises' },
        h('li', {}, 'Anonymous: no logins, no names.'),
        h('li', {}, 'Notes you don’t share never leave your phone.'),
        h('li', {}, 'Everything on our server is shredded tonight.'),
      ),
      h(
        'p',
        { class: 'disclosure' },
        'Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. ',
        'Submitted cards go to Anthropic (Claude Haiku) for grouping; they don’t train on them and delete them within 30 days. ',
        'I see cards and comments before they’re shown and can remove any of them to prevent abuse. ',
        'Everything on our server is shredded tonight. Code: ',
        repo,
      ),
      phones,
    ),
  );
  return {
    el,
    update(v) {
      url.textContent = host();
      repo.textContent = config.repoUrl.replace(/^https?:\/\//, '');
      phones.textContent = v.phones ? `${v.phones} ${v.phones === 1 ? 'phone' : 'phones'} here` : '';
    },
  };
}

// ---- walk-through ------------------------------------------------------------

function cardFontSize(text) {
  const n = text.length;
  return n < 50 ? '4.6vw' : n < 100 ? '3.8vw' : n < 150 ? '3.2vw' : '2.8vw';
}

// The emoji mix under the card: size carries the count.
function mixRow(mix) {
  if (!mix?.length) return [];
  const max = mix[0][1];
  return mix.slice(0, 12).map(([e, n]) => {
    // Area, not radius, carries the count.
    const vw = 2.2 + 3.8 * Math.sqrt(n / max);
    return h('span', {}, h('span', { style: { fontSize: `${vw}vw` } }, e), h('small', {}, n));
  });
}

// The overview: the themes as folders in a file drawer, biggest first.
function drawer(themes) {
  return h(
    'div',
    { class: 'drawer' },
    themes.map((t) =>
      h(
        'div',
        { class: 'folder' },
        h('div', { class: 'tab' }, t.name ?? 'A theme'),
        h('div', { class: 'folder-body' }, `${t.cards} ${t.cards === 1 ? 'card' : 'cards'}`),
      ),
    ),
  );
}

function walkScreen() {
  const position = h('span');
  const tab = h('div', { class: 'tab' });
  const text = h('div', { class: 'card-text' });
  const bar = h('div', { class: 'drain' });
  const card = h('div', { class: 'card' }, text, bar);
  const folder = h('div', { class: 'folder-card' }, tab, card);
  const more = h('div', { class: 'more' });
  const mix = h('div', { class: 'mix' });
  const comments = h('div', { class: 'comments' });
  const commentsMore = h('div', { class: 'comments-more' });
  const haiku = h('div', { class: 'haiku' });
  const counts = h('div', { class: 'counts' });
  const controls = h('div', { class: 'controls-line' }, 'From your phone you can ask to stay, or to go back a card.');
  const el = h(
    'div',
    { class: 'walk' },
    h('div', { class: 'top' }, position),
    h('div', { class: 'stage-card' }, folder, more),
    mix,
    h('div', { class: 'under' }, comments, commentsMore, haiku),
    h('div', { class: 'bottom' }, h('div', { class: 'grow' }, controls), counts),
  );
  let view = null;
  let barWidth = null; // the last width seen while the card was running
  let barIndex = null; // the card that width belongs to
  let frame = 0;

  // The bar is full at cardStartedAt and empty at cardEndsAt. While paused it
  // stays at the width last seen running on this page; a card this page never
  // saw running (opened mid-pause, or held on arrival) shows no bar.
  function drawBar() {
    const w = view?.walk;
    const item = w?.item;
    const real = item && !item.overview && !item.last && !item.hidden;
    if (!real || !w) {
      bar.hidden = true;
      barWidth = barIndex = null;
      return;
    }
    if (!w.paused && w.cardEndsAt !== null) {
      const span = w.cardEndsAt - w.cardStartedAt;
      barWidth = span > 0 ? Math.min(1, Math.max(0, (w.cardEndsAt - serverNow()) / span)) : 0;
      barIndex = w.index;
    } else if (barIndex !== w.index) {
      barWidth = barIndex = null;
    }
    bar.hidden = barWidth === null;
    if (barWidth !== null) bar.style.width = `${(barWidth * 100).toFixed(2)}%`;
  }
  function loop() {
    drawBar();
    frame = requestAnimationFrame(loop);
  }
  frame = requestAnimationFrame(loop);

  return {
    el,
    update(v) {
      view = v;
      const w = v.walk;
      const item = w.item;
      const overview = !!item?.overview;
      const last = !!item?.last;
      el.classList.toggle('is-overview', overview);
      el.classList.toggle('is-last', last);
      position.textContent = w.total > 2 && !overview && !last ? `${w.index} / ${w.total - 2}` : '';
      if (overview) {
        fill(folder, h('div', { class: 'overview-title' }, 'Themes'), drawer(item.overview));
        folder.classList.add('plain');
        more.textContent = 'First reactions? Anything surprise you?';
        fill(mix);
      } else {
        // Put the tab and card back (the overview replaced them).
        if (folder.firstChild !== tab) fill(folder, tab, card);
        folder.classList.remove('plain');
        folder.classList.toggle('last', last);
        folder.hidden = !!item?.hidden;
        const body = last ? 'Anything else? Out loud.' : item && !item.hidden ? item.text : '';
        text.textContent = body;
        card.style.fontSize = last ? '6vw' : cardFontSize(body);
        const theme = !last && item?.theme ? item.theme : '';
        tab.textContent = theme;
        tab.hidden = !theme;
        const bits = [];
        if (item?.similar) bits.push(`+${item.similar} similar`);
        if (item?.moreInTheme) bits.push(`+${item.moreInTheme} more like this`);
        more.textContent = bits.join(' · ');
        fill(mix, ...mixRow(item?.mix));
      }
      // Comments no longer arrive live: the server sends a stable few.
      fill(comments, ...w.comments.shown.map((c) => h('div', { class: 'comment' }, c.text)));
      commentsMore.textContent = w.comments.more > 0 ? `+${w.comments.more} more` : '';
      haiku.textContent = !overview && !last && item?.haiku ? item.haiku : '';
      const chip = (n, label) => h('span', { class: n ? '' : 'zero' }, `${label} ${n}`);
      fill(counts, ...(last || overview ? [] : [chip(w.stay, 'Stay'), chip(w.back, 'Go back')]));
      controls.hidden = last;
      drawBar();
    },
    destroy() {
      cancelAnimationFrame(frame);
    },
  };
}

// ---- finale: the emotional fingerprint -------------------------------------
// Every reaction arrives as an emoji in the order it happened (about a
// 10-second replay), then they pool into one emoji per type, sized by count
// (area, not width). Each type's particles together cover about the same area
// as its pool, so pooling reads as the particles merging, not a jump in scale.
// No numbers, no words.

const MIN_POOL_PX = 28;

// Pool size in px per emoji: all pools together fill about a third of the
// screen, and each pool's area is proportional to its count.
function poolSizes(counts, W, H) {
  const max = Math.max(...counts.values());
  const weight = [...counts.values()].reduce((sum, n) => sum + n / max, 0);
  const maxPx = Math.min(Math.sqrt((0.32 * W * H) / weight), Math.min(W, H) * 0.45);
  return new Map([...counts].map(([e, n]) => [e, Math.max(MIN_POOL_PX, maxPx * Math.sqrt(n / max))]));
}

const countOf = (list) => {
  const m = new Map();
  for (const e of list) m.set(e, (m.get(e) ?? 0) + 1);
  return m;
};

function finaleScreen(v) {
  const stage = h('div', { class: 'stage' });
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const sequence = v.finale?.sequence ?? [];
  if (sequence.length) later(() => replay(sequence, stage, later), START_DELAY_MS);
  return {
    el: stage,
    destroy() {
      timers.forEach(clearTimeout);
    },
  };
}

function replay(sequence, stage, later) {
  const W = innerWidth;
  const H = innerHeight;
  const every = Math.ceil(sequence.length / MAX_PARTICLES);
  const sample = sequence.filter((_, i) => i % every === 0);
  const sizes = poolSizes(countOf(sequence), W, H);
  const sampled = countOf(sample);
  const step = Math.min(STEP_MS, REPLAY_MS / sample.length);
  const particles = [];
  sample.forEach((e, i) =>
    later(() => {
      // This particle's share of its pool's area.
      const s = sizes.get(e) / Math.sqrt(sampled.get(e));
      const x = Math.random() * Math.max(0, W - s);
      const y = Math.random() * Math.max(0, H - s);
      const p = h('span', { class: 'particle', style: { fontSize: `${s}px` } }, e);
      p.style.transform = `translate(${x}px, ${y}px) scale(0)`;
      stage.append(p);
      particles.push({ p, e, s });
      requestAnimationFrame(() => requestAnimationFrame(() => (p.style.transform = `translate(${x}px, ${y}px) scale(1)`)));
    }, i * step),
  );
  later(() => pool(particles, sizes, stage), sample.length * step + POOL_DELAY_MS);
}

function pool(particles, sizes, stage) {
  const pools = h('div', { class: 'pools' });
  const byEmoji = new Map();
  // Biggest in the middle, smaller ones alternating out to each side.
  const arranged = [];
  [...sizes].sort((a, b) => b[1] - a[1]).forEach((entry, i) => (i % 2 ? arranged.unshift(entry) : arranged.push(entry)));
  for (const [e, px] of arranged) {
    const el = h('span', { class: 'pool', style: { fontSize: `${px}px` } }, e);
    byEmoji.set(e, el);
    pools.append(el);
  }
  stage.append(pools);
  requestAnimationFrame(() => {
    for (const { p, e, s } of particles) {
      // Land somewhere inside the pool, so together they fill its shape.
      const r = byEmoji.get(e).getBoundingClientRect();
      const x = r.left + Math.random() * Math.max(0, r.width - s);
      const y = r.top + Math.random() * Math.max(0, r.height - s);
      p.style.transform = `translate(${x}px, ${y}px) scale(1)`;
    }
    setTimeout(() => {
      for (const el of byEmoji.values()) el.style.opacity = '1';
      for (const { p } of particles) p.style.opacity = '0';
    }, POOL_MS);
  });
}

// ---- shred -----------------------------------------------------------------

// Before the shredder: a plain "Delete everything?" dialog, and a cursor that
// moves over and clicks Delete. It says what's really happening on the server
// before the shredder shows it as a ritual.
function deletePrelude() {
  const button = h('span', { class: 'del' }, 'Delete');
  const dialog = h(
    'div',
    { class: 'del-dialog' },
    h('div', { class: 'del-title' }, 'Delete everything?'),
    h('div', { class: 'del-body' }, 'Every card, reaction and comment, from the server. This can’t be undone.'),
    h('div', { class: 'del-actions' }, h('span', { class: 'del-cancel' }, 'Cancel'), button),
  );
  const cursor = h('div', { class: 'cursor' });
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const layer = h('div', { class: 'prelude' }, dialog, cursor);
  requestAnimationFrame(() => {
    const target = button.getBoundingClientRect();
    const tx = target.left + target.width * 0.6;
    const ty = target.top + target.height * 0.6;
    const sx = innerWidth * 0.82;
    const sy = innerHeight * 0.9;
    dialog.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, fill: 'backwards' });
    cursor.animate(
      [
        { transform: `translate(${sx}px, ${sy}px)`, offset: 0 },
        { transform: `translate(${sx}px, ${sy}px)`, offset: 0.25 },
        { transform: `translate(${tx}px, ${ty}px)`, easing: 'ease-out', offset: 0.75 },
        { transform: `translate(${tx}px, ${ty}px)`, offset: 1 },
      ],
      { duration: 2300, fill: 'forwards', easing: 'ease-in-out' },
    );
    // The click.
    button.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(0.7)', transform: 'scale(0.95)' }, { filter: 'brightness(1)' }], {
      duration: 260,
      delay: 2350,
    });
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 2700, fill: 'forwards' });
  });
  return layer;
}
// A literal shredder: the pooled emojis, then the cards behind them, are
// pulled down through a slot, come out underneath as narrow strips that sway
// and flutter, and fall into a bin. Ends on black.

const STRIP_VW = 1.2; // narrow enough that no whole word survives
const GRAVITY = 1500; // px/s²
const TERMINAL = 950; // px/s

function shredScreen(v) {
  const root = h('div', { class: 'shredder' });
  const payload = v.shred;
  if (!payload) return { el: root };
  const W = innerWidth;
  const H = innerHeight;
  const slotY = Math.round(H * 0.4);
  const exitY = Math.round(slotY + H * 0.07);
  const binTop = H * 0.66;
  const binBottom = H * 0.985;
  const binLeftTop = W * 0.13;
  const binLeftBottom = W * 0.2;
  const binWall = (y) => {
    const t = Math.min(1, Math.max(0, (y - binTop) / (binBottom - binTop)));
    const left = binLeftTop + (binLeftBottom - binLeftTop) * t;
    return [left, W - left];
  };

  const upper = h('div', { class: 'upper', style: { height: `${slotY}px` } });
  const lower = h('div', { class: 'lower', style: { top: `${exitY}px` } });
  const head = h('div', { class: 'head', style: { top: `${slotY}px`, height: `${exitY - slotY}px` } });
  const slot = h('div', { class: 'slot', style: { top: `${slotY - H * 0.007}px` } });
  const binBack = h('div', { class: 'bin-back', style: { top: `${binTop}px`, height: `${binBottom - binTop}px` } });
  const binFront = h('div', { class: 'bin-front', style: { top: `${binTop}px`, height: `${binBottom - binTop}px` } });
  // Landed strips move in here, clipped to the bin's outline so nothing pokes
  // through its sides.
  const [l0, r0] = binWall(binTop);
  const [l1, r1] = binWall(binBottom);
  const binInside = h('div', {
    class: 'bin-inside',
    style: { clipPath: `polygon(${l0}px 0, ${r0}px 0, ${r1}px ${binBottom}px, ${l1}px ${binBottom}px)` },
  });
  const machine = h('div', { class: 'machine' }, binBack, binInside, upper, lower, head, slot, binFront);
  root.append(machine, deletePrelude());
  // The shredder fades in as the prelude ends.
  machine.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: PRELUDE_MS - 500, fill: 'backwards' });

  // The sheets: pooled emojis first, then the cards (at most 6 sheets, so the
  // shred fits its minute whatever the card count).
  const sheets = [];
  if (payload.emojis.length) {
    const max = payload.emojis[0][1];
    sheets.push(() =>
      h('div', { class: 'sheet sheet-emojis' }, payload.emojis.map(([e, n]) => h('span', { style: { fontSize: `${1.6 + 4 * Math.sqrt(n / max)}vw` } }, e))),
    );
  }
  const chunks = cardSheets(payload.cards);
  const per = chunks[0]?.length ?? 0;
  const columns = per <= 3 ? per : per <= 8 ? 4 : 5;
  const fontVw = per <= 3 ? 1.8 : per <= 8 ? 1.3 : 1.05;
  for (const chunk of chunks) {
    sheets.push(() =>
      h(
        'div',
        { class: 'sheet sheet-cards', style: { gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)` } },
        chunk.map((t) => h('div', { style: { fontSize: `${fontVw}vw` } }, t)),
      ),
    );
  }

  const strips = []; // every strip, in every phase
  const pile = new Float32Array(64); // how high the pile is across the bin
  const pileAt = (x) => pile[Math.min(63, Math.max(0, Math.floor((x / W) * 64)))];
  const timers = [];
  let running = true;

  function feed(make) {
    const sheet = make();
    sheet.style.visibility = 'hidden';
    upper.append(sheet);
    const sw = sheet.offsetWidth;
    const sh = sheet.offsetHeight;
    const left = (W - sw) / 2;
    const top = Math.max(H * 0.03, slotY - sh - H * 0.05);
    sheet.style.left = `${left}px`;
    sheet.style.top = `${top}px`;
    sheet.style.visibility = '';
    const travel = slotY - top + sh;
    const n = Math.max(8, Math.round(sw / ((W * STRIP_VW) / 100)));
    const w = sw / n;
    const start = performance.now() + 700;
    for (let i = 0; i < n; i++) {
      const inner = make();
      inner.style.left = `${-i * w}px`;
      inner.style.top = '0';
      inner.style.width = `${sw}px`;
      const el = h('div', { class: 'strip', style: { width: `${Math.ceil(w)}px`, height: `${sh}px` } }, inner);
      lower.append(el);
      strips.push({
        el,
        start,
        travel,
        x: left + i * w,
        x0: left + i * w,
        y0: top - slotY, // relative to the exit line, mirroring the sheet's slot position
        y: top - slotY,
        w,
        h: sh,
        phase: 'pull',
        angle: 0,
        phi: Math.random() * Math.PI * 2,
        sway: 2 + Math.random() * 5,
        vx: 0,
        vy: 0,
        va: 0,
        curl: 1,
        skew: 0,
      });
    }
    sheet.dataset.start = String(start);
    sheet.dataset.travel = String(travel);
    return sheet;
  }

  const fed = [];
  sheets.forEach((make, i) => timers.push(setTimeout(() => fed.push(feed(make)), FIRST_SHEET_MS + i * (PULL_MS + SHEET_GAP_MS))));
  // Then fade to black. The server moves everyone to the closing screen after
  // a beat of silence (same timeline, public/shared/shred-timing.js).
  const { fadeAt } = shredTimeline(payload);
  timers.push(setTimeout(() => (root.style.opacity = '0'), fadeAt));
  timers.push(setTimeout(() => (running = false), fadeAt + FADE_MS + 500));

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const sheet of fed) {
      const p = Math.min(1, Math.max(0, (now - Number(sheet.dataset.start)) / PULL_MS));
      sheet.style.transform = `translateY(${p * Number(sheet.dataset.travel)}px)`;
      if (p >= 1 && sheet.isConnected) sheet.remove();
    }
    for (const s of strips) {
      if (s.phase === 'landed') continue;
      if (s.phase === 'pull') {
        const p = Math.min(1, Math.max(0, (now - s.start) / PULL_MS));
        s.y = s.y0 + p * s.travel;
        const out = Math.min(1, Math.max(0, (s.y + s.h) / s.h)); // share already through
        s.angle = Math.sin(now / 260 + s.phi) * s.sway * out;
        s.x = s.x0 + Math.sin(now / 410 + s.phi) * 3 * out;
        s.el.style.transformOrigin = `50% ${Math.max(0, -s.y)}px`;
        if (s.y >= 0) {
          // Fully out: let go.
          s.phase = 'fall';
          s.vy = (s.travel / PULL_MS) * 1000;
          const towardBin = (W / 2 - (s.x + s.w / 2)) * 0.25;
          s.vx = (Math.random() - 0.5) * 120 + towardBin;
          s.va = (Math.random() - 0.5) * 160;
          s.el.style.transformOrigin = '50% 0';
        }
      } else {
        s.vy = Math.min(TERMINAL, s.vy + GRAVITY * dt);
        s.vx += Math.sin(now / 180 + s.phi) * 260 * dt; // flutter
        s.vx *= 1 - 0.8 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.angle += s.va * dt;
        s.curl = Math.max(0.45, s.curl - 0.35 * dt); // strips crumple as they fall
        s.skew = Math.sin(now / 150 + s.phi) * 14;
        const screenY = exitY + s.y;
        if (screenY + s.h * s.curl > binTop) {
          const [l, r] = binWall(screenY + s.h * s.curl);
          if (s.x < l) (s.x = l), (s.vx = Math.abs(s.vx) * 0.3);
          if (s.x + s.w > r) (s.x = r - s.w), (s.vx = -Math.abs(s.vx) * 0.3);
        }
        const floor = binBottom - pileAt(s.x + s.w / 2);
        if (screenY + s.h * s.curl >= floor) {
          s.phase = 'landed';
          s.y = floor - s.h * s.curl - exitY;
          const lie = (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 50);
          const i = Math.min(63, Math.max(0, Math.floor(((s.x + s.w / 2) / W) * 64)));
          for (let k = Math.max(0, i - 1); k <= Math.min(63, i + 1); k++) pile[k] += 1.6;
          binInside.append(s.el); // same x; y now measured from the top of the screen
          s.el.style.transform = `translate(${s.x}px, ${s.y + exitY}px) rotate(${s.angle}deg) scaleY(${s.curl}) skewX(${s.skew}deg)`;
          requestAnimationFrame(() => {
            s.el.style.transition = 'transform 0.35s ease-out';
            s.el.style.transform = `translate(${s.x}px, ${s.y + exitY}px) rotate(${lie}deg) scaleY(${s.curl}) skewX(${s.skew}deg)`;
          });
          continue;
        }
      }
      s.el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.angle}deg) scaleY(${s.curl}) skewX(${s.skew}deg)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    el: root,
    destroy() {
      running = false;
      timers.forEach(clearTimeout);
    },
  };
}
