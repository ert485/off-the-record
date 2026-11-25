// The facilitator view: everything, plus every control. Reached only with the
// facilitator token in the URL. Works on several devices at once.
//
// Every phase uses the same layout, top to bottom, so the eye learns where to
// look:
//   1. Move    (yellow)  back / next phase, and in the walk-through, cards
//   2. Now     (white)   the one number that matters right now, and its time
//   3. Room    (blue)    the room's pace: pause and resume
//   4. Content (grey)    what's on screen or needs a decision
//   5. Lists   (folded)  every card, the stream
// Hide and Remove are always red-outlined, on the right of the thing they act on.
import { subscribe, fill, post, h, formatClock, serverNow } from './shared/client.js';

const token = new URLSearchParams(location.search).get('t') ?? '';
const app = document.getElementById('app');
const bar = document.getElementById('bar');
const toasts = document.getElementById('toasts');

const LABELS = {
  teaser: 'Teaser',
  demo: 'Demo',
  join: 'Join',
  submit: 'Submissions',
  cluster: 'Cluster',
  react: 'React',
  walk: 'Walk-through',
  finale: 'Finale',
  shred: 'Shred',
  closing: 'Closing',
};

// What the move buttons say: a verb for where you're going.
const FORWARD = {
  demo: 'Start the demo',
  join: 'Start',
  submit: 'Open submissions',
  cluster: 'Group the cards',
  react: 'Start reactions',
  walk: 'Start the walk-through',
  finale: 'Show the finale',
};
const BACK_TO = {
  teaser: 'the teaser',
  demo: 'the demo',
  join: 'the join screen',
  submit: 'submissions',
  cluster: 'grouping',
  react: 'reactions',
  walk: 'the walk-through',
};

let view = null;
let online = false;
let pending = false;
const drafts = new Map(); // theme id -> name being typed
const haikuDrafts = new Map(); // theme id -> haiku being typed
const folded = new Map(); // list name -> open or not, as the facilitator left it
const explained = new Set(); // which ⓘ explanations are open

// A small ⓘ button that shows or hides a one-line explanation.
function info(key, text) {
  const open = explained.has(key);
  const button = h('button', {
    class: `info${open ? ' info-open' : ''}`,
    'aria-label': 'What is this?',
    onclick: () => {
      if (open) explained.delete(key);
      else explained.add(key);
      render();
    },
  }, 'ⓘ');
  return { button, text: open ? h('div', { class: 'info-text' }, text) : '' };
}

function paceText(pace) {
  if (Math.abs(pace) < 0.5) return 'on pace';
  const min = Math.max(1, Math.round(Math.abs(pace)));
  return pace < 0 ? `~${min} min behind` : `~${min} min ahead`;
}


subscribe(
  `role=facilitator&t=${encodeURIComponent(token)}`,
  (v) => {
    view = v;
    render();
  },
  (ok) => {
    online = ok;
    renderBar();
  },
);

// Live updates must not swap a button out between a finger going down and
// coming up (the tap would be lost), nor interrupt typing. Both wait: the view
// re-renders when the finger lifts or the field loses focus.
let pointerDownAt = 0;
const fingerDown = () => Date.now() - pointerDownAt < 1500;
const typing = () => app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
document.addEventListener('pointerdown', () => (pointerDownAt = Date.now()));
const released = () => {
  pointerDownAt = 0;
  // After the click has been delivered.
  setTimeout(() => pending && render(), 300);
};
document.addEventListener('pointerup', released);
document.addEventListener('pointercancel', released);
app.addEventListener('focusout', () => setTimeout(() => pending && render(), 0));

// Clocks tick in place, so buttons are never swapped out under a finger.
const live = new Set();
const liveClock = (fn) => {
  const el = h('span', { class: 'clock' }, fn());
  live.add({ el, fn });
  return el;
};
const barLive = new Set();
setInterval(() => {
  for (const { el, fn } of [...barLive, ...live]) el.textContent = fn();
}, 1000);

// Returns true when the action went through. "Already moved on" and "Already
// extended" mean another device (or an earlier tap) got there first: a no-op,
// not an error.
const ALREADY = ['Already moved on', 'Already extended'];
async function act(action, body = {}) {
  try {
    await post(action, body, { 'x-facilitator-token': token });
    return true;
  } catch (err) {
    if (ALREADY.includes(err.message)) return false;
    const t = h('div', {}, err.message);
    toasts.append(t);
    setTimeout(() => t.remove(), 4000);
    return false;
  }
}

const clockText = (ms) => `${ms < 0 ? '-' : ''}${formatClock(Math.abs(ms))}`;

function renderBar() {
  if (!view) return;
  barLive.clear();
  const talk = view.talk;
  const started = talk?.startedAt != null;
  const pace = view.pace ?? 0;
  const clamped = Math.max(-5, Math.min(5, pace));
  const color = Math.abs(pace) < 0.5 ? 'var(--ok)' : pace < 0 ? 'var(--warn)' : '#6aa9ff';
  const talkInfo = info(
    'talk',
    `Time left in the talk (${talk?.minutes ?? 25} minutes in all), counted from when you tapped “Start talk clock”, or, if you didn’t, from when the room moved on (set back to the plan’s start for that part). Only you see it.`,
  );
  const paceInfo = info(
    'pace',
    'Pace: where the session is against the plan for finishing on time. The dot sits on the centre line when you’re on time, slides left when you’re behind and right when you’re ahead. Only you see it.',
  );
  const phonesInfo = info('phones', 'Phones with this session open right now, including any that wandered off and will come back.');
  let left = '';
  if (talk && !started) left = h('button', { class: 'small-btn primary', onclick: () => act('startTalk') }, 'Start talk clock');
  else if (started) {
    const el = h('span', { class: 'clock' }, '');
    const fn = () => `${clockText(talk.startedAt + talk.minutes * 60_000 - serverNow())} left`;
    el.textContent = fn();
    barLive.add({ el, fn });
    left = [el, talkInfo.button];
  }
  fill(
    bar,
    h('span', { class: 'phase' }, LABELS[view.phase]),
    left,
    // Ahead/behind marker: left of centre is behind, right is ahead.
    started
      ? [
          h('span', { class: 'pace', title: 'Pace against the plan' }, h('span', { class: 'dot', style: { left: `${50 + clamped * 10}%`, background: color } })),
          h('span', { class: 'pace-text', style: { color } }, paceText(pace)),
          paceInfo.button,
        ]
      : '',
    h('span', { class: 'dim' }, `${view.phones} phones`),
    phonesInfo.button,
    online ? '' : h('span', { class: 'offline' }, 'Reconnecting…'),
    started ? talkInfo.text : '',
    started ? paceInfo.text : '',
    phonesInfo.text,
  );
}

function render() {
  if (!view) return;
  if (typing() || fingerDown()) {
    pending = true;
    // A focused field holds back only its own zone: a new move prompt and the
    // late-arrival panel still appear, without touching the field.
    if (typing() && !fingerDown()) renderWhileTyping();
    return;
  }
  pending = false;
  live.clear();
  renderBar();
  const v = view;
  const p = PHASES[v.phase](v);
  fill(app, zone('move', p.move ?? nav(v)), zone('now', p.now), zone('room', p.room), zone('content', p.content), p.lists);
}

function renderWhileTyping() {
  renderBar();
  const v = view;
  const p = PHASES[v.phase](v);
  const move = zone('move', p.move ?? nav(v));
  const oldMove = app.querySelector('.zone-move');
  if (move && oldMove) oldMove.replaceWith(move);
  else if (move) app.prepend(move);
  else oldMove?.remove();
  const late = v.clustering ? latePanel(v.clustering.late) : '';
  const oldLate = app.querySelector('.alert.late');
  if (late && oldLate) oldLate.replaceWith(late);
  else if (late) app.querySelector('.zone-content')?.prepend(late);
  else oldLate?.remove();
}

function zone(kind, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '');
  return kids.length ? h('section', { class: `zone zone-${kind}` }, kids) : '';
}

// ---- building blocks -------------------------------------------------------

// Typed names and haiku, for approveAll. Only haiku that were edited are sent
// (a missing one keeps the stored haiku; an empty one clears it).
function typedDrafts(v) {
  return {
    names: Object.fromEntries(v.themes.map((t) => [t.id, drafts.get(t.id) ?? t.name])),
    haikus: Object.fromEntries(v.themes.filter((t) => haikuDrafts.has(t.id)).map((t) => [t.id, haikuDrafts.get(t.id)])),
  };
}

async function approveAll(v) {
  const ok = await act('approveAll', typedDrafts(v));
  if (ok) {
    drafts.clear();
    haikuDrafts.clear();
  }
  return ok;
}

// The move zone: back, and one forward button. When a part is over the
// forward button is the server's prompt ("Ready for grouping?"); otherwise it
// says where it goes. `from` makes a double tap, on this or another device, move once.
function nav(v) {
  const back = h('button', { disabled: !v.canBack, onclick: () => act('back', { from: v.phase }) }, v.prev ? `◀ Back to ${BACK_TO[v.prev]}` : '◀ Back');
  let next;
  if (v.phase === 'cluster') {
    const c = v.clustering;
    const wait =
      c.status === 'running' || c.late?.status === 'running' ? 'Grouping…' : c.late?.status === 'flagged' ? 'Choose keep or regroup first' : null;
    next = wait
      ? h('button', { class: 'primary prompt', disabled: true }, wait)
      : h('button', { class: 'primary prompt', onclick: async () => (await approveAll(v)) && act('advance', { from: 'cluster' }) }, 'Approve all and start reactions ▶');
  } else if (v.next === 'shred') {
    next = h('button', { class: 'danger prompt' }, v.move ? `${v.move.label} ▶` : 'Shred…');
    next.addEventListener('click', () => {
      if (confirm('Shred everything? This deletes every card, reaction and thought from the server, and Back cannot undo it.')) {
        act('advance', { from: v.phase, confirm: true });
      }
    });
  } else {
    next = h('button', { class: `primary${v.move ? ' prompt' : ''}`, onclick: () => act('advance', { from: v.phase }) }, `${v.move ? v.move.label : (FORWARD[v.next] ?? LABELS[v.next])} ▶`);
  }
  return h('div', { class: 'nav' }, back, next);
}

// The "Now" strip: a main figure on the left, time on the right.
function now(main, label, time, timeLabel, ...extra) {
  return [
    h('div', { class: 'now-row' },
      h('div', { class: 'stat grow' }, main, h('small', {}, label)),
      time !== undefined ? h('div', { class: 'stat' }, time, h('small', {}, timeLabel)) : ''),
    extra,
  ];
}

const since = (t) => liveClock(() => formatClock(serverNow() - t));
const until = (t) => liveClock(() => clockText(t - serverNow()));

function modButton(label, onclick) {
  return h('button', { class: 'small-btn mod', onclick }, label);
}

// The harshness check's answer, for the facilitator only: a red (harsh) or
// amber (edgy) dot with its reason, nothing when it was fine, or "not checked".
function harshLine(item) {
  if (!item.harsh) return h('div', { class: 'harsh small dim' }, 'not checked');
  const { level, reason } = item.harsh;
  if (!level) return '';
  return h('div', { class: `harsh harsh-${level} small` }, h('span', { class: 'dot', 'aria-label': level === 2 ? 'Harsh' : 'Edgy' }), reason || (level === 2 ? 'Harsh' : 'Worth a look'));
}

// The "Reviewed" toggle. The walk-through holds before a card or thought
// nobody has reviewed.
function reviewToggle(item, kind) {
  return h('button', {
    class: `small-btn review${item.reviewed ? ' on' : ''}`,
    'aria-pressed': item.reviewed ? 'true' : 'false',
    onclick: () => act('review', { kind, id: item.id, on: !item.reviewed }),
  }, item.reviewed ? 'Reviewed ✓' : 'Reviewed');
}

// A card or thought: its text and check, then Reviewed, then Hide or Remove
// (always rightmost). A hidden card needs no review.
function itemRow(item, kind, mod) {
  const shown = !item.hidden;
  return h(
    'div',
    { class: `cardrow${item.hidden ? ' hidden' : ''}${shown && !item.reviewed ? ' unreviewed' : ''}` },
    h('div', { class: 'text' }, item.text, shown ? harshLine(item) : ''),
    shown && item.reviewed !== undefined ? reviewToggle(item, kind) : '',
    mod,
  );
}

function cardRow(card) {
  return itemRow(card, 'card', modButton(card.hidden ? 'Show' : 'Hide', () => act('hideCard', { id: card.id, hidden: !card.hidden })));
}

function thoughtRow(t) {
  return itemRow(t, 'afterthought', modButton('Remove', () => act('removeAfterthought', { id: t.id })));
}

// "Mark the rest reviewed", at the top of the lists: one tap for every card
// and thought the check found fine or never checked.
function reviewBar(v) {
  if (!v.review) return '';
  const i = info(
    'review',
    v.review.checking
      ? 'Claude Haiku checks each card and thought for harsh wording: red is harsh, amber is worth a look. “Mark the rest reviewed” marks every one that isn’t red or amber, including any not checked; look at red and amber ones yourself. The walk-through waits before showing a card or thought nobody has reviewed.'
      : 'With no API key on the server, nothing is checked for harsh wording. “Mark the rest reviewed” marks every card and thought; the walk-through waits before showing one nobody has reviewed.',
  );
  const { left, rest } = v.review;
  return h('div', { class: 'stack' },
    h('div', { class: 'row wrap review-bar' },
      h('span', { class: 'grow small dim' }, left ? `${left} not reviewed ` : 'Everything is reviewed ', i.button),
      // Only when the tap would mark something (red and amber are reviewed one by one).
      rest ? h('button', { class: 'small-btn', onclick: () => act('reviewRest') }, 'Mark the rest reviewed') : ''),
    i.text);
}

// A folded list that stays open or closed the way the facilitator left it.
function foldable(key, summary, defaultOpen, ...children) {
  const el = h('details', { class: 'zone zone-lists', open: folded.has(key) ? folded.get(key) : defaultOpen }, h('summary', {}, summary), ...children);
  el.addEventListener('toggle', () => folded.set(key, el.open));
  return el;
}

// `bar`: false when the review bar is already shown above (during a hold).
function allCards(v, defaultOpen = false, { bar = true } = {}) {
  if (!v.cards?.length) return '';
  const visible = v.cards.filter((c) => !c.hidden).length;
  return foldable('cards', `All cards (${visible} shown, ${v.cards.length - visible} hidden)`, defaultOpen, bar ? reviewBar(v) : '', h('div', {}, v.cards.map(cardRow)));
}

function mixLine(mix) {
  return h('div', { class: 'mixline' }, (mix ?? []).map(([e, n]) => `${e}${n > 1 ? `×${n}` : ''}`).join('  ') || ' ');
}

// The thoughts phones added at the end of their decks, each with its check,
// Reviewed and Remove; unreviewed first, then harshest first.
function afterthoughtList(label, afterthoughts) {
  if (!afterthoughts?.length) return '';
  return h('div', { class: 'stack' }, h('div', { class: 'label' }, label), h('div', {}, afterthoughts.map(thoughtRow)));
}

function nudgeStatus(submit) {
  if (!submit.nudgesOn) return 'Phones show no nudges.';
  const texts = submit.nudgeTexts;
  if (!texts) return 'No nudge: the cards already cover every direction.';
  if (texts.length === 1) return `Phones show: “${texts[0]}” (the least-covered direction).`;
  return submit.tagging
    ? 'Phones rotate through all six nudges until there are enough cards to judge the mix.'
    : 'Phones rotate through all six nudges (no API key, so the mix is not judged).';
}

// Prompts for when the room goes quiet. Facilitator only; never projected.
const PROMPTS = [
  'Does this one land for anyone?',
  'Anyone want to add to this, out loud?',
  'What do you notice in the emoji mix?',
  'Has anyone felt the opposite?',
  'Is this something people talk about at work, or not?',
];
const OVERVIEW_PROMPTS = ['First reactions: anything surprise you?', 'Which of these feels most like your year?'];

// Matches the projector's fine print word for word.
const DISCLOSURE =
  'Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. Submitted cards and thoughts go to Anthropic (Claude Haiku) for grouping, picking writing prompts and a check for harsh wording; they don’t train on them and delete them within 30 days. I see cards and thoughts before they’re shown and can remove any of them to prevent abuse. Everything on our server is shredded tonight.';

// ---- grouping --------------------------------------------------------------

// The late cards the quick call couldn't place: keep the themes, or regroup.
function latePanel(late) {
  if (late?.status !== 'flagged') return '';
  return h(
    'div',
    { class: 'alert late' },
    h('strong', {}, 'Late cards need your call'),
    h('div', { class: 'small dim' }, 'These arrived after the themes were made and don’t fit them cleanly.'),
    late.flags.map((f) =>
      h('div', { class: 'group dupes' }, f.cards.map((c) => h('div', { class: 'text' }, c.text)), h('div', { class: 'small dim' }, f.reason))),
    h('div', { class: 'row wrap' },
      h('button', { class: 'primary', onclick: () => act('keepLate') }, 'Keep the themes and add the late arrivals'),
      h('button', { onclick: () => act('regroupAll') }, 'Regroup everything (~40 seconds)')),
  );
}

// One theme: name and haiku as typed drafts (they survive live updates),
// approve, and its cards.
function themeBox(t) {
  const name = h('input', { type: 'text', maxLength: 60, placeholder: 'Theme name' });
  name.value = drafts.get(t.id) ?? t.name;
  const haiku = h('input', { type: 'text', placeholder: 'Haiku (optional)', 'aria-label': 'Haiku' });
  haiku.value = haikuDrafts.get(t.id) ?? t.haiku ?? '';
  const button = h('button', { class: 'small-btn' });
  const changed = () => name.value.trim() !== t.name || haiku.value !== (t.haiku ?? '');
  const refresh = () => {
    button.textContent = !t.approved ? 'Approve' : changed() ? 'Approve changes' : 'Approved ✓';
    button.classList.toggle('primary', !t.approved || changed());
  };
  const approve = async () => {
    const body = { id: t.id, name: name.value };
    if (haikuDrafts.has(t.id) || haiku.value !== (t.haiku ?? '')) body.haiku = haiku.value;
    if (await act('approveTheme', body)) {
      drafts.delete(t.id);
      haikuDrafts.delete(t.id);
    }
  };
  name.addEventListener('input', () => {
    drafts.set(t.id, name.value);
    refresh();
  });
  haiku.addEventListener('input', () => {
    haikuDrafts.set(t.id, haiku.value);
    refresh();
  });
  for (const input of [name, haiku]) input.addEventListener('keydown', (e) => e.key === 'Enter' && (input.blur(), approve()));
  button.addEventListener('click', approve);
  refresh();
  return h(
    'div',
    { class: `theme${t.approved ? ' approved' : ''}` },
    h('div', { class: 'row' }, name, button),
    h('div', { class: 'row' }, haiku),
    t.groups.map((g) => h('div', { class: `group${g.cards.length > 1 ? ' dupes' : ''}` }, g.cards.map(cardRow))),
  );
}

function themeDrafts(v) {
  const unapproved = v.themes.filter((t) => !t.approved).length;
  return [
    latePanel(v.clustering.late),
    v.themes.length && unapproved
      ? h('div', { class: 'row' },
          h('span', { class: 'grow dim small' }, `${unapproved} of ${v.themes.length} not approved. Unapproved themes show no name on the projector.`),
          h('button', { class: 'small-btn primary', onclick: () => approveAll(v) }, 'Approve all'))
      : '',
    v.themes.map(themeBox),
  ];
}

// The finale and the shred play by themselves; this plays the rest faster, once.
function speedUpButton(v) {
  const i = info('speed-up', 'Plays the rest about three times faster. Use it if the room is ready to move on.');
  const on = !!v.speedUp;
  return [
    h('div', { class: 'room-row' },
      h('button', { class: 'speed-btn', disabled: on, onclick: () => act('speedUp', { from: v.phase }) }, on ? 'Speeding up' : 'Speed up ⏩'),
      i.button),
    i.text,
  ];
}

// ---- phases ----------------------------------------------------------------

const PHASES = {
  teaser: (v) => {
    const t = v.teaser ?? { title: '', lines: [] };
    const i = info('teaser', 'Phones and the projector show this until you start the demo. Start it when people begin to arrive; it plays on a loop.');
    return {
      now: now('Teaser', [' on the projector and phones ', i.button], undefined, '', i.text),
      content: [h('div', { class: 'label' }, 'As the room sees it'), h('div', { class: 'current' }, h('b', {}, t.title), t.lines.map((l) => h('p', {}, l)))],
    };
  },

  demo: (v) => {
    const d = v.demo;
    if (!d) return { content: h('p', { class: 'dim' }, 'Talk through the app, then start the session.') };
    const stepInfo = info('demo', 'It loops by itself while people arrive. Back or Next stops the loop and puts you in control, and so does starting the talk clock while it loops (it puts you on step 1); Play on a loop starts it again from step 1.');
    return {
      now: now(
        d.name,
        [d.auto ? ' Playing on a loop ' : ` Paused on step ${d.step + 1} of ${d.steps} `, stepInfo.button],
        undefined,
        '',
        stepInfo.text,
        h('div', { class: 'nav' },
          h('button', { disabled: d.step === 0, onclick: () => act('demoBack', { from: d.step }) }, '◀ Back'),
          h('button', { class: 'primary', disabled: d.step >= d.steps - 1, onclick: () => act('demoNext', { from: d.step }) }, 'Next ▶')),
        d.auto ? '' : h('button', { class: 'loop-btn', onclick: () => act('demoAuto', { on: true }) }, 'Play on a loop'),
      ),
    };
  },

  join: (v) => {
    const i = info('phones', 'Phones with this session open right now.');
    return {
      now: now(v.phones, [' phones connected ', i.button], undefined, '', i.text),
      content: [h('div', { class: 'label' }, 'Trust disclosure (fine print on the projector)'), h('p', { class: 'disclosure' }, DISCLOSURE)],
    };
  },

  submit: (v) => {
    const phones = Math.max(v.phones, v.submit.people);
    const pct = phones ? Math.round((v.submit.people / phones) * 100) : 0;
    const countInfo = info('submit-count', 'Cards submitted so far, and how many phones have sent at least one (the percentage is of connected phones).');
    const timeInfo = info('submit-time', 'Time left for submissions. The room sees the same countdown. “+1 minute” adds a minute; nothing closes by itself, you move on.');
    const c = v.clustering;
    const writingInfo = info('submit-writing', 'Phones that typed in the last 8 seconds; no text is sent. If almost nobody is writing, you can move on early; if many still are when time’s up, add a minute.');
    return {
      now: now(
        v.cards.length,
        [` ${v.cards.length === 1 ? 'card' : 'cards'} · ${v.submit.people} of ${phones} phones have shared (${pct}%) `, countInfo.button],
        v.submit.endsAt !== null ? until(v.submit.endsAt) : undefined,
        [' left ', timeInfo.button],
        countInfo.text,
        timeInfo.text,
        h('div', { class: 'row wrap' },
          h('button', { class: 'small-btn', onclick: () => act('extend', { from: v.submit.endsAt }) }, '+1 minute'),
          h('button', { class: `small-btn${v.submit.nudgesOn ? ' on' : ''}`, onclick: () => act('nudges', { on: !v.submit.nudgesOn }) }, `Nudges ${v.submit.nudgesOn ? 'on' : 'off'}`),
          h('span', { class: 'small dim grow' }, nudgeStatus(v.submit))),
        h('div', {}, h('span', { class: 'dim small' }, `${v.writing} writing now `), writingInfo.button, writingInfo.text),
        c.status === 'running' ? h('div', { class: 'small dim' }, 'Grouping started (about 40 seconds)…') : '',
      ),
      content: [h('p', { class: 'dim small' }, 'Cards arrive below. Hide any card that shouldn’t be shown.'), v.themes.length ? themeDrafts(v) : ''],
      lists: allCards(v, true),
    };
  },

  cluster: (v) => {
    const c = v.clustering;
    const unapproved = v.themes.filter((t) => !t.approved).length;
    const lateRunning = c.late?.status === 'running';
    const status = lateRunning
      ? 'Checking the late cards…'
      : c.status === 'running'
        ? 'Grouping with Claude Haiku…'
        : c.late?.status === 'flagged'
          ? 'Some late cards don’t fit the themes: choose below.'
          : c.empty
            ? 'No cards were submitted, so there’s nothing to group.'
            : c.status === 'failed'
              ? c.error === 'Skipped'
                ? 'Skipped the AI: one card per group. Name the theme, or Retry.'
                : `Grouping failed: ${c.error}. Showing one card per group.`
              : c.local
                ? 'Grouped without AI (no API key on the server): one card per group.'
                : unapproved
                  ? `${unapproved} of ${v.themes.length} names not approved. Unapproved themes show no name on the projector.`
                  : 'All names approved.';
    const themesInfo = info('themes', 'How many themes the cards fell into. A theme shows on the projector only once you approve its name.');
    return {
      now: now(
        v.themes.length,
        [v.themes.length === 1 ? ' theme ' : ' themes ', themesInfo.button],
        undefined,
        '',
        themesInfo.text,
        h('div', { class: 'row' },
          h('span', { class: 'grow dim small' }, status),
          // Don't wait on a slow or stuck API: every card becomes its own group.
          c.status === 'running' || lateRunning ? h('button', { class: 'small-btn', onclick: () => act('skipClustering') }, 'Skip the AI') : '',
          c.status === 'failed' ? h('button', { class: 'small-btn', onclick: () => act('recluster') }, 'Retry') : ''),
      ),
      content: [
        themeDrafts(v),
        // Not once there are reactions: new groups would cut them off their cards.
        c.status !== 'running' && c.status !== 'idle' && !c.empty && !v.react.reactions ? h('button', { class: 'quiet', onclick: () => act('recluster') }, 'Re-run grouping') : '',
      ],
      lists: allCards(v),
    };
  },

  react: (v) => {
    const total = Math.max(v.phones, v.react.done);
    const pct = total ? Math.round((v.react.done / total) * 100) : 0;
    const pctInfo = info('react-pct', 'Share of connected phones that have reached the end of their deck. “Done” is the phone’s own button.');
    const timeInfo = info('react-time', 'Time left for reactions. The room sees the same countdown. “+1 minute” adds a minute; when time is up or every phone is done, you’ll be asked to move on.');
    const countInfo = info('react-count', 'Every emoji tap from every phone so far, counted once per emoji per card.');
    // Each phone's deck: the deck size, or every card when there are fewer.
    const perPhone = Math.min(v.react.deckSize ?? v.react.total, v.react.total);
    const partDeck = perPhone < v.react.total;
    const deckInfo = info(
      'react-deck',
      partDeck
        ? `Each phone gets ${perPhone} of the ${v.react.total} cards, picked at random, so everyone can finish with time for a thought at the end. Cards seen by more phones can gather more reactions.`
        : 'Each phone gets every card, in its own random order. With more cards than fit the time, each phone would get some of them, picked at random.',
    );
    const unsentInfo = info('react-unsent', 'Thoughts aren’t sent automatically. Wait for them, or say there’s no time and move on.');
    return {
      // Beside the move prompt, so it is seen before moving on.
      move: [nav(v), h('div', {}, h('span', { class: 'dim small' }, `${v.unsent} still writing a thought `), unsentInfo.button, unsentInfo.text)],
      now: now(
        `${pct}%`,
        [` of phones finished (${v.react.done} of ${total}) `, pctInfo.button],
        v.react.endsAt !== null ? until(v.react.endsAt) : undefined,
        [' left ', timeInfo.button],
        pctInfo.text,
        timeInfo.text,
        h('div', { class: 'row wrap' }, h('button', { class: 'small-btn', onclick: () => act('extendReact', { from: v.react.endsAt }) }, '+1 minute')),
      ),
      content: [
        h('div', {}, h('span', { class: 'dim small' }, `${v.react.reactions} reactions so far `), countInfo.button, countInfo.text),
        // Nothing to say about decks with no cards to react to.
        v.react.total ? h('div', {}, h('span', { class: 'dim small' }, partDeck ? `${perPhone} of ${v.react.total} cards on each phone ` : `All ${v.react.total} cards on each phone `), deckInfo.button, deckInfo.text) : '',
        v.react.afterthoughts.length ? reviewBar(v) : '',
        afterthoughtList('Thoughts from the end of the deck, shown on the last slide', v.react.afterthoughts),
      ],
      lists: allCards(v),
    };
  },

  walk: (v) => {
    const w = v.walk;
    const item = w.item;
    const overview = !!item?.overview;
    const lastSlide = !!item?.last;
    const group = overview || lastSlide || !item ? null : v.themes.flatMap((t) => t.groups).find((g) => g.id === item.groupId);
    const shown = group?.cards.find((c) => !c.hidden);
    const cards = Math.max(0, w.total - 2); // not the overview or the last slide
    const prompts = overview ? OVERVIEW_PROMPTS : [PROMPTS[w.index % PROMPTS.length], PROMPTS[(w.index + 1) % PROMPTS.length]];
    const posInfo = info('walk-pos', 'Where you are: the themes overview first, then the cards in order of reactions, then a last slide: the room’s afterthoughts, or, with none, an invitation to speak.');
    const timeInfo = info('walk-time', 'How long this card has been on screen. The projector shows the time left in the whole walk-through instead.');
    const leftInfo = info('walk-left', 'The walk-through ends at a fixed time on the talk clock, so the cards share what’s left (the last slide keeps 20 seconds, or 10 seconds for each page of 4 thoughts, up to a minute). It’s a rough average, not a limit: spend longer where the room wants to.');
    const nextIsLast = !lastSlide && w.index === w.total - 2;
    const showLeft = !lastSlide && !w.done && w.cardsLeft !== null;
    // Held before an item nobody has reviewed: its cards (or the thoughts), to check here.
    const holdItem = w.held ? w.stream[w.holdTo] : null;
    const holdLast = holdItem?.groupId === 'last';
    const holdGroup = holdItem && !holdLast ? v.themes.flatMap((t) => t.groups).find((g) => g.id === holdItem.groupId) : null;
    const holdInfo = info('walk-hold', 'The walk-through waits before showing a card or thought nobody has reviewed. Next marks it reviewed and shows it; Hide skips it; Resume gives the current card another share. The finish doesn’t move.');
    const held = w.held
      ? h('div', { class: 'alert hold' },
          h('div', { class: 'row' },
            h('strong', { class: 'grow' }, holdLast ? 'The thoughts for the last slide haven’t been reviewed: check them below, then Next.' : 'The next card hasn’t been reviewed: check it below, then Next.'),
            holdInfo.button),
          holdInfo.text,
          holdLast ? h('div', {}, w.afterthoughts.map(thoughtRow)) : h('div', {}, (holdGroup?.cards ?? []).filter((c) => !c.hidden).map(cardRow)),
          reviewBar(v))
      : '';
    return {
      move: [
        nav(v),
        h('div', { class: 'walk-nav' },
          h('button', { disabled: w.index === 0, onclick: () => act('prevCard', { from: w.index }) }, w.index === 1 ? '◀ Back to the themes overview' : '◀ Back one card'),
          // On the last slide, Next is the finale, in one tap (the server ignores
          // a tap that is the second half of a double-tapped Next).
          h('button', { class: 'primary', onclick: () => act('nextCard', { from: w.index }) }, holdLast ? 'Show the last slide ▶' : w.index === 0 ? 'First card ▶' : lastSlide ? `${v.move ? v.move.label : FORWARD.finale} ▶` : 'Next card ▶')),
      ],
      now: now(
        overview ? 'Themes' : lastSlide ? 'Last slide' : `Card ${w.index} of ${cards}`,
        [' ', posInfo.button],
        since(w.cardStartedAt),
        [w.paused ? ' on this card (paused) ' : ' on this card ', timeInfo.button],
        posInfo.text,
        timeInfo.text,
        showLeft ? h('div', { class: 'small dim' }, `${w.cardsLeft} ${w.cardsLeft === 1 ? 'card' : 'cards'} left · ~${formatClock(w.cardMs)} each `, leftInfo.button) : '',
        showLeft ? leftInfo.text : '',
      ),
      room: [
        h('div', { class: `room-row${w.paused ? ' active' : ''}` },
          h('strong', { class: 'grow' }, w.held ? 'Waiting for a review: the card stays until you move on' : w.paused ? 'Paused: the card stays until you resume' : 'Running'),
          h('button', { class: 'small-btn room-btn', onclick: () => act('pauseWalk', { paused: !w.paused }) }, w.paused ? 'Resume' : 'Pause')),
      ],
      content: [
        held,
        overview
          ? h('div', { class: 'current' }, 'The themes are on the projector.')
          : lastSlide
            ? h('div', { class: 'current' }, w.afterthoughts.length ? 'Afterthoughts' : 'Anything else? Out loud.')
            : [
                item?.theme ? h('div', { class: 'dim' }, item.theme) : '',
                item?.haiku ? h('div', { class: 'dim small' }, item.haiku) : '',
                h('div', { class: 'row', style: { alignItems: 'flex-start' } },
                  h('div', { class: 'current grow' }, item?.hidden ? '(hidden)' : (item?.text ?? 'No cards')),
                  shown ? modButton('Hide', () => act('hideCard', { id: shown.id, hidden: true })) : ''),
                item?.similar || item?.moreInTheme
                  ? h('div', { class: 'dim small' }, [item.similar && `+${item.similar} similar`, item.moreInTheme && `+${item.moreInTheme} more like this`].filter(Boolean).join(' · '))
                  : '',
                mixLine(item?.mix),
              ],
        lastSlide ? '' : h('div', { class: 'prompts' }, h('span', { class: 'label' }, 'If it’s quiet'), prompts.map((p) => h('div', {}, p))),
        // In the projector's order (oldest first, as its pages turn), not the review order.
        lastSlide ? afterthoughtList('On the projector now, 4 to a page', [...w.afterthoughts].sort((a, b) => a.id - b.id)) : '',
        // Held before the last slide, the hold's alert lists the thoughts instead.
        nextIsLast && !holdLast ? afterthoughtList('Thoughts on the last slide, next: not shown yet', w.afterthoughts) : '',
      ],
      lists: [
        // Earlier in the walk-through, the thoughts wait here, to be read and removed before the last slide.
        !lastSlide && !nextIsLast && !holdLast && w.afterthoughts.length
          ? foldable('afterthoughts', `Thoughts for the last slide (${w.afterthoughts.length})`, false, afterthoughtList('Not shown yet', w.afterthoughts))
          : '',
        allCards(v, false, { bar: !w.held }),
        foldable(
          'stream',
          'Stream',
          false,
          h('p', { class: 'small dim' }, 'Themes in order of total reactions, then cards in order of reactions inside each theme.'),
          h('div', { class: 'stream' }, w.stream.map((s, i) => h('div', { class: i === w.index ? 'now' : '' }, i === 0 || i === w.stream.length - 1 ? s.text : `${i}. ${s.text ?? '(hidden)'} · ${s.reactions} reactions`))),
        ),
      ],
    };
  },

  finale: (v) => ({
    // Once it has played, there's nothing left to speed up.
    now: v.move ? undefined : speedUpButton(v),
    content: h('p', { class: 'dim' }, 'The fingerprint is on the projector. Let it sit. Next is the shred, which needs a confirm.'),
  }),

  // After the shred there's nothing to move back or forward to: the closing
  // screen comes up by itself.
  shred: (v) => ({
    move: h('p', { class: 'dim' }, 'Shredding. The closing screen comes up by itself.'),
    now: speedUpButton(v),
    content: h('p', { class: 'dim' }, 'The database and every file in the data directory are deleted.'),
  }),

  closing: () => ({
    move: h('p', { class: 'dim' }, 'Closing. Everything is shredded.'),
    content: [
      h('p', { class: 'dim' }, 'What the app does, what was left out, and: what do you think? The projector shows a QR code to the feedback thread.'),
      h('button', {
        onclick: () => {
          if (confirm('Start a new session? The projector goes back to the demo, and every phone to “Starting soon”.')) act('reset', { confirm: true });
        },
      }, 'Start a new session…'),
    ],
  }),
};
