// The projector. Shows only what the room should see; it has no controls.
import { subscribe, fill, h, formatClock, serverNow } from './shared/client.js';
import { finaleTimeline, arrivalMs, sampleEvery, POOL_MS } from './shared/finale-timing.js';
import { PRESETS } from './shared/emoji.js';
import { struckParts } from './shared/struck.js';
import { cardSheets, shredTimeline, PRELUDE_MS, FADE_MS } from './shared/shred-timing.js';

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
// The title large, its lines below, centred. Nothing from the demo. ~~words~~
// in a line show struck through, still readable.

function teaserScreen() {
  const title = h('div', { class: 'huge' });
  const lines = h('div', { class: 'teaser-lines' });
  return {
    el: h('div', { class: 'center teaser' }, h('div', {}, title, lines)),
    update(v) {
      title.textContent = v.teaser?.title ?? 'Off the Record';
      fill(lines, (v.teaser?.lines ?? []).map((line) => h('div', { class: 'sub' }, struckParts(line).map((p) => (p.struck ? h('s', { class: 'struck' }, p.text) : p.text)))));
    },
  };
}

// ---- demo: a phone drawn on the projector -------------------------------------
// The server picks the step: on its own while the demo loops (each step for
// its DEMO_STEP_MS, wrapping from the last to the first), or one per "Next" on
// the facilitator view. Steps 1-4 happen on a drawn phone (the real phone's
// look, scaled up so it reads from the back row); step 5 is the walk-through's
// own card layout. Entering a step animates (a step forward, the loop wrapping
// round or starting again from step 1 on "Play on a loop", or the loop's step
// that has only just begun); going Back, or
// reloading mid-step, shows it settled. Every step's animation is over at
// least 3 seconds before the loop moves on. Every timeout is cleared when the
// step changes and when the screen is destroyed.

const DEMO_CAPTIONS = [
  'Write private notes. They stay on your phone for now.',
  'Pick up to 3 to share.',
  'The cards are grouped into themes.',
  'React with emojis. At the end, add a thought if you like.',
  'Then we look at them together.',
];
const DEMO_PROMPT = 'Write down something you experienced, felt, or were surprised by in 2026.';
const DEMO_PLACEHOLDER = 'Write freely. Notes stay on this phone until you choose to share them.';
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
  // The reveal fits the screen as a crowded walk-through card does (it has no comments to drop).
  const under = underCard(
    reveal,
    crowdFit(reveal, () => 0, () => {}),
  );
  const el = h('div', { class: 'demo' }, main, reveal);
  const title = message('Off the Record').el; // when there is no demo content

  const fit = () => phone.style.setProperty('--s', Math.min((innerWidth * 0.4) / PHONE_W, (innerHeight * 0.94) / PHONE_H));
  fit();
  addEventListener('resize', fit);

  // The first shared note: the card the group, react and reveal steps show.
  const sharedText = (d) => d.notes.find((n) => n.share).text;
  const cardText = (text) => h('div', { class: 'react-card' }, text);
  const notesHead = (attrs) => h('p', attrs, 'Private notes (only on this phone)');

  // Step 1: the prompt and an empty writing box, then the private notes
  // arrive one at a time, as if written (from 2.5 s, 0.9 s apart).
  function notesStep(d) {
    fill(
      body,
      h('h2', { class: 'pop' }, DEMO_PROMPT),
      h('div', { class: 'dtextarea empty pop', style: '--d:0.15s' }, DEMO_PLACEHOLDER),
      notesHead({ class: 'small faint pop', style: '--d:2.5s' }),
      d.notes.map((n, i) => h('div', { class: 'note pop', style: `--d:${2.5 + i * 0.9}s` }, h('div', { class: 'text' }, n.text))),
    );
  }

  // Step 2: the shared notes are checked one by one (0.8 s apart), the Share
  // button counts them, goes live and is tapped, and the picked notes fold
  // together into one plain sealed envelope (nothing written on it) that
  // slides up out of the phone. Ends on what the phone says after sharing,
  // with the unshared notes still listed; no card's text is shown in this
  // step. Over by about 10 s of the step's 16 s.
  function pickStep(d, animate) {
    const shared = () =>
      fill(
        body,
        h('div', { class: 'dtoast pop' }, 'Shared.'),
        d.notes.some((n) => !n.share) && notesHead({ class: 'small faint pop', style: '--d:0.3s' }),
        d.notes.filter((n) => !n.share).map((n, i) => h('div', { class: 'note pop', style: `--d:${0.5 + i * 0.25}s` }, h('div', { class: 'text' }, n.text))),
      );
    if (!animate) return shared();
    const label = h('span', {}, 'Share 1 card');
    const share = h('button', { class: 'primary dshare pop', style: `--d:${d.notes.length * 0.15}s`, disabled: true }, h('span', { class: 'dtouch' }), label);
    const rows = d.notes.map((n, i) => h('div', { class: 'note pickable pop', style: `--d:${i * 0.15}s` }, h('span', { class: 'check' }), h('span', { class: 'text' }, n.text)));
    const picks = rows.filter((_, i) => d.notes[i].share);
    const env = { w: 200, h: 124 };
    const envelope = h('div', { class: 'denv' }, h('div', { class: 'denv-flap' }), h('div', { class: 'denv-seal' }));
    fill(body, rows, share);
    // The entrances are over; drop them so the transitions below own transform and opacity.
    later(() => [...rows, share].forEach((el) => el.classList.remove('pop')), 1400);
    picks.forEach((note, i) =>
      later(() => {
        note.classList.add('picked');
        share.disabled = false;
        label.textContent = i > 0 ? `Share ${i + 1} cards` : 'Share 1 card';
      }, 1500 + i * 800),
    );
    let at = 1500 + (picks.length - 1) * 800 + 1100;
    later(() => share.classList.add('press'), at);
    later(() => {
      // The rest of the list steps back; the picked notes turn to blank paper.
      [...rows.filter((r) => !picks.includes(r)), share].forEach((el) => el.classList.add('away'));
      picks.forEach((note) => note.classList.add('blank'));
    }, (at += 700));
    later(() => {
      // They fold down to the envelope's size as they move together to the
      // middle of the screen, so the envelope has a long way to fly.
      const cx = body.clientWidth / 2;
      const cy = body.clientHeight * 0.42;
      for (const note of picks) {
        const x = note.offsetLeft + note.offsetWidth / 2;
        const y = note.offsetTop + note.offsetHeight / 2;
        note.style.transform = `translate(${cx - x}px, ${cy - y}px) scale(${env.w / note.offsetWidth}, ${env.h / note.offsetHeight})`;
      }
      Object.assign(envelope.style, { left: `${cx - env.w / 2}px`, top: `${cy - env.h / 2}px` });
      body.append(envelope);
    }, (at += 400));
    later(() => {
      envelope.classList.add('shown');
      picks.forEach((note) => note.classList.add('gone'));
    }, (at += 600));
    later(() => envelope.classList.add('sealed'), (at += 400)); // the flap closes, then the seal
    later(() => (envelope.style.transform = `translateY(${-(envelope.offsetTop + env.h + 60)}px) scale(0.85)`), (at += 1100));
    later(shared, at + 1300);
  }

  // Step 3: the first shared note arrives alone in a plain folder. From 2.5 s
  // the folder's tab name appears a few characters at a time, then the haiku
  // one segment at a time (0.9 s apart); all settled by about 9 s of the
  // step's 16 s.
  function groupStep(d, animate) {
    const tab = h('div', { class: 'dtab' });
    const name = (text) => (tab.textContent = text || ' '); // an empty tab keeps its height
    const haiku = d.theme.haiku ? h('div', { class: 'dhaiku' }, haikuParts(d.theme.haiku)) : null;
    const segs = haiku ? [...haiku.querySelectorAll('.hseg')] : [];
    // Hidden before they're first drawn, so they don't fade out on arrival.
    if (animate) segs.forEach((seg) => seg.classList.add('later'));
    fill(body, h('div', { class: 'dfolder' }, tab, h('div', { class: 'dfolder-card' }, sharedText(d))), haiku);
    if (haiku) {
      fitHaiku(haiku);
      document.fonts?.ready.then(() => haiku.isConnected && fitHaiku(haiku));
    }
    if (!animate) return name(d.theme.name);
    name('');
    // Two characters every 60 ms: even a 60-character name is in within 2 seconds.
    const chars = Array.from(d.theme.name);
    let at = 2500;
    for (let upto = 2; upto - 2 < chars.length; upto += 2, at += 60) {
      const text = chars.slice(0, upto).join('');
      later(() => name(text), at);
    }
    at += 600;
    // A haiku with many segments brings them closer together, so the last is in by about 8.4 s.
    const gap = Math.min(900, (8400 - at) / Math.max(1, segs.length - 1));
    segs.forEach((seg, i) => later(() => seg.classList.remove('later'), at + i * gap));
  }

  // Step 4: presets tapped one by one, then the keyboard emoji added. No
  // comment box: a thought comes at the end, not on each card.
  function reactStep(d, animate) {
    const r = d.react;
    const buttons = PRESETS.map(({ e, label }) => h('button', {}, h('span', { class: 'e' }, e), h('span', { class: 'l' }, label)));
    const taps = r.presets.map((e) => buttons[PRESETS.findIndex((p) => p.e === e)]).filter(Boolean);
    const chips = h('div', { class: 'row wrap' });
    const own = h('button', { class: 'chip on' }, r.own);
    fill(
      body,
      cardText(sharedText(d)),
      h('div', { class: 'emoji-grid' }, buttons),
      h('div', { class: 'row wrap custom-row' }, h('button', { class: 'add-own' }, '＋ Add your own emoji'), chips),
      h('div', { class: 'row' }, h('button', { class: 'grow' }, '◀ Previous'), h('button', { class: 'primary grow' }, 'Next')),
    );
    if (!animate) {
      taps.forEach((b) => b.classList.add('on'));
      chips.append(own);
      return;
    }
    let at = 700;
    for (const b of taps) {
      later(() => b.classList.add('on', 'tap'), at);
      at += 650;
    }
    later(() => {
      own.classList.add('pop');
      chips.append(own);
    }, at);
  }

  // Step 5: the card full size, as in the walk-through (no bar, no position),
  // fitted to the screen the same way: its emoji mix and the haiku, no comments.
  function revealStep(d) {
    const text = sharedText(d);
    const mix = [...(d.reveal.mix ?? [])].sort((a, b) => b[1] - a[1]);
    const card = h('div', { class: 'card' }, h('div', { class: 'card-text' }, text));
    card.style.fontSize = crowdedCardSize(text);
    const mixEl = h('div', { class: 'mix' }, ...mixRow(mix));
    [...mixEl.children].forEach((c, i) => c.style.setProperty('--d', `${0.9 + i * 0.25}s`));
    fill(
      reveal,
      revealTop,
      h('div', { class: 'stage-card' }, h('div', { class: 'folder-card' }, h('div', { class: 'tab' }, d.theme.name), card), h('div', { class: 'more' })),
      mixEl,
      h('div', { class: 'under' }, h('div', { class: 'haiku', style: '--d:1.8s' }, haikuParts(d.theme.haiku))),
      h('div', { class: 'bottom' }),
    );
    under.layout();
  }

  const STEPS = [notesStep, pickStep, groupStep, reactStep, revealStep];
  let shown = null; // the step on screen, or 'none' when there is no demo content
  let shownAuto = null; // whether it was looping at the last update (null before the first)

  return {
    el,
    update(v) {
      const d = v.demo;
      if (!d) {
        if (shown !== 'none') fill(el, title);
        shown = 'none';
        return;
      }
      // "Play on a loop" starts again from the first step, even when that is
      // the step already showing.
      const played = shownAuto === false && d.auto;
      shownAuto = d.auto;
      if (shown === d.step && !played) return;
      // A step forward animates, and so does the loop going back to the first
      // step (wrapping round, or "Play on a loop"), or a loop step that has
      // only just begun (the demo arriving from the teaser). Back, and a
      // reload mid-step, show it settled.
      const restarted = d.auto && typeof shown === 'number' && d.step === 0;
      const fresh = shown === null && d.auto && serverNow() - d.stepStartedAt < 2000;
      const animate = (typeof shown === 'number' && d.step === shown + 1) || restarted || fresh;
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
// CROWD_STEP (crowdFit). The card text never goes under
// CARD_FLOOR; the comments' and haiku's floors are in projector.css.
const CROWD_STEP = 0.05;
const CROWD_FLOOR = 0.5;
const CARD_FLOOR = '2.6vw';

function cardFontSize(text) {
  const n = text.length;
  return n < 50 ? '4.6vw' : n < 100 ? '3.8vw' : n < 150 ? '3.2vw' : '2.8vw';
}

// The card text's size on a card that may be crowded: scaled by --crowd, never under CARD_FLOOR.
function crowdedCardSize(text) {
  return `max(${CARD_FLOOR}, calc(${cardFontSize(text)} * var(--crowd, 1)))`;
}

// A crowded card fits the screen (the walk-through's, and the demo's reveal,
// which uses the same layout): everything from the card to the .bottom row
// ends above the walk's bottom padding (kept for the waiting line). Start at
// the normal sizes with every comment; while it overflows, step --crowd down
// (the card text, comments, haiku and the gaps all scale by it, each only to
// its floor); if it still overflows at CROWD_FLOOR, show fewer comments,
// dropping the newest into "+N more" (show(n) draws the first n of count()).
// The haiku sits under the comments, so it is never what's cut. Bounded: one
// measure per step. Returns the fit that underCard runs.
function crowdFit(walk, count, show) {
  return (layout) => {
    walk.style.removeProperty('--crowd');
    let n = count();
    show(n);
    layout();
    const bottom = walk.querySelector('.bottom');
    if (!walk.offsetParent || !bottom) return; // not on screen
    const fits = () => {
      const limit = walk.getBoundingClientRect().bottom - parseFloat(getComputedStyle(walk).paddingBottom);
      return bottom.getBoundingClientRect().bottom <= limit + 0.5;
    };
    for (let step = 1; !fits() && 1 - step * CROWD_STEP >= CROWD_FLOOR - 1e-9; step++) {
      walk.style.setProperty('--crowd', (1 - step * CROWD_STEP).toFixed(2));
      layout();
    }
    while (n > 0 && !fits()) {
      show(--n);
      layout();
    }
  };
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
  const el = h(
    'div',
    { class: 'walk' },
    h('div', { class: 'top' }, position),
    h('div', { class: 'stage-card' }, folder, more),
    mix,
    h('div', { class: 'under' }, comments, commentsMore, haiku),
    h('div', { class: 'bottom' }),
  );
  let said = { shown: [], more: 0 }; // this card's comments, oldest first

  // The first n comments; the rest join the server's "+N more".
  function drawComments(n) {
    fill(comments, ...said.shown.slice(0, n).map((c) => h('div', { class: 'comment' }, c.text)));
    const more = said.more + said.shown.length - n;
    commentsMore.textContent = more > 0 ? `+${more} more` : '';
  }

  // A crowded card fits the screen, down to the bottom row (crowdFit).
  const under = underCard(el, crowdFit(el, () => said.shown.length, drawComments));
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
    if (barWidth !== null) bar.style.transform = `scaleX(${barWidth.toFixed(4)})`; // transform only, so it never repaints the card
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
        card.style.fontSize = last ? '6vw' : crowdedCardSize(body);
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
      drawBar();
      under.layout();
    },
    destroy() {
      cancelAnimationFrame(frame);
      under.disconnect();
    },
  };
}

// ---- the finale and the shred: one clock, drawn on canvases ----------------
// Each plays on its own clock: ms since the part started on the server, so a
// projector that reloads mid-part picks up where the room is. When the
// facilitator taps "Speed up", the clock runs three times faster from that
// moment, as the server assumes when it brings the next step forward. The
// hundreds of things that move (emoji particles, paper strips) are drawn on a
// canvas each frame rather than being DOM elements; everything else moves by
// transform and opacity only, so the laptop's GPU composites it.

function partClock(v) {
  const origin = performance.now() - Math.max(0, v.now - v.phaseStartedAt);
  let speed = null; // `at` in ms since the part started
  return {
    at(now = performance.now()) {
      const t = now - origin;
      return !speed || t <= speed.at ? t : speed.at + (t - speed.at) * speed.factor;
    },
    rate: () => speed?.factor ?? 1,
    // Takes the view's speed-up, once; says whether the speed changed.
    speedUp(view) {
      if (speed || !view.speedUp) return false;
      speed = { at: view.speedUp.at - view.phaseStartedAt, factor: view.speedUp.factor };
      return true;
    },
  };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x) => 1 - (1 - x) * (1 - x);

// A canvas the size of the screen, drawn in CSS pixels.
function screenCanvas(cls) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const c = h('canvas', { class: cls });
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  return { c, ctx: c.getContext('2d'), dpr };
}

const emojiFont = () => getComputedStyle(document.documentElement).getPropertyValue('--emoji').trim();

// The projector's emoji font arrives in pieces, as the page first shows each
// emoji, and a canvas doesn't wait for it: load the ones needed first (or
// give up after a second and draw with what's there).
const loadEmoji = (text) =>
  Promise.race([document.fonts.load(`40px ${emojiFont()}`, text).catch(() => {}), new Promise((ok) => setTimeout(ok, 1000))]);

// One emoji drawn once at a size (CSS px), to be stamped many times. Emoji
// fonts top out at about 160 device pixels (bigger is scaled up anyway), and
// drawing beyond that is slow, so bigger sprites are drawn at 160 and scaled.
const warmer = document.createElement('canvas').getContext('2d');
function emojiSprite(e, px, dpr) {
  const font = Math.min(160, px * dpr);
  const size = Math.max(1, Math.ceil(font * 1.3));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.font = `${font}px ${emojiFont()}`;
  // Centred on the glyph itself, not on the font's line.
  const m = ctx.measureText(e);
  ctx.fillText(e, (size - m.actualBoundingBoxRight + m.actualBoundingBoxLeft) / 2, (size + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  // Canvas drawing is deferred: use it once now, so the glyph is drawn here
  // and not mid-animation.
  warmer.drawImage(c, 0, 0, 1, 1);
  return { c, px: px * 1.3 };
}

// ---- finale: the emotional fingerprint -------------------------------------
// Every reaction arrives as an emoji in the order it happened, then they pool
// into one emoji per type, sized by count (area, not width). Each type's
// particles together cover about the same area as its pool, so pooling reads
// as the particles merging, not a jump in scale. No numbers, no words.

const MIN_POOL_PX = 28;
const APPEAR_MS = 900; // a particle grows in

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
  const clock = partClock(v);
  const sequence = v.finale?.sequence ?? [];
  let frame = 0;
  let draw = null;
  let live = true;
  const loop = (now) => {
    if (draw(clock.at(now))) frame = requestAnimationFrame(loop);
  };
  // Set up once the stage is on screen (the pools are laid out by the
  // browser) and the emojis' font is here.
  if (sequence.length) {
    loadEmoji([...new Set(sequence)].join('')).then(() => {
      if (!live) return;
      frame = requestAnimationFrame((now) => {
        draw = fingerprint(sequence, stage);
        loop(now);
      });
    });
  }
  return {
    el: stage,
    update: (v) => clock.speedUp(v),
    destroy() {
      live = false;
      cancelAnimationFrame(frame);
    },
  };
}

// Builds the picture and returns draw(t): it paints the finale at t ms from
// its start, and says whether anything is still moving.
function fingerprint(sequence, stage) {
  const W = innerWidth;
  const H = innerHeight;
  const { c, ctx, dpr } = screenCanvas('finale-canvas');
  const sizes = poolSizes(countOf(sequence), W, H);
  // Biggest in the middle, smaller ones alternating out to each side. The
  // browser lays the pools out (never shown); the canvas draws them.
  const arranged = [];
  [...sizes].sort((a, b) => b[1] - a[1]).forEach((entry, i) => (i % 2 ? arranged.unshift(entry) : arranged.push(entry)));
  const spans = arranged.map(([e, px]) => h('span', { class: 'pool', style: { fontSize: `${px}px` } }, e));
  stage.append(h('div', { class: 'pools' }, spans), c);
  // The only layout read, before anything moves.
  const rects = new Map(arranged.map(([e], i) => [e, spans[i].getBoundingClientRect()]));
  const pools = arranged.map(([e, px]) => ({ r: rects.get(e), sprite: emojiSprite(e, px, dpr) }));

  const every = sampleEvery(sequence.length);
  const sample = sequence.filter((_, i) => i % every === 0);
  const sampled = countOf(sample);
  const { replayAt, replayMs, poolAt } = finaleTimeline(sequence.length);
  const sprites = new Map();
  const particles = sample.map((e, i) => {
    // This particle's share of its pool's area.
    const s = sizes.get(e) / Math.sqrt(sampled.get(e));
    if (!sprites.has(e)) sprites.set(e, emojiSprite(e, s, dpr));
    const r = rects.get(e);
    return {
      sprite: sprites.get(e),
      s,
      at: replayAt + arrivalMs(i, sample.length, replayMs),
      x: Math.random() * Math.max(0, W - s),
      y: Math.random() * Math.max(0, H - s),
      // Where it lands inside its pool, so together they fill its shape.
      tx: r.left + Math.random() * Math.max(0, r.width - s),
      ty: r.top + Math.random() * Math.max(0, r.height - s),
    };
  });
  // The particles gather over the first two thirds of the pooling; in its
  // second half they fade as the pools appear.
  const gatherMs = (POOL_MS * 2) / 3;
  const fadeAt = poolAt + POOL_MS / 2;
  const fadeMs = POOL_MS / 2;

  return (t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = easeInOut(clamp01((t - poolAt) / gatherMs));
    const fade = clamp01((t - fadeAt) / fadeMs);
    if (fade < 1) {
      ctx.globalAlpha = 1 - fade;
      for (const p of particles) {
        if (t < p.at) break; // in order of arrival
        const d = p.sprite.px * easeInOut(clamp01((t - p.at) / APPEAR_MS));
        const x = p.x + (p.tx - p.x) * g + p.s / 2;
        const y = p.y + (p.ty - p.y) * g + p.s / 2;
        ctx.drawImage(p.sprite.c, x - d / 2, y - d / 2, d, d);
      }
    }
    if (fade > 0) {
      ctx.globalAlpha = fade;
      for (const { r, sprite } of pools) {
        ctx.drawImage(sprite.c, r.left + r.width / 2 - sprite.px / 2, r.top + r.height / 2 - sprite.px / 2, sprite.px, sprite.px);
      }
    }
    ctx.globalAlpha = 1;
    return fade < 1; // the finished picture stays as drawn
  };
}

// ---- shred -----------------------------------------------------------------

// Before the shredder: a plain "Delete everything?" dialog, and a cursor that
// moves over and clicks Delete. It says what's really happening on the server
// before the shredder shows it as a ritual. `animate` runs an animation on
// the shred's clock (delays in ms from its start).
function deletePrelude(animate) {
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
  // Once on screen: the cursor needs to know where Delete is.
  function start() {
    const target = button.getBoundingClientRect();
    const tx = target.left + target.width * 0.6;
    const ty = target.top + target.height * 0.6;
    const sx = innerWidth * 0.82;
    const sy = innerHeight * 0.9;
    const clickAt = PRELUDE_MS - 1000;
    animate(dialog, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, fill: 'backwards' });
    animate(
      cursor,
      [
        { transform: `translate(${sx}px, ${sy}px)`, offset: 0 },
        { transform: `translate(${sx}px, ${sy}px)`, offset: 0.25 },
        { transform: `translate(${tx}px, ${ty}px)`, easing: 'ease-out', offset: 0.75 },
        { transform: `translate(${tx}px, ${ty}px)`, offset: 1 },
      ],
      { duration: clickAt - 50, fill: 'both', easing: 'ease-in-out' },
    );
    // The click.
    animate(button, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.7, transform: 'scale(0.95)' }, { opacity: 1, transform: 'scale(1)' }], {
      duration: 260,
      delay: clickAt,
    });
    animate(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 450, delay: PRELUDE_MS - 650, fill: 'forwards' });
  }
  return { layer, start };
}

// A literal shredder: the pooled emojis, then the cards behind them, are
// pulled down through a slot, come out underneath as narrow strips that sway
// and flutter, and fall into a bin. Ends on black. Each sheet is drawn once
// into a canvas; the strips are slices of it, drawn every frame on one
// canvas, and baked into the bin's canvas once they have landed.

const STRIP_VW = 1.2; // narrow enough that no whole word survives
const GRAVITY = 1500; // px/s²
const TERMINAL = 950; // px/s
const LIE_MS = 350; // a landed strip flops over
const STEP_S = 1 / 60; // the physics steps at most this far at a time

// Draws a laid-out sheet into a canvas: its paper, each card's box, and its
// text word by word where the browser put it.
function rasterize(sheet, dpr) {
  const box = sheet.getBoundingClientRect();
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(box.width * dpr));
  c.height = Math.max(1, Math.ceil(box.height * dpr));
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, -box.left * dpr, -box.top * dpr); // page coordinates
  const paint = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor === 'rgba(0, 0, 0, 0)') return;
    const r = el.getBoundingClientRect();
    ctx.fillStyle = cs.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(r.left, r.top, r.width, r.height, parseFloat(cs.borderTopLeftRadius) || 0);
    ctx.fill();
  };
  paint(sheet);
  for (const el of sheet.children) paint(el);
  const range = document.createRange();
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const cs = getComputedStyle(node.parentElement);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    const ascent = ctx.measureText(node.data).fontBoundingBoxAscent;
    const put = (from, to) => {
      range.setStart(node, from);
      range.setEnd(node, to);
      const rects = range.getClientRects();
      if (rects.length === 1) return ctx.fillText(node.data.slice(from, to), rects[0].left, rects[0].top + ascent);
      // A word the browser broke across lines: a character at a time.
      for (let i = from; i < to; ) {
        const next = i + (node.data.codePointAt(i) > 0xffff ? 2 : 1);
        put(i, next);
        i = next;
      }
    };
    for (const m of node.data.matchAll(/\S+/gu)) put(m.index, m.index + m[0].length);
  }
  return c;
}

function shredScreen(v) {
  const root = h('div', { class: 'shredder' });
  const payload = v.shred;
  if (!payload) return { el: root };
  const clock = partClock(v);
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
  const head = h('div', { class: 'head', style: { top: `${slotY}px`, height: `${exitY - slotY}px` } });
  const slot = h('div', { class: 'slot', style: { top: `${slotY - H * 0.007}px` } });
  const binBack = h('div', { class: 'bin-back', style: { top: `${binTop}px`, height: `${binBottom - binTop}px` } });
  const binFront = h('div', { class: 'bin-front', style: { top: `${binTop}px`, height: `${binBottom - binTop}px` } });
  // Landed strips are baked in here, clipped to the bin's outline so nothing
  // pokes through its sides; the moving ones are drawn on `live` every frame.
  const bin = screenCanvas('bin-inside');
  const live = screenCanvas('strips');
  const dpr = live.dpr;
  const [l0, r0] = binWall(binTop);
  const [l1, r1] = binWall(binBottom);
  // The basket itself, rim to floor: nothing landed shows above its rim.
  const binOutline = new Path2D();
  binOutline.moveTo(l0, binTop);
  binOutline.lineTo(r0, binTop);
  binOutline.lineTo(r1, binBottom);
  binOutline.lineTo(l1, binBottom);
  binOutline.closePath();
  // While a strip settles (a moment), only the basket's sides and floor hold
  // it, so one landing high on the pile doesn't get cut at the rim.
  const binSides = new Path2D();
  binSides.moveTo(l0, 0);
  binSides.lineTo(r0, 0);
  binSides.lineTo(r1, binBottom);
  binSides.lineTo(l1, binBottom);
  binSides.closePath();
  bin.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bin.ctx.clip(binOutline);
  const machine = h('div', { class: 'machine' }, binBack, bin.c, upper, live.c, head, slot, binFront);

  // Animations run on the shred's clock: `delay` is ms from its start.
  const animations = [];
  const animate = (el, keyframes, options) => {
    const a = el.animate(keyframes, options);
    a.playbackRate = clock.rate();
    a.currentTime = clock.at();
    animations.push(a);
    return a;
  };
  const prelude = deletePrelude(animate);
  root.append(machine, prelude.layer);

  // The sheets: pooled emojis first, then the cards (at most 6 sheets).
  const makers = [];
  if (payload.emojis.length) {
    const max = payload.emojis[0][1];
    makers.push(() =>
      h('div', { class: 'sheet sheet-emojis' }, payload.emojis.map(([e, n]) => h('span', { style: { fontSize: `${1.6 + 4 * Math.sqrt(n / max)}vw` } }, e))),
    );
  }
  const chunks = cardSheets(payload.cards);
  const per = chunks[0]?.length ?? 0;
  const columns = per <= 3 ? per : per <= 8 ? 4 : 5;
  const fontVw = per <= 3 ? 1.8 : per <= 8 ? 1.3 : 1.05;
  for (const chunk of chunks) {
    makers.push(() =>
      h(
        'div',
        { class: 'sheet sheet-cards', style: { gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)` } },
        chunk.map((t) => h('div', { style: { fontSize: `${fontVw}vw` } }, t)),
      ),
    );
  }
  const { sheets: times, fadeAt } = shredTimeline(payload);
  const sheets = makers.map((make, i) => ({ make, ...times[i], el: null, fed: false, gone: false }));
  let emojiReady = !payload.emojis.length;
  loadEmoji(payload.emojis.map(([e]) => e).join('')).then(() => (emojiReady = true));

  // Lays a sheet out (hidden) above the slot and draws it into its canvas.
  // Done ahead of time, a sheet at a time, so feeding one costs nothing.
  function prepare(sheet) {
    if (sheet.el) return;
    const el = sheet.make();
    el.style.visibility = 'hidden';
    upper.append(el);
    const sw = el.offsetWidth;
    const sh = el.offsetHeight;
    const left = (W - sw) / 2;
    const top = Math.max(H * 0.03, slotY - sh - H * 0.05);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    Object.assign(sheet, { el, sw, sh, left, top, travel: slotY - top + sh, paper: rasterize(el, dpr) });
  }

  const strips = []; // moving: being pulled through, falling, or flopping over in the bin
  const pile = new Float32Array(64); // how high the pile is across the bin
  const pileAt = (x) => pile[Math.min(63, Math.max(0, Math.floor((x / W) * 64)))];
  // A sheet can be taller than the drop into the bin, so a long strip bunches
  // up as it comes out (it hangs no lower than a quarter of the way into the
  // basket) and crumples as it falls, to lie in the bottom half of the basket.
  const binDepth = binBottom - binTop;
  const hangMax = binTop - exitY + binDepth * 0.25;
  const restMax = binDepth * 0.5;
  const pileMax = binDepth * 0.4;
  // How far a strip's flutter (skew) shifts its lower end, per px of length:
  // less for a long strip, so it leans no more than a short one.
  const lean = (s) => Math.tan((s.skew * Math.PI) / 180) * Math.min(1, s.fit / 0.45);
  // Where a strip's lower end is, relative to its top centre, as drawn.
  const lowerEnd = (s, angle = s.angle, curl = s.curl) => {
    const a = (angle * Math.PI) / 180;
    return { dx: s.h * (lean(s) * Math.cos(a) - curl * Math.sin(a)), dy: s.h * (lean(s) * Math.sin(a) + curl * Math.cos(a)) };
  };

  function feed(sheet) {
    prepare(sheet);
    sheet.fed = true;
    sheet.el.style.visibility = '';
    const n = Math.max(8, Math.round(sheet.sw / ((W * STRIP_VW) / 100)));
    const w = sheet.sw / n;
    for (let i = 0; i < n; i++) {
      strips.push({
        sheet,
        sx: i * w,
        w,
        h: sheet.sh,
        x: sheet.left + i * w,
        x0: sheet.left + i * w,
        y: sheet.top - slotY, // relative to the exit line, mirroring the sheet's slot position
        y0: sheet.top - slotY,
        phase: 'pull',
        angle: 0,
        phi: Math.random() * Math.PI * 2,
        sway: 2 + Math.random() * 5,
        vx: 0,
        vy: 0,
        va: 0,
        curl: 1,
        fit: Math.min(0.45, restMax / sheet.sh), // how crumpled it ends up
        skew: 0,
      });
    }
  }

  // Moves every strip on to time `t` (ms), `dt` seconds after the last step.
  function step(t, dt) {
    for (const sheet of sheets) if (!sheet.fed && t >= sheet.at) feed(sheet);
    for (const s of strips) {
      if (s.phase === 'pull') {
        const p = clamp01((t - s.sheet.pullAt) / s.sheet.pullMs);
        s.y = s.y0 + p * s.sheet.travel;
        const out = clamp01((s.y + s.h) / s.h); // share already through
        s.angle = Math.sin(t / 260 + s.phi) * s.sway * out;
        s.x = s.x0 + Math.sin(t / 410 + s.phi) * 3 * out;
        s.curl = Math.min(1, hangMax / Math.max(1, s.y + s.h)); // a long strip bunches up
        if (s.y >= 0) {
          // Fully out: let go.
          s.phase = 'fall';
          s.vy = (s.sheet.travel / s.sheet.pullMs) * 1000;
          const towardBin = (W / 2 - (s.x + s.w / 2)) * 0.25;
          s.vx = (Math.random() - 0.5) * 120 + towardBin;
          s.va = (Math.random() - 0.5) * 160;
        }
      } else if (s.phase === 'fall') {
        s.vy = Math.min(TERMINAL, s.vy + GRAVITY * dt);
        s.vx += Math.sin(t / 180 + s.phi) * 260 * dt; // flutter
        s.vx *= 1 - 0.8 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.angle += s.va * dt;
        s.curl = Math.max(s.fit, s.curl - ((0.35 * 0.45) / s.fit) * dt); // strips crumple as they fall (long ones faster)
        s.skew = Math.sin(t / 150 + s.phi) * 14;
        const screenY = exitY + s.y;
        const end = lowerEnd(s);
        const bottom = screenY + Math.max(s.h * s.curl, end.dy);
        if (bottom > binTop) {
          // Inside the basket's walls: its top, and its lower end where the tilt swings it.
          const [l, r] = binWall(bottom);
          const endX = s.x + end.dx;
          const lo = Math.min(s.x, endX);
          const hi = Math.max(s.x, endX) + s.w;
          if (lo < l) (s.x += l - lo), (s.vx = Math.abs(s.vx) * 0.3);
          else if (hi > r) (s.x -= hi - r), (s.vx = -Math.abs(s.vx) * 0.3);
        }
        const floor = binBottom - pileAt(s.x + s.w / 2);
        if (bottom >= floor) {
          // It flops over about its top and comes to rest on the pile: fully
          // crumpled, its lowest corner on the floor, inside the rim.
          s.phase = 'lie';
          s.landedAt = t;
          s.from = { angle: s.angle, curl: s.curl, y: screenY - exitY };
          s.lie = (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 50);
          const drop = Math.abs(lowerEnd(s, s.lie, s.fit).dy) + (s.w / 2) * Math.abs(Math.sin((s.lie * Math.PI) / 180));
          s.restY = Math.max(s.from.y, Math.max(binTop + 4, floor - drop) - exitY);
          const i = Math.min(63, Math.max(0, Math.floor(((s.x + s.w / 2) / W) * 64)));
          for (let k = Math.max(0, i - 1); k <= Math.min(63, i + 1); k++) pile[k] = Math.min(pileMax, pile[k] + 1.6);
        }
      } else if (s.phase === 'lie') {
        const k = easeOut(clamp01((t - s.landedAt) / LIE_MS));
        s.angle = s.from.angle + (s.lie - s.from.angle) * k;
        s.curl = s.from.curl + (s.fit - s.from.curl) * k;
        s.y = s.from.y + (s.restY - s.from.y) * k;
        if (t - s.landedAt >= LIE_MS) {
          s.phase = 'landed';
          drawStrip(bin.ctx, s); // baked into the bin for good
        }
      }
    }
    for (let i = strips.length - 1; i >= 0; i--) if (strips[i].phase === 'landed') strips.splice(i, 1);
  }

  // One strip: a slice of its sheet's canvas, turned about the exit line
  // while it's being pulled out, about its top edge once it's let go.
  function drawStrip(ctx, s) {
    const pivotY = s.phase === 'pull' ? Math.max(0, -s.y) : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(s.x + s.w / 2, exitY + s.y + pivotY);
    ctx.rotate((s.angle * Math.PI) / 180);
    if (s.curl !== 1 || s.skew) ctx.transform(1, 0, lean(s), s.curl, 0, 0);
    ctx.translate(-s.w / 2, -pivotY);
    const paper = s.sheet.paper;
    const sx = s.sx * dpr;
    const sw = Math.min(paper.width - sx, (s.w + 0.5) * dpr);
    ctx.drawImage(paper, sx, 0, sw, paper.height, 0, 0, sw / dpr, s.h);
  }

  let frame = 0;
  let last = 0; // the shred's time at the last step
  let nextPrepare = 300;
  function loop(now) {
    const t = clock.at(now);
    // After a reload mid-shred the emoji sheet may be due at once: wait for
    // its font (at most a second, see loadEmoji), then catch up.
    if (!emojiReady && !sheets[0].el && t >= sheets[0].at) {
      frame = requestAnimationFrame(loop);
      return;
    }
    // Small steps, so a slow frame (or a reload mid-shred) plays out the same.
    const steps = Math.max(1, Math.ceil((t - last) / 1000 / STEP_S));
    for (let k = 1; k <= steps; k++) step(last + ((t - last) * k) / steps, (t - last) / 1000 / steps);
    last = t;
    for (const sheet of sheets) {
      if (!sheet.fed || sheet.gone) continue;
      const p = clamp01((t - sheet.pullAt) / sheet.pullMs);
      sheet.el.style.transform = `translateY(${p * sheet.travel}px)`;
      if (p >= 1) {
        sheet.el.remove();
        sheet.gone = true;
      }
    }
    const ctx = live.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live.c.width, live.c.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, exitY * dpr, live.c.width, live.c.height - exitY * dpr);
    ctx.clip(); // under the shredder's mouth
    for (const s of strips) if (s.phase !== 'lie' && s.y + s.h > 0) drawStrip(ctx, s);
    ctx.restore();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clip(binSides);
    for (const s of strips) if (s.phase === 'lie') drawStrip(ctx, s);
    ctx.restore();
    // Draw the next sheet ahead of time, one now and then, while little is moving.
    if (t >= nextPrepare) {
      const next = sheets.find((s) => !s.el);
      if (next && emojiReady) prepare(next);
      nextPrepare = t + 200;
    }
    if (t < fadeAt + FADE_MS + 500) frame = requestAnimationFrame(loop);
  }
  frame = requestAnimationFrame((now) => {
    prelude.start();
    // The shredder fades in as the prelude ends; at the end, fade to black.
    // The server moves everyone to the closing screen after a beat of
    // silence (same timeline, public/shared/shred-timing.js).
    animate(machine, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: PRELUDE_MS - 500, fill: 'backwards' });
    animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, delay: fadeAt, fill: 'forwards' });
    loop(now);
  });

  return {
    el: root,
    update(v) {
      if (!clock.speedUp(v)) return;
      // The prelude, the fades: the same speed, from the same moment.
      for (const a of animations) {
        a.playbackRate = v.speedUp.factor;
        a.currentTime = clock.at();
      }
    },
    destroy() {
      cancelAnimationFrame(frame);
      for (const a of animations) a.cancel();
    },
  };
}
