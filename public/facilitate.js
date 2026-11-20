// The facilitator view: everything, plus every control. Reached only with the
// facilitator token in the URL. Works on several devices at once.
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
  fill(bar, 
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
  const parts = [nav(v)];
  parts.push(...[PANELS[v.phase]?.(v)].flat().filter(Boolean));
  if (!v.shredded && v.cards?.length && v.phase !== 'cluster') parts.push(allCards(v));
  fill(app, ...parts);
}

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
  } else if (v.next) {
    next = h('button', { class: 'primary', onclick: () => act('advance') }, `${LABELS[v.next]} ▶`);
  } else next = h('button', { disabled: true }, 'Done');
  return h('div', { class: 'nav' }, back, next);
}

function panel(title, ...children) {
  return h('section', { class: 'panel' }, h('h3', {}, title), ...children);
}

function cardRow(card) {
  return h(
    'div',
    { class: `cardrow${card.hidden ? ' hidden' : ''}` },
    h('div', { class: 'text' }, card.text),
    h('button', { class: 'small-btn', onclick: () => act('hideCard', { id: card.id, hidden: !card.hidden }) }, card.hidden ? 'Show' : 'Hide'),
  );
}

function allCards(v) {
  const visible = v.cards.filter((c) => !c.hidden).length;
  return h(
    'details',
    { open: v.phase === 'submit' },
    h('summary', {}, `All cards (${visible} shown, ${v.cards.length - visible} hidden)`),
    h('section', { class: 'panel' }, v.cards.map(cardRow)),
  );
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
      { class: 'alert' },
      h('strong', {}, p.graceEndsAt ? 'Pause: grace period' : 'Pause running'),
      liveClock(() => formatClock(end - serverNow())),
      h('span', { class: 'dim' }, `${p.submittedCount} sent · ${p.openedCount - p.submittedCount} typing`),
      h('button', { class: 'small-btn', onclick: () => act('endPause') }, 'End pause'),
    );
  }
  return h(
    'div',
    { class: 'alert', style: v.pauseRequests ? {} : { borderColor: 'var(--line)', background: 'none' } },
    h('strong', { class: 'grow' },
      !v.pauseRequests ? 'No pause requests' : v.pauseHeld ? `${v.pauseRequests} waiting for a pause (held)` : `${v.pauseRequests} asking for a pause`),
    h('button', { class: 'small-btn primary', onclick: () => act('acceptPause') }, v.pauseRequests ? 'Start pause now' : 'Start a pause'),
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
  return panel(
    'Comments (live on the projector)',
    v.comments.map((c) =>
      h('div', { class: 'cardrow' }, h('div', { class: 'text' }, c.text), h('button', { class: 'small-btn', onclick: () => act('removeComment', { id: c.id }) }, 'Remove')),
    ),
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

const DISCLOSURE =
  'Anonymous: no logins, no names, no IP logs. Your notes stay on your phone unless you pick them to submit. Submitted cards go to Anthropic (Claude Haiku) for grouping; they don’t train on them and delete them within 30 days. I see cards before they’re shown and can remove any card or comment to prevent abuse. Everything on our server is shredded tonight.';

const PANELS = {
  join: (v) => panel('Join', h('div', { class: 'stat' }, v.phones, h('small', {}, ' phones connected')), h('p', { class: 'disclosure' }, DISCLOSURE)),

  submit: (v) => {
    return panel(
      'Submissions',
      h('div', { class: 'row wrap' },
        h('div', { class: 'stat grow' }, v.cards.length, h('small', {}, ` cards from ${v.submit.people} people`)),
        h('div', { class: 'stat' }, liveClock(() => {
          const left = v.submit.endsAt - serverNow();
          return `${left < 0 ? '-' : ''}${formatClock(Math.abs(left))}`;
        }), h('small', {}, ' left'))),
      h('div', { class: 'row wrap' },
        h('button', { onclick: () => act('extend') }, '+1 minute'),
        h('button', { class: v.submit.nudgesOn ? 'on' : '', onclick: () => act('nudges', { on: !v.submit.nudgesOn }) }, `Nudges ${v.submit.nudgesOn ? 'on' : 'off'}`)),
      h('div', { class: 'small dim' }, nudgeStatus(v.submit)),
    );
  },

  cluster: (v) => {
    const c = v.clustering;
    const status =
      c.status === 'running'
        ? h('p', {}, 'Grouping with Claude Haiku…')
        : c.status === 'failed'
          ? h('div', { class: 'alert' }, h('span', { class: 'grow' }, `Grouping failed: ${c.error}. Showing one card per group.`), h('button', { class: 'small-btn', onclick: () => act('recluster') }, 'Retry'))
          : c.local
            ? h('p', { class: 'dim' }, 'Grouped locally (no API key): one card per group.')
            : h('p', { class: 'dim' }, 'Approve each theme name before it can be projected. Hide any card that shouldn’t be shown.');
    const unapproved = v.themes.filter((t) => !t.approved).length;
    const approveAll = () => {
      const names = Object.fromEntries(v.themes.map((t) => [t.id, drafts.get(t.id) ?? t.name]));
      drafts.clear();
      act('approveAll', { names });
    };
    return panel(
      'Themes',
      status,
      v.themes.length && c.status !== 'running'
        ? h('div', { class: 'row' },
            h('span', { class: 'grow dim small' }, unapproved ? `${unapproved} of ${v.themes.length} names not approved yet. Unapproved themes show no name on the projector.` : 'All names approved.'),
            unapproved ? h('button', { class: 'small-btn primary', onclick: approveAll }, 'Approve all') : '')
        : '',
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
      c.status !== 'running' && c.status !== 'idle' ? h('button', { class: 'quiet', onclick: () => act('recluster') }, 'Re-run grouping') : '',
    );
  },

  react: (v) => {
    const total = Math.max(v.phones, v.react.done);
    const pct = total ? Math.round((v.react.done / total) * 100) : 0;
    return panel(
      'Reactions',
      h('div', { class: 'stat' }, `${pct}%`, h('small', {}, ` of phones finished (${v.react.done} of ${total})`)),
      h('div', { class: 'stat' }, liveClock(() => formatClock(serverNow() - v.phaseStartedAt)), h('small', {}, ' in this phase')),
      h('div', { class: 'dim' }, `${v.react.reactions} reactions so far`),
    );
  },

  walk: (v) => {
    const w = v.walk;
    const item = w.item;
    const group = item && v.themes.flatMap((t) => t.groups).find((g) => g.id === item.groupId);
    const shown = group?.cards.find((c) => !c.hidden);
    return [
      pauseControls(v),
      panel(
        h('span', {}, `Card ${w.total ? w.index + 1 : 0} of ${w.total} · `, liveClock(() => formatClock(serverNow() - w.cardStartedAt)), ` of ~${formatClock(w.budgetMs)} on this card`),
        item?.theme ? h('div', { class: 'dim' }, item.theme) : '',
        h('div', { class: 'current' }, item?.hidden ? '(hidden)' : (item?.text ?? 'No cards')),
        item?.similar || item?.moreInTheme
          ? h('div', { class: 'dim small' }, [item.similar && `+${item.similar} similar`, item.moreInTheme && `+${item.moreInTheme} more like this`].filter(Boolean).join(' · '))
          : '',
        mixLine(item?.mix),
        h('div', { class: 'signals' },
          h('div', {}, h('b', {}, w.stay), 'stay'),
          h('div', { class: 'private' }, h('b', {}, w.moveOn), 'move on (only you)'),
          h('div', {}, h('b', {}, w.back), 'go back')),
        h('div', { class: 'walk-nav' },
          h('button', { disabled: w.index === 0, onclick: () => act('prevCard') }, '◀ Card'),
          h('button', { class: 'primary', disabled: w.index >= w.total - 1, onclick: () => act('nextCard') }, 'Next card ▶')),
        shown ? h('button', { class: 'quiet', onclick: () => act('hideCard', { id: shown.id, hidden: true }) }, 'Hide this card') : '',
      ),
      commentList(v),
      panel(
        'Stream',
        h('p', { class: 'small dim' }, 'Themes in order of total reactions, then cards in order of reactions inside each theme.'),
        h('div', { class: 'stream' }, w.stream.map((s, i) => h('div', { class: i === w.index ? 'now' : '' }, `${i + 1}. ${s.text ?? '(hidden)'} · ${s.reactions} reactions`))),
      ),
    ];
  },

  lastcall: (v) => [pauseControls(v), commentList(v)],
  finale: () => panel('Finale', h('p', { class: 'dim' }, 'The fingerprint is on the projector. Let it sit. Next is the shred, which needs a confirm.')),
  shred: () => panel('Shredded', h('p', { class: 'dim' }, 'The database and every file in the data directory are deleted. Nothing to go back to. The closing screen comes up by itself after the animation and a moment of black.')),
  closing: () =>
    panel(
      'Closing',
      h('p', { class: 'dim' }, 'What the app does, what was left out, and: what do you think?'),
      h('button', {
        onclick: () => {
          if (confirm('Start a new session? Every phone and the projector go back to the Join screen.')) act('reset', { confirm: true });
        },
      }, 'Start a new session…'),
    ),
};
