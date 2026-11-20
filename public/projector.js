// The projector. Shows only what the room should see; it has no controls.
import { subscribe, fill, h, formatClock, serverNow } from './shared/client.js';

const app = document.getElementById('app');
const cornerQr = document.getElementById('corner-qr');
const status = document.getElementById('status');
let config = { publicUrl: location.origin, repoUrl: '' };
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
    // The join QR stays small in a corner for latecomers, and is hidden for
    // the finale, the shred and the closing.
    cornerQr.classList.toggle('hidden', ['join', 'finale', 'shred', 'closing'].includes(view.phase));
  },
  (online) => status.classList.toggle('offline', !online),
);

const host = () => config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const message = (title, sub) => ({ el: h('div', { class: 'center' }, h('div', {}, h('div', { class: 'huge' }, title), sub && h('div', { class: 'sub' }, sub))) });

const SCREENS = {
  join: joinScreen,
  submit: () => message('On your phone'),
  cluster: () => message('Grouping the cards…'),
  react: () => message('On your phone'),
  walk: walkScreen,
  lastcall: walkScreen,
  finale: finaleScreen,
  shred: shredScreen,
  closing: () => ({
    el: h('div', { class: 'center closing' }, h('div', {}, h('h1', {}, 'What do you think?'), h('div', { class: 'url' }, config.repoUrl.replace(/^https?:\/\//, '')))),
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
      h(
        'p',
        { class: 'disclosure' },
        'Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. ',
        'Submitted cards go to Anthropic (Claude Haiku) for grouping; they don’t train on them and delete them within 30 days. ',
        'I see cards before they’re shown and can remove any card or comment to prevent abuse. ',
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

// ---- walk-through and last call ---------------------------------------------

function cardFontSize(text) {
  const n = text.length;
  return n < 50 ? '5.6vw' : n < 100 ? '4.4vw' : n < 150 ? '3.6vw' : '3vw';
}

function mixRow(mix) {
  if (!mix?.length) return [];
  const max = mix[0][1];
  return mix.slice(0, 12).map(([e, n]) => {
    // Area, not radius, carries the count.
    const vw = 2.4 + 4.6 * Math.sqrt(n / max);
    return h('span', {}, h('span', { style: { fontSize: `${vw}vw` } }, e), h('small', {}, n));
  });
}

function walkScreen(first) {
  const last = first.phase === 'lastcall';
  const theme = h('span', { class: 'theme' });
  const position = h('span');
  const card = h('div', { class: 'card' });
  const more = h('div', { class: 'more' });
  const mix = h('div', { class: 'mix' });
  const comments = h('div', { class: 'comments' });
  const banner = h('div', { class: 'pause-banner' });
  const counts = h('div', { class: 'counts' });
  const bar = h('div', { class: 'bar' });
  const controls = h('div', { class: 'controls-line' }, last ? '' : 'From your phone you can ask to stay, move on, or go back.');
  const el = h(
    'div',
    { class: 'walk' },
    h('div', { class: 'top' }, theme, position),
    h('div', { style: { alignSelf: 'center' } }, card, more),
    mix,
    h('div', { class: 'bottom' }, h('div', { class: 'grow stack' }, banner, comments, controls), counts),
    bar,
  );
  let view = first;

  function tick() {
    const w = view.walk;
    if (w?.pause) {
      const end = w.pause.graceEndsAt ?? w.pause.endsAt;
      fill(banner, h('span', {}, w.pause.graceEndsAt ? 'Last few seconds' : 'Anonymous pause: comment from your phone'), h('span', { class: 'clock' }, formatClock(end - serverNow())));
    } else fill(banner, );
    if (!last && w?.cardStartedAt) {
      const share = Math.min(1, (serverNow() - w.cardStartedAt) / w.budgetMs);
      bar.style.width = `${share * 100}%`;
    }
  }
  const interval = setInterval(tick, 500);

  let shownComments = new Set();
  return {
    el,
    update(v) {
      view = v;
      const w = v.walk;
      if (last) {
        card.textContent = 'Last call';
        card.style.fontSize = '6vw';
        more.textContent = 'One more chance to ask for an anonymous pause.';
      } else {
        const item = w.item;
        const text = item && !item.hidden ? item.text : '';
        card.textContent = text;
        card.style.fontSize = cardFontSize(text);
        theme.textContent = item?.theme ?? '';
        position.textContent = w.total ? `${w.index + 1} / ${w.total}` : '';
        const bits = [];
        if (item?.similar) bits.push(`+${item.similar} similar`);
        if (item?.moreInTheme) bits.push(`+${item.moreInTheme} more like this`);
        more.textContent = bits.join(' · ');
        fill(mix, ...mixRow(item?.mix));
      }
      // Comments arrive live; only new ones animate in.
      const ids = new Set(w.comments.map((c) => c.id));
      if ([...ids].some((id) => !shownComments.has(id)) || ids.size !== shownComments.size) {
        fill(comments, ...w.comments.slice(-6).map((c) => h('div', { class: 'comment', style: shownComments.has(c.id) ? { animation: 'none' } : {} }, c.text)));
        shownComments = ids;
      }
      const chip = (n, label) => h('span', { class: n ? '' : 'zero' }, `${label} ${n}`);
      fill(counts, 
        ...(last ? [] : [chip(w.stay, 'Stay'), chip(w.back, 'Go back')]),
        chip(w.pauseRequests, w.pauseHeld ? 'Pause (held)' : 'Pause'),
      );
      tick();
    },
    destroy() {
      clearInterval(interval);
    },
  };
}

// ---- finale: the emotional fingerprint -------------------------------------
// Every reaction arrives as a small emoji in the order it happened (about a
// 10-second replay), then they pool into one emoji per type, sized by count
// (area, not radius). No numbers, no words.

const REPLAY_MS = 10_000;
const MAX_PARTICLES = 700;

function finaleScreen(v) {
  const stage = h('div', { class: 'stage' });
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const sequence = v.finale?.sequence ?? [];
  if (sequence.length) {
    const every = Math.ceil(sequence.length / MAX_PARTICLES);
    const sample = sequence.filter((_, i) => i % every === 0);
    const step = Math.min(250, REPLAY_MS / sample.length);
    const particles = [];
    later(() => {
      const W = innerWidth;
      const H = innerHeight;
      sample.forEach((e, i) =>
        later(() => {
          const p = h('span', { class: 'particle' }, e);
          const x = W * (0.06 + 0.88 * Math.random()) - 14;
          const y = H * (0.08 + 0.84 * Math.random()) - 14;
          p.style.transform = `translate(${x}px, ${y}px) scale(0)`;
          stage.append(p);
          particles.push({ p, e, x, y });
          requestAnimationFrame(() => requestAnimationFrame(() => (p.style.transform = `translate(${x}px, ${y}px) scale(1)`)));
        }, i * step),
      );
      later(() => pool(particles, sequence, stage), sample.length * step + 2000);
    }, 1200);
  }
  return {
    el: stage,
    destroy() {
      timers.forEach(clearTimeout);
    },
  };
}

function pool(particles, sequence, stage) {
  const counts = new Map();
  for (const e of sequence) counts.set(e, (counts.get(e) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];
  const maxPx = Math.min(innerWidth, innerHeight) * 0.26;
  const pools = h('div', { class: 'pools' });
  const byEmoji = new Map();
  // Biggest in the middle, smaller ones alternating out to each side.
  const arranged = [];
  sorted.forEach((entry, i) => (i % 2 ? arranged.unshift(entry) : arranged.push(entry)));
  for (const [e, n] of arranged) {
    const px = Math.max(26, maxPx * Math.sqrt(n / max));
    const el = h('span', { class: 'pool', style: { fontSize: `${px}px` } }, e);
    byEmoji.set(e, el);
    pools.append(el);
  }
  stage.append(pools);
  requestAnimationFrame(() => {
    for (const { p, e } of particles) {
      const r = byEmoji.get(e).getBoundingClientRect();
      const jitter = () => (Math.random() - 0.5) * r.width * 0.3;
      p.style.transform = `translate(${r.left + r.width / 2 - 14 + jitter()}px, ${r.top + r.height / 2 - 14 + jitter()}px) scale(0.8)`;
    }
    setTimeout(() => {
      for (const el of byEmoji.values()) el.style.opacity = '1';
      for (const { p } of particles) p.style.opacity = '0';
    }, 1100);
  });
}

// ---- shred -----------------------------------------------------------------
// A literal shredder: the pooled emojis, then the cards behind them, are
// pulled down through a slot and fall away as strips. Ends on black.

const STRIPS = 12;
const PULL_MS = 2600;

function shredScreen(v) {
  const root = h('div', { class: 'shredder' });
  const payload = v.shred;
  if (!payload) return { el: root };
  const timers = [];
  const H = innerHeight;
  const slotY = Math.round(H * 0.62);
  const upper = h('div', { class: 'upper', style: { height: `${slotY}px` } });
  const lower = h('div', { class: 'lower', style: { top: `${slotY}px` } });
  const slot = h('div', { class: 'slot', style: { top: `${slotY - H * 0.007}px` } });
  const body = h('div', { class: 'body', style: { top: `${slotY}px` } });
  root.append(upper, body, lower, slot);

  const sheets = [];
  if (payload.emojis.length) {
    const max = payload.emojis[0][1];
    sheets.push(() =>
      h('div', { class: 'sheet sheet-emojis' }, payload.emojis.map(([e, n]) => h('span', { style: { fontSize: `${1.6 + 4 * Math.sqrt(n / max)}vw` } }, e))),
    );
  }
  const cards = payload.cards;
  // At most 6 sheets, so the shred fits its minute whatever the card count.
  const sheetCount = Math.min(6, Math.ceil(cards.length / 3));
  const per = Math.ceil(cards.length / Math.max(1, sheetCount));
  const columns = Math.min(per, 4);
  const fontVw = per <= 3 ? 1.8 : per <= 8 ? 1.3 : 1.05;
  for (let i = 0; i < cards.length; i += per) {
    const chunk = cards.slice(i, i + per);
    sheets.push(() =>
      h(
        'div',
        { class: 'sheet sheet-cards', style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } },
        chunk.map((t) => h('div', { style: { fontSize: `${fontVw}vw` } }, t)),
      ),
    );
  }

  const shredOne = (make) => {
    const sheet = make();
    sheet.style.visibility = 'hidden';
    upper.append(sheet);
    const height = sheet.offsetHeight;
    const top = Math.max(H * 0.04, slotY - height - H * 0.06);
    sheet.style.top = `${top}px`;
    sheet.style.visibility = '';
    const fullDistance = slotY - top + height + 8;
    const pull = [{ transform: 'translateY(0)' }, { transform: `translateY(${fullDistance}px)` }];
    const strips = [];
    for (let s = 0; s < STRIPS; s++) {
      const strip = make();
      strip.classList.add('strip');
      strip.style.top = `${top - slotY}px`;
      // A thin cut between neighbouring strips.
      strip.style.clipPath = `inset(0 calc(${100 - ((s + 1) * 100) / STRIPS}% + 2px) 0 calc(${(s * 100) / STRIPS}% + 2px))`;
      lower.append(strip);
      strips.push(strip);
    }
    timers.push(
      setTimeout(() => {
        const opts = { duration: PULL_MS, easing: 'cubic-bezier(0.4, 0, 0.9, 1)', fill: 'forwards' };
        sheet.animate(pull, opts).finished.then(() => sheet.remove(), () => {});
        strips.forEach((strip, s) => {
          // Strips fan out slightly as they come through the slot.
          const spread = (s - (STRIPS - 1) / 2) * 7;
          const through = [{ transform: 'translate(0, 0)' }, { transform: `translate(${spread}px, ${fullDistance}px)` }];
          strip.animate(through, opts).finished.then(() => {
            const drift = spread * (1.5 + Math.random());
            strip
              .animate(
                [
                  { transform: `translate(${spread}px, ${fullDistance}px)`, opacity: 1 },
                  { transform: `translate(${drift}px, ${fullDistance + H * 0.5}px) rotate(${(Math.random() - 0.5) * 30}deg)`, opacity: 0 },
                ],
                { duration: 1400 + Math.random() * 900, easing: 'ease-in', fill: 'forwards' },
              )
              .finished.then(() => strip.remove(), () => {});
          }, () => {});
        });
      }, 900),
    );
  };

  let t = 800;
  for (const make of sheets) {
    timers.push(setTimeout(() => shredOne(make), t));
    t += PULL_MS + 600;
  }
  // Then the shredder itself fades, leaving black and a beat of silence.
  timers.push(setTimeout(() => (root.style.opacity = '0'), t + 2200));
  return {
    el: root,
    destroy() {
      timers.forEach(clearTimeout);
    },
  };
}
