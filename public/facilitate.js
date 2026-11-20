// The facilitator view: everything, plus every control. Reached only with the
// facilitator token in the URL. Works on several devices at once.
//
// Every phase uses the same layout, top to bottom, so the eye learns where to
// look:
//   1. Move    (yellow)  back / next phase, and in the walk-through, cards
//   2. Now     (white)   the one number that matters right now, and its time
//   3. Room    (blue)    what the room is asking for: pauses, stay, move on, back
//   4. Content (grey)    what's on screen or needs a decision
//   5. Lists   (folded)  every card, the stream
// Hide and Remove are always red-outlined, on the right of the thing they act on.
import { subscribe, fill, post, h, formatClock, serverNow } from './shared/client.js';

const token = new URLSearchParams(location.search).get('t') ?? '';
const app = document.getElementById('app');
const bar = document.getElementById('bar');
const toasts = document.getElementById('toasts');

const LABELS = {
  join: 'Join',
  submit: 'Submissions',
  cluster: 'Cluster',
  react: 'React',
  walk: 'Walk-through',
  lastcall: 'Last call',
  finale: 'Finale',
  shred: 'Shred',
  closing: 'Closing',
};

let view = null;
let online = false;
let pending = false;
const drafts = new Map(); // theme id -> name being typed
const folded = new Map(); // list name -> open or not, as the facilitator left it

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

// Typing a theme name must not be interrupted by live updates.
app.addEventListener('focusout', () => setTimeout(() => pending && render(), 0));
// Clocks tick in place, so buttons are never swapped out under a finger.
const live = new Set();
const liveClock = (fn) => {
  const el = h('span', { class: 'clock' }, fn());
  live.add({ el, fn });
  return el;
};
setInterval(() => {
  renderBar();
  for (const { el, fn } of live) el.textContent = fn();
}, 1000);

async function act(action, body = {}) {
  try {
    await post(action, body, { 'x-facilitator-token': token });
  } catch (err) {
    const t = h('div', {}, err.message);
    toasts.append(t);
    setTimeout(() => t.remove(), 4000);
  }
}

function renderBar() {
  if (!view) return;
  const c = view.clock;
  const pace = c?.pace ?? 0;
  const clamped = Math.max(-5, Math.min(5, pace));
  const color = Math.abs(pace) < 0.5 ? 'var(--ok)' : pace < 0 ? 'var(--warn)' : '#6aa9ff';
  fill(
    bar,
    h('span', { class: 'phase' }, LABELS[view.phase]),
    c?.startedAt ? h('span', { class: 'clock' }, formatClock(serverNow() - c.startedAt)) : '',
    // Wordless ahead/behind marker: left of centre is behind, right is ahead.
    c?.startedAt
      ? h('span', { class: 'pace', title: 'Pace' }, h('span', { class: 'dot', style: { left: `${50 + clamped * 10}%`, background: color } }))
      : '',
    h('span', { class: 'dim' }, `${view.phones} phones`),
    online ? '' : h('span', { class: 'offline' }, 'Reconnecting…'),
  );
}

function render() {
  if (!view) return;
  if (app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
    pending = true;
    return;
  }
  pending = false;
  live.clear();
  renderBar();
  const v = view;
  const p = PHASES[v.phase](v);
  fill(app, zone('move', p.move ?? nav(v)), zone('now', p.now), zone('room', p.room), zone('content', p.content), p.lists);
}

function zone(kind, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '');
  return kids.length ? h('section', { class: `zone zone-${kind}` }, kids) : '';
}

// ---- building blocks -------------------------------------------------------

function nav(v) {
  const back = h('button', { disabled: !v.canBack, onclick: () => act('back') }, '◀ Back');
  let next;
  if (v.next === 'shred') {
    next = h('button', { class: 'danger' }, 'Shred…');
    next.addEventListener('click', () => {
      if (confirm('Shred everything? This deletes every card, reaction and comment from the server, and Back cannot undo it.')) {
        act('advance', { confirm: true });
      }
    });
  } else next = h('button', { class: 'primary', onclick: () => act('advance') }, `${LABELS[v.next]} ▶`);
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

function modButton(label, onclick) {
  return h('button', { class: 'small-btn mod', onclick }, label);
}

function cardRow(card) {
  return h(
    'div',
    { class: `cardrow${card.hidden ? ' hidden' : ''}` },
    h('div', { class: 'text' }, card.text),
    modButton(card.hidden ? 'Show' : 'Hide', () => act('hideCard', { id: card.id, hidden: !card.hidden })),
  );
}

// A folded list that stays open or closed the way the facilitator left it.
function foldable(key, summary, defaultOpen, ...children) {
  const el = h('details', { class: 'zone zone-lists', open: folded.has(key) ? folded.get(key) : defaultOpen }, h('summary', {}, summary), ...children);
  el.addEventListener('toggle', () => folded.set(key, el.open));
  return el;
}

function allCards(v, defaultOpen = false) {
  if (!v.cards?.length) return '';
  const visible = v.cards.filter((c) => !c.hidden).length;
  return foldable('cards', `All cards (${visible} shown, ${v.cards.length - visible} hidden)`, defaultOpen, v.cards.map(cardRow));
}

function mixLine(mix) {
  return h('div', { class: 'mixline' }, (mix ?? []).map(([e, n]) => `${e}${n > 1 ? `×${n}` : ''}`).join('  ') || ' ');
}

function pauseControls(v) {
  if (v.pause) {
    const p = v.pause;
    const end = p.graceEndsAt ?? p.endsAt;
    return h(
      'div',
      { class: 'room-row active' },
      h('strong', {}, p.graceEndsAt ? 'Pause: grace period' : 'Pause running'),
      liveClock(() => formatClock(end - serverNow())),
      h('span', { class: 'dim grow' }, `${p.submittedCount} sent · ${p.openedCount - p.submittedCount} typing`),
      h('button', { class: 'small-btn', onclick: () => act('endPause') }, 'End pause'),
    );
  }
  return h(
    'div',
    { class: `room-row${v.pauseRequests ? ' active' : ''}` },
    h('strong', { class: 'grow' },
      !v.pauseRequests ? 'No pause requests' : v.pauseHeld ? `${v.pauseRequests} waiting for a pause (held)` : `${v.pauseRequests} asking for a pause`),
    h('button', { class: 'small-btn room-btn', onclick: () => act('acceptPause') }, v.pauseRequests ? 'Start pause now' : 'Start a pause'),
    v.pauseRequests && !v.pauseHeld ? h('button', { class: 'small-btn', onclick: () => act('holdPause') }, 'Later') : '',
    v.pauseRequests
      ? h('div', { class: 'small dim', style: { flexBasis: '100%' } },
          v.pauseHeld
            ? 'The room sees “Pause: coming up”. Start it when the person speaking is done.'
            : '“Later” keeps the request waiting, and the room sees “Pause: coming up”, so you can let someone finish speaking first.')
      : '',
  );
}

function commentList(v) {
  if (!v.comments?.length) return '';
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'label' }, 'Comments, live on the projector'),
    v.comments.map((c) => h('div', { class: 'cardrow' }, h('div', { class: 'text' }, c.text), modButton('Remove', () => act('removeComment', { id: c.id })))),
  );
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
  'Anyone want to add to this, out loud or anonymously?',
  'What do you notice in the emoji mix?',
  'Has anyone felt the opposite?',
  'Is this something people talk about at work, or not?',
];
const OVERVIEW_PROMPTS = ['First reactions: anything surprise you?', 'Which of these feels most like your year?'];

const DISCLOSURE =
  'Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. Submitted cards go to Anthropic (Claude Haiku) for grouping; they don’t train on them and delete them within 30 days. I see cards before they’re shown and can remove any card or comment to prevent abuse. Everything on our server is shredded tonight.';

// ---- phases ----------------------------------------------------------------

const PHASES = {
  join: (v) => ({
    now: now(v.phones, ' phones connected'),
    content: [h('div', { class: 'label' }, 'Trust disclosure (fine print on the projector)'), h('p', { class: 'disclosure' }, DISCLOSURE)],
  }),

  submit: (v) => ({
    now: now(
      v.cards.length,
      ` cards from ${v.submit.people} people`,
      liveClock(() => {
        const left = v.submit.endsAt - serverNow();
        return `${left < 0 ? '-' : ''}${formatClock(Math.abs(left))}`;
      }),
      ' left',
      h('div', { class: 'row wrap' },
        h('button', { class: 'small-btn', onclick: () => act('extend') }, '+1 minute'),
        h('button', { class: `small-btn${v.submit.nudgesOn ? ' on' : ''}`, onclick: () => act('nudges', { on: !v.submit.nudgesOn }) }, `Nudges ${v.submit.nudgesOn ? 'on' : 'off'}`),
        h('span', { class: 'small dim grow' }, nudgeStatus(v.submit))),
    ),
    content: h('p', { class: 'dim small' }, 'Cards arrive below. Hide any card that shouldn’t be shown.'),
    lists: allCards(v, true),
  }),

  cluster: (v) => {
    const c = v.clustering;
    const unapproved = v.themes.filter((t) => !t.approved).length;
    const status =
      c.status === 'running'
        ? 'Grouping with Claude Haiku…'
        : c.empty
          ? 'No cards were submitted, so there’s nothing to group.'
          : c.status === 'failed'
            ? `Grouping failed: ${c.error}. Showing one card per group.`
            : c.local
              ? 'Grouped without AI (no API key on the server): one card per group.'
              : unapproved
                ? `${unapproved} of ${v.themes.length} names not approved. Unapproved themes show no name on the projector.`
                : 'All names approved.';
    const approveAll = () => {
      const names = Object.fromEntries(v.themes.map((t) => [t.id, drafts.get(t.id) ?? t.name]));
      drafts.clear();
      act('approveAll', { names });
    };
    return {
      now: now(
        v.themes.length,
        v.themes.length === 1 ? ' theme' : ' themes',
        undefined,
        '',
        h('div', { class: 'row' },
          h('span', { class: 'grow dim small' }, status),
          c.status === 'failed' ? h('button', { class: 'small-btn', onclick: () => act('recluster') }, 'Retry') : '',
          v.themes.length && unapproved && c.status !== 'running' ? h('button', { class: 'small-btn primary', onclick: approveAll }, 'Approve all') : ''),
      ),
      content: [
        v.themes.map((t) => {
          const input = h('input', { type: 'text', maxLength: 60, placeholder: 'Theme name' });
          input.value = drafts.get(t.id) ?? t.name;
          input.addEventListener('input', () => drafts.set(t.id, input.value));
          const approve = () => {
            drafts.delete(t.id);
            act('approveTheme', { id: t.id, name: input.value });
          };
          input.addEventListener('keydown', (e) => e.key === 'Enter' && (input.blur(), approve()));
          return h(
            'div',
            { class: `theme${t.approved ? ' approved' : ''}` },
            h('div', { class: 'row' }, input, h('button', { class: `small-btn${t.approved ? '' : ' primary'}`, onclick: approve }, t.approved ? 'Approved ✓' : 'Approve')),
            t.groups.map((g) => h('div', { class: `group${g.cards.length > 1 ? ' dupes' : ''}` }, g.cards.map(cardRow))),
          );
        }),
        c.status !== 'running' && c.status !== 'idle' && !c.empty ? h('button', { class: 'quiet', onclick: () => act('recluster') }, 'Re-run grouping') : '',
      ],
    };
  },

  react: (v) => {
    const total = Math.max(v.phones, v.react.done);
    const pct = total ? Math.round((v.react.done / total) * 100) : 0;
    return {
      now: now(`${pct}%`, ` of phones finished (${v.react.done} of ${total})`, since(v.phaseStartedAt), ' in this phase'),
      content: h('p', { class: 'dim small' }, `${v.react.reactions} reactions so far. Move on when it feels right: there’s no fixed cutoff.`),
      lists: allCards(v),
    };
  },

  walk: (v) => {
    const w = v.walk;
    const item = w.item;
    const overview = !!item?.overview;
    const group = overview || !item ? null : v.themes.flatMap((t) => t.groups).find((g) => g.id === item.groupId);
    const shown = group?.cards.find((c) => !c.hidden);
    const cards = Math.max(0, w.total - 1);
    const prompts = overview ? OVERVIEW_PROMPTS : [PROMPTS[w.index % PROMPTS.length], PROMPTS[(w.index + 1) % PROMPTS.length]];
    return {
      move: [
        nav(v),
        h('div', { class: 'walk-nav' },
          h('button', { disabled: w.index === 0, onclick: () => act('prevCard') }, '◀ Card'),
          h('button', { class: 'primary', disabled: w.index >= w.total - 1, onclick: () => act('nextCard') }, w.index === 0 ? 'First card ▶' : 'Next card ▶')),
      ],
      now: now(
        overview ? 'Overview' : `Card ${w.index} of ${cards}`,
        '',
        since(w.cardStartedAt),
        overview ? ' on the overview' : ` of ~${formatClock(w.budgetMs)}`,
      ),
      room: [
        pauseControls(v),
        h('div', { class: 'signals' },
          h('div', {}, h('b', {}, w.stay), 'stay'),
          h('div', { class: 'private' }, h('b', {}, w.moveOn), 'move on (only you)'),
          h('div', {}, h('b', {}, w.back), 'go back')),
      ],
      content: [
        overview
          ? h('div', { class: 'current' }, 'Overview of the themes. Say aloud: you set the pace, timers are hints, and anyone can ask to stay, move on or go back.')
          : [
              item?.theme ? h('div', { class: 'dim' }, item.theme) : '',
              h('div', { class: 'row', style: { alignItems: 'flex-start' } },
                h('div', { class: 'current grow' }, item?.hidden ? '(hidden)' : (item?.text ?? 'No cards')),
                shown ? modButton('Hide', () => act('hideCard', { id: shown.id, hidden: true })) : ''),
              item?.similar || item?.moreInTheme
                ? h('div', { class: 'dim small' }, [item.similar && `+${item.similar} similar`, item.moreInTheme && `+${item.moreInTheme} more like this`].filter(Boolean).join(' · '))
                : '',
              mixLine(item?.mix),
            ],
        h('div', { class: 'prompts' }, h('span', { class: 'label' }, 'If it’s quiet'), prompts.map((p) => h('div', {}, p))),
        commentList(v),
      ],
      lists: foldable(
        'stream',
        'Stream',
        false,
        h('p', { class: 'small dim' }, 'Themes in order of total reactions, then cards in order of reactions inside each theme.'),
        h('div', { class: 'stream' }, w.stream.map((s, i) => h('div', { class: i === w.index ? 'now' : '' }, i === 0 ? s.text : `${i}. ${s.text ?? '(hidden)'} · ${s.reactions} reactions`))),
      ),
    };
  },

  lastcall: (v) => ({
    now: now(v.comments?.length ?? 0, ' anonymous comments', since(v.phaseStartedAt), ' in this phase'),
    room: pauseControls(v),
    content: [h('p', { class: 'dim small' }, 'In person first: anything else to say out loud? The anonymous pause is there if someone prefers it.'), commentList(v)],
  }),

  finale: () => ({
    content: h('p', { class: 'dim' }, 'The fingerprint is on the projector. Let it sit. Next is the shred, which needs a confirm.'),
  }),

  // After the shred there's nothing to move back or forward to: the closing
  // screen comes up by itself.
  shred: () => ({
    move: h('p', { class: 'dim' }, 'Shredding. The closing screen comes up by itself.'),
    content: h('p', { class: 'dim' }, 'The database and every file in the data directory are deleted.'),
  }),

  closing: () => ({
    move: h('p', { class: 'dim' }, 'Closing. Everything is shredded.'),
    content: [
      h('p', { class: 'dim' }, 'What the app does, what was left out, and: what do you think? The projector shows a QR code to the feedback thread.'),
      h('button', {
        onclick: () => {
          if (confirm('Start a new session? Every phone and the projector go back to the Join screen.')) act('reset', { confirm: true });
        },
      }, 'Start a new session…'),
    ],
  }),
};
