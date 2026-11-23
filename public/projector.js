// The projector. Shows only what the room should see; it has no controls.
import { subscribe, fill, h, formatClock, serverNow } from './shared/client.js';
import { START_DELAY_MS, REPLAY_MS, STEP_MS, MAX_PARTICLES, POOL_DELAY_MS, POOL_MS } from './shared/finale-timing.js';
import { PRESETS } from './shared/emoji.js';
import { cardSheets, shredTimeline, PRELUDE_MS, FIRST_SHEET_MS, PULL_MS, SHEET_GAP_MS, FADE_MS } from './shared/shred-timing.js';

const app = document.getElementById('app');
const cornerQr = document.getElementById('corner-qr');
const status = document.getElementById('status');
const section = document.getElementById('section');
let latest = null;
// Shown while the app waits on the facilitator; never during the teaser, the
// demo, the finale, the shred or the closing.
const waiting = h('div', { class: 'waiting', hidden: true }, 'Waiting for the facilitator to confirm');
document.body.append(waiting);

// The planned time left for this part of the session: a hint for the room,
// hidden once it runs out, while the app waits on the facilitator, and on the teaser.
function tickSection() {
  const left = latest?.section && !latest.waiting && latest.phase !== 'teaser' ? latest.section.endsAt - serverNow() : 0;
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
    waiting.hidden = !view.waiting || ['teaser', 'demo', 'finale', 'shred', 'closing'].includes(view.phase);
    tickSection();
    // The join QR stays small in a corner for latecomers, and is hidden for
    // the teaser, the demo, the finale, the shred and the closing.
    cornerQr.classList.toggle('hidden', ['teaser', 'demo', 'join', 'finale', 'shred', 'closing'].includes(view.phase));
  },
  (online) => status.classList.toggle('offline', !online),
);

const host = () => config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const message = (title, sub) => ({ el: h('div', { class: 'center' }, h('div', {}, h('div', { class: 'huge' }, title), sub && h('div', { class: 'sub' }, sub))) });

const SCREENS = {
  teaser: teaserScreen,
  demo: demoScreen,
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

// ---- teaser: before anything else, while the room fills ----------------------
// The title large, its lines below, centred. Nothing from the demo.

function teaserScreen() {
  const title = h('div', { class: 'huge' });
  const lines = h('div', { class: 'teaser-lines' });
  return {
    el: h('div', { class: 'center teaser' }, h('div', {}, title, lines)),
    update(v) {
      title.textContent = v.teaser?.title ?? 'Off the Record';
      fill(lines, (v.teaser?.lines ?? []).map((line) => h('div', { class: 'sub' }, line)));
    },
  };
}

// ---- demo: a phone drawn on the projector -------------------------------------
// The server picks the step: on its own while the demo loops (each step for
// its DEMO_STEP_MS, wrapping from the last to the first), or one per "Next" on
// the facilitator view. Steps 1-4 happen on a drawn phone (the real phone's
// look, scaled up so it reads from the back row); step 5 is the walk-through's
// own card layout. Entering a step animates (a step forward, the loop wrapping
// round, or the loop's step that has only just begun); going Back, or
// reloading mid-step, shows it settled. Every step's animation is over at
// least 3 seconds before the loop moves on. Every timeout is cleared when the
// step changes and when the screen is destroyed.

const DEMO_CAPTIONS = [
  'Write private notes. They never leave your phone.',
  'Pick up to 3 to share.',
  'The cards are grouped into themes.',
  'React, and add a comment if you like.',
  'Then we look at them together.',
];
const DEMO_PROMPT = 'Write down something you experienced, felt, or were surprised by in 2026.';
const PHONE_W = 420; // the drawn phone's size in its own pixels, scaled to fit
const PHONE_H = 780;

function demoScreen() {
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => timers.splice(0).forEach(clearTimeout);

  const body = h('div', { class: 'dscreen' });
  const phone = h('div', { class: 'dphone' }, h('div', { class: 'dnotch' }), body);
  const caption = h('div', { class: 'demo-caption' });
  const main = h('div', { class: 'demo-main' }, h('div', { class: 'demo-phone-wrap' }, phone), h('div', { class: 'demo-side' }, caption));
  const revealTop = h('div', { class: 'top demo-top' });
  const reveal = h('div', { class: 'walk demo-reveal', hidden: true });
  const under = underCard(reveal);
  const el = h('div', { class: 'demo' }, main, reveal);
  const title = message('Off the Record').el; // when there is no demo content

  const fit = () => phone.style.setProperty('--s', Math.min((innerWidth * 0.4) / PHONE_W, (innerHeight * 0.94) / PHONE_H));
  fit();
  addEventListener('resize', fit);

  const sharedText = (d) => d.notes.find((n) => n.share).text;
  const cardText = (text) => h('div', { class: 'react-card' }, text);

  // Step 1: the notepad with its private notes.
  function notesStep(d) {
    fill(
      body,
      h('h2', { class: 'pop' }, DEMO_PROMPT),
      h('p', { class: 'small faint pop', style: '--d:0.15s' }, 'Private notes (only on this phone)'),
      d.notes.map((n, i) => h('div', { class: 'note pop', style: `--d:${0.3 + i * 0.45}s` }, h('div', { class: 'text' }, n.text))),
    );
  }

  // Step 2: one note is picked, Share goes live and is tapped, and the note
  // folds into a plain sealed envelope (nothing written on it) that slides up
  // out of the phone. Ends on what the phone says after sharing; the card's
  // text is never shown in this step. Over by about 9 s of the step's 14 s.
  function pickStep(d, animate) {
    const shared = () =>
      fill(
        body,
        h('div', { class: 'dtoast pop' }, 'Shared. You can still share 2 more.'),
        h('p', { class: 'small faint pop', style: '--d:0.3s' }, 'Private notes (only on this phone)'),
        d.notes.filter((n) => !n.share).map((n, i) => h('div', { class: 'note pop', style: `--d:${0.5 + i * 0.25}s` }, h('div', { class: 'text' }, n.text))),
      );
    if (!animate) return shared();
    const share = h('button', { class: 'primary dshare pop', style: `--d:${d.notes.length * 0.15}s`, disabled: true }, h('span', { class: 'dtouch' }), 'Share 1 card');
    const rows = d.notes.map((n, i) => h('div', { class: 'note pickable pop', style: `--d:${i * 0.15}s` }, h('span', { class: 'check' }), h('span', { class: 'text' }, n.text)));
    const note = rows[d.notes.findIndex((n) => n.share)];
    const env = { w: 200, h: 124 };
    const envelope = h('div', { class: 'denv' }, h('div', { class: 'denv-flap' }), h('div', { class: 'denv-seal' }));
    fill(body, rows, share);
    later(() => {
      // The entrances are over; drop them so the transitions below own transform and opacity.
      [...rows, share].forEach((el) => el.classList.remove('pop'));
      note.classList.add('picked');
    }, 1500);
    later(() => (share.disabled = false), 2500);
    later(() => share.classList.add('press'), 3600);
    later(() => {
      // The rest of the list steps back; the note turns to blank paper.
      [...rows.filter((r) => r !== note), share].forEach((el) => el.classList.add('away'));
      note.classList.add('blank');
    }, 4300);
    later(() => {
      // It folds down to the envelope's size as it moves to the middle of the
      // screen, so the envelope has a long way to fly.
      const x = note.offsetLeft + note.offsetWidth / 2;
      const y = note.offsetTop + note.offsetHeight / 2;
      const cx = body.clientWidth / 2;
      const cy = body.clientHeight * 0.42;
      note.style.transform = `translate(${cx - x}px, ${cy - y}px) scale(${env.w / note.offsetWidth}, ${env.h / note.offsetHeight})`;
      Object.assign(envelope.style, { left: `${cx - env.w / 2}px`, top: `${cy - env.h / 2}px` });
      body.append(envelope);
    }, 4700);
    later(() => {
      envelope.classList.add('shown');
      note.classList.add('gone');
    }, 5300);
    later(() => envelope.classList.add('sealed'), 5700); // the flap closes, then the seal
    later(() => (envelope.style.transform = `translateY(${-(envelope.offsetTop + env.h + 60)}px) scale(0.85)`), 6800);
    later(shared, 8100);
  }

  // Step 3: the card under its folder tab, with the theme name and haiku.
  function groupStep(d) {
    const tab = h('div', { class: 'dtab' }, d.theme.name);
    const haiku = d.theme.haiku ? h('div', { class: 'dhaiku' }, haikuParts(d.theme.haiku)) : null;
    fill(body, h('div', { class: 'dfolder' }, tab, h('div', { class: 'dfolder-card' }, sharedText(d))), haiku);
    if (haiku) {
      fitHaiku(haiku);
      document.fonts?.ready.then(() => haiku.isConnected && fitHaiku(haiku));
    }
  }

  // Step 4: presets tapped one by one, the keyboard emoji added, the comment typed.
  function reactStep(d, animate) {
    const r = d.react;
    const buttons = PRESETS.map(({ e, label }) => h('button', {}, h('span', { class: 'e' }, e), h('span', { class: 'l' }, label)));
    const taps = r.presets.map((e) => buttons[PRESETS.findIndex((p) => p.e === e)]).filter(Boolean);
    const chips = h('div', { class: 'row wrap' });
    const own = h('button', { class: 'chip on' }, r.own);
    const typed = h('div', { class: 'dtextarea' });
    const draw = (text) => {
      typed.textContent = text || 'Add a comment (optional)';
      typed.classList.toggle('empty', !text);
    };
    fill(
      body,
      cardText(sharedText(d)),
      h('div', { class: 'emoji-grid' }, buttons),
      h('div', { class: 'row wrap custom-row' }, h('button', { class: 'add-own' }, '＋ Add your own emoji'), chips),
      typed,
      h('div', { class: 'row' }, h('button', { class: 'grow' }, '◀ Previous'), h('button', { class: 'primary grow' }, 'Next')),
    );
    if (!animate) {
      taps.forEach((b) => b.classList.add('on'));
      chips.append(own);
      draw(r.comment);
      return;
    }
    draw('');
    let at = 700;
    for (const b of taps) {
      later(() => b.classList.add('on', 'tap'), at);
      at += 650;
    }
    later(() => {
      own.classList.add('pop');
      chips.append(own);
    }, at);
    at += 900;
    // The comment appears a few characters at a time, in about 1.7 seconds.
    const chars = Array.from(r.comment);
    const tick = 60;
    const per = Math.max(1, Math.ceil(chars.length / (1700 / tick)));
    for (let n = 1; n * per - per < chars.length; n++) {
      const upto = Math.min(n * per, chars.length);
      later(() => draw(chars.slice(0, upto).join('')), at + n * tick);
    }
  }

  // Step 5: the card full size, as in the walk-through (no bar, no position).
  function revealStep(d, animate) {
    const text = sharedText(d);
    const mix = [...(d.reveal.mix ?? [])].sort((a, b) => b[1] - a[1]);
    const comments = (d.reveal.comments ?? []).slice(0, 5);
    const card = h('div', { class: 'card' }, h('div', { class: 'card-text' }, text));
    card.style.fontSize = cardFontSize(text);
    const mixEl = h('div', { class: 'mix' }, ...mixRow(mix));
    [...mixEl.children].forEach((c, i) => c.style.setProperty('--d', `${0.9 + i * 0.25}s`));
    const list = h('div', { class: 'comments' }, comments.map((c, i) => h('div', { class: 'comment', style: `--d:${1.8 + i * 0.5}s` }, c)));
    fill(
      reveal,
      revealTop,
      h('div', { class: 'stage-card' }, h('div', { class: 'folder-card' }, h('div', { class: 'tab' }, d.theme.name), card), h('div', { class: 'more' })),
      mixEl,
      h('div', { class: 'under' }, list, h('div', { class: 'haiku', style: `--d:${2 + comments.length * 0.5}s` }, haikuParts(d.theme.haiku))),
      h('div', { class: 'bottom' }),
    );
    under.layout();
  }

  const STEPS = [notesStep, pickStep, groupStep, reactStep, revealStep];
  let shown = null; // the step on screen, or 'none' when there is no demo content

  return {
    el,
    update(v) {
      const d = v.demo;
      if (!d) {
        if (shown !== 'none') fill(el, title);
        shown = 'none';
        return;
      }
      if (shown === d.step) return;
      // A step forward animates, and so does the loop wrapping back to the
      // first step, or a loop step that has only just begun (the demo
      // arriving from the teaser). Back, and a reload mid-step, show it settled.
      const wrapped = d.auto && shown === STEPS.length - 1 && d.step === 0;
      const fresh = shown === null && d.auto && serverNow() - d.stepStartedAt < 2000;
      const animate = (typeof shown === 'number' && (d.step === shown + 1 || wrapped)) || fresh;
      if (shown === 'none') fill(el, main, reveal);
      shown = d.step;
      clearTimers();
      const last = d.step === STEPS.length - 1;
      main.hidden = last;
      reveal.hidden = !last;
      phone.classList.toggle('animate', animate);
      reveal.classList.toggle('animate', animate);
      const text = DEMO_CAPTIONS[d.step] ?? '';
      fill(last ? revealTop : caption, h('span', { class: animate ? 'cap enter' : 'cap' }, text));
      STEPS[d.step](d, animate);
    },
    destroy() {
      clearTimers();
      removeEventListener('resize', fit);
      under.disconnect();
    },
  };
}

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

// A crowded walk-through card steps --crowd down from 1 to CROWD_FLOOR by
// CROWD_STEP (fitWalk in walkScreen). The card text never goes under
// CARD_FLOOR; the comments' and haiku's floors are in projector.css.
const CROWD_STEP = 0.05;
const CROWD_FLOOR = 0.5;
const CARD_FLOOR = '2.6vw';

function cardFontSize(text) {
  const n = text.length;
  return n < 50 ? '4.6vw' : n < 100 ? '3.8vw' : n < 150 ? '3.2vw' : '2.8vw';
}

// A haiku that looks like one: split at " / ", each segment kept whole on one
// line, with a dimmed " /" after every segment but the last (an element, so
// the room sees the break). Lines break only between segments. fitHaiku
// shrinks a segment wider than its container, down to HAIKU_FLOOR of the base
// size; past that floor, and only then, the segment wraps rather than lose words.
const HAIKU_FLOOR = 0.7;

function haikuParts(text) {
  const segs = String(text ?? '')
    .split(' / ')
    .map((seg) => seg.trim())
    .filter(Boolean);
  return segs.flatMap((seg, i) => {
    if (i === segs.length - 1) return [h('span', { class: 'hseg' }, seg)];
    return [h('span', { class: 'hseg' }, seg, h('span', { class: 'hsep' }, ' /')), ' '];
  });
}

function fitHaiku(el) {
  const segs = [...el.querySelectorAll('.hseg')];
  for (const seg of segs) {
    seg.style.fontSize = '';
    seg.classList.remove('hwrap');
  }
  if (!segs.length || !el.offsetParent) return; // not laid out
  const css = getComputedStyle(el);
  const room = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  if (room <= 0) return;
  for (const seg of segs) {
    let scale = 1;
    // Text width isn't exactly proportional to font size: a few passes settle it.
    for (let i = 0; i < 4 && seg.offsetWidth > room && scale > HAIKU_FLOOR; i++) {
      scale = Math.max(HAIKU_FLOOR, Math.floor(scale * (room / seg.offsetWidth) * 1000) / 1000 - 0.005);
      seg.style.fontSize = `${scale}em`;
    }
    if (seg.offsetWidth > room) seg.classList.add('hwrap');
  }
}

// The emoji mix under the card: size carries the count.
function mixRow(mix) {
  if (!mix?.length) return [];
  const max = mix[0][1];
  return mix.slice(0, 12).map(([e, n]) => {
    // Area, not radius, carries the count.
    const vw = 2.2 + 3.8 * Math.sqrt(n / max);
    return h('span', {}, h('span', { style: { fontSize: `calc(${vw}vw * var(--mix-scale, 1))` } }, e), h('small', {}, n));
  });
}

// Lays out what sits under the card. The emoji mix stays one row: when it is
// wider than its space (up to 12 big emojis), the whole row shrinks to fit
// instead of wrapping (no room for a second row) or running under the corner
// QR. The comments column starts at the card's left edge, wherever the centred
// card lands; offsetLeft is the laid-out position, so the demo's entrance
// animations (transforms) don't skew it. Re-run when the card or screen
// resizes, and whenever a font finishes loading (the emoji font loads only once
// an emoji is drawn, often after document.fonts.ready). With fit, every re-run
// goes through it (fit calls layout itself, as often as it needs).
function underCard(walk, fit) {
  const layout = () => {
    const mix = walk.querySelector('.mix');
    if (mix?.offsetParent) {
      mix.style.removeProperty('--mix-scale');
      const css = getComputedStyle(mix);
      const gaps = parseFloat(css.columnGap) * Math.max(0, mix.children.length - 1);
      const room = mix.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - gaps;
      const need = [...mix.children].reduce((n, c) => n + c.offsetWidth, 0);
      if (need > room && need > 0) mix.style.setProperty('--mix-scale', String(Math.max(0.3, room / need)));
    }
    const card = walk.querySelector('.card');
    const under = walk.querySelector('.under');
    if (!under) return;
    under.style.paddingLeft = '';
    if (card?.offsetParent === walk) under.style.paddingLeft = `${Math.max(0, card.offsetLeft - under.offsetLeft)}px`;
    walk.querySelectorAll('.haiku').forEach(fitHaiku); // its width follows that padding
  };
  const run = () => (fit ? fit(layout) : layout());
  const observer = new ResizeObserver(run);
  observer.observe(walk);
  document.fonts?.ready.then(run);
  document.fonts?.addEventListener('loadingdone', run);
  return {
    layout() {
      const card = walk.querySelector('.card');
      if (card) observer.observe(card);
      run();
    },
    disconnect() {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', run);
    },
  };
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
  const bottom = el.lastChild;
  let said = { shown: [], more: 0 }; // this card's comments, oldest first

  // The first n comments; the rest join the server's "+N more".
  function drawComments(n) {
    fill(comments, ...said.shown.slice(0, n).map((c) => h('div', { class: 'comment' }, c.text)));
    const more = said.more + said.shown.length - n;
    commentsMore.textContent = more > 0 ? `+${more} more` : '';
  }

  // A crowded card fits the screen: everything from the card to the counts row
  // ends above the walk's bottom padding (kept for the waiting line). Start at
  // the normal sizes with every comment; while it overflows, step --crowd down
  // (the card text, comments, haiku and the gaps all scale by it, each only to
  // its floor); if it still overflows at CROWD_FLOOR, drop
  // comments from the newest into "+N more". Bounded: one measure per step.
  function fitWalk(layout) {
    el.style.removeProperty('--crowd');
    let n = said.shown.length;
    drawComments(n);
    layout();
    if (!el.offsetParent) return; // not on screen
    const fits = () => {
      const limit = el.getBoundingClientRect().bottom - parseFloat(getComputedStyle(el).paddingBottom);
      return bottom.getBoundingClientRect().bottom <= limit + 0.5;
    };
    for (let step = 1; !fits() && 1 - step * CROWD_STEP >= CROWD_FLOOR - 1e-9; step++) {
      el.style.setProperty('--crowd', (1 - step * CROWD_STEP).toFixed(2));
      layout();
    }
    while (n > 0 && !fits()) {
      drawComments(--n);
      layout();
    }
  }

  const under = underCard(el, fitWalk);
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
        more.textContent = '';
        fill(mix);
      } else {
        // Put the tab and card back (the overview replaced them).
        if (folder.firstChild !== tab) fill(folder, tab, card);
        folder.classList.remove('plain');
        folder.classList.toggle('last', last);
        folder.hidden = !!item?.hidden;
        const body = last ? 'Anything else? Out loud.' : item && !item.hidden ? item.text : '';
        text.textContent = body;
        card.style.fontSize = last ? '6vw' : `max(${CARD_FLOOR}, calc(${cardFontSize(body)} * var(--crowd, 1)))`;
        const theme = !last && item?.theme ? item.theme : '';
        tab.textContent = theme;
        tab.hidden = !theme;
        const bits = [];
        if (item?.similar) bits.push(`+${item.similar} similar`);
        if (item?.moreInTheme) bits.push(`+${item.moreInTheme} more like this`);
        more.textContent = bits.join(' · ');
        fill(mix, ...mixRow(item?.mix));
      }
      // Comments no longer arrive live: the server sends a stable few (none for a hidden card).
      // under.layout() below draws as many of them as fit.
      said = item?.hidden ? { shown: [], more: 0 } : w.comments;
      fill(haiku, !overview && !last && item?.haiku ? haikuParts(item.haiku) : []);
      const chip = (n, label) => h('span', { class: n ? '' : 'zero' }, `${label} ${n}`);
      fill(counts, ...(last || overview ? [] : [chip(w.stay, 'Stay'), chip(w.back, 'Go back')]));
      controls.hidden = last;
      drawBar();
      under.layout();
    },
    destroy() {
      cancelAnimationFrame(frame);
      under.disconnect();
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
