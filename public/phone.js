// The participant's phone. Private notes live only in this tab's
// sessionStorage: they never leave the phone, and they're wiped when the tab
// closes or the session is shredded.
import { subscribe, fill, post, h, formatClock, serverNow, seededShuffle } from './shared/client.js';
import { PRESETS, firstEmoji } from './shared/emoji.js';
import { loadChecker, HINT } from './shared/identifier-check.js';

const PROMPT = 'Something you experienced, felt, or were surprised by in 2026.';
const SOFT_MAX = 140;
const HARD_MAX = 200;

const local = {
  get(key, fallback) {
    try {
      return JSON.parse(sessionStorage.getItem(`otr.${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(`otr.${key}`, JSON.stringify(value));
    } catch {}
  },
  clear() {
    try {
      sessionStorage.clear();
    } catch {}
  },
};

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let cid = local.get('cid');
if (!cid) local.set('cid', (cid = newId()));

let check = () => [];
loadChecker().then((c) => (check = c));

const app = document.getElementById('app');
const flash = document.getElementById('flash');
const status = document.getElementById('status');
let screen = null;
let screenPhase = null;

// Phase change: vibrate where the browser allows it (Android), and flash the
// screen everywhere (iPhones don't support web vibration).
function buzz() {
  navigator.vibrate?.(120);
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
}

subscribe(
  `role=phone&cid=${cid}`,
  (view) => {
    if (view.phase !== screenPhase) {
      if (screenPhase !== null) buzz();
      screen?.destroy?.();
      screenPhase = view.phase;
      screen = SCREENS[view.phase](view);
      fill(app, screen.el);
    }
    screen.update?.(view);
  },
  (online) => status.classList.toggle('offline', !online),
);

function showError(container, err) {
  const msg = h('p', { class: 'hint' }, err.message);
  container.append(msg);
  setTimeout(() => msg.remove(), 4000);
}

function lookUp(title = 'Look up', sub = '') {
  return { el: h('div', { class: 'lookup' }, h('div', { class: 'big' }, title), sub && h('p', { class: 'faint' }, sub)) };
}

function identifierHint(text) {
  const hits = check(text);
  if (!hits.length) return null;
  return h('div', { class: 'hint' }, HINT, h('div', { class: 'small faint' }, hits.join(', ')));
}

// ---- screens ----------------------------------------------------------------

const SCREENS = {
  join: () => ({
    el: h(
      'div',
      { class: 'stack' },
      h('h1', {}, 'Off the Record'),
      h('p', {}, "You're in."),
      h(
        'ul',
        { class: 'plain dim' },
        h('li', {}, "It's anonymous: no login, no names."),
        h('li', {}, 'Nothing is kept. Everything is shredded tonight.'),
        h('li', {}, 'You can always speak aloud instead.'),
      ),
      // A first tap lets Android vibrate on later phase changes (browsers
      // block vibration until the person has touched the page).
      h('button', { class: 'primary', onclick: (e) => ((e.target.textContent = 'Ready ✓'), (e.target.disabled = true), navigator.vibrate?.(40)) }, 'I’m here'),
      h('div', { class: 'lookup' }, h('div', { class: 'big' }, 'Look up'), h('p', { class: 'faint small' }, 'This screen changes when it’s time.')),
    ),
  }),
  submit: submitScreen,
  cluster: () => lookUp('Look up', 'Grouping the cards.'),
  react: reactScreen,
  walk: walkScreen,
  lastcall: walkScreen,
  finale: () => lookUp(),
  shred: () => {
    local.clear();
    return { el: h('div', { class: 'black' }, 'Shredded.') };
  },
  closing: () => {
    local.clear();
    return { el: h('div', { class: 'black' }, 'Thank you.') };
  },
};

// ---- submissions: private notes, then pick up to 3 --------------------------

function submitScreen() {
  let notes = local.get('notes', []);
  let step = 'write';
  let picked = new Set();
  let view = null;
  let toast = null;
  const saveNotes = () => local.set('notes', notes);

  const timer = h('div', { class: 'timer' });
  const body = h('div', { class: 'stack' });
  const el = h('div', { class: 'stack' }, h('h2', {}, PROMPT), timer, body);

  const remaining = () => (view ? view.submit.max - view.submit.submitted : 3);

  function renderWrite(prefill = local.get('draft', '')) {
    const input = h('textarea', { rows: 4, maxLength: HARD_MAX, placeholder: 'Write freely. Notes stay on this phone.' });
    input.value = prefill;
    const counter = h('div', { class: 'counter' });
    const add = h('button', { class: 'grow' }, 'Save note');
    const refresh = () => {
      const n = input.value.trim().length;
      counter.textContent = `${input.value.length}/${SOFT_MAX}`;
      counter.classList.toggle('over', input.value.length > SOFT_MAX);
      add.disabled = n === 0;
      local.set('draft', input.value);
    };
    input.addEventListener('input', refresh);
    add.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      notes.push({ id: newId(), text });
      saveNotes();
      input.value = '';
      refresh();
      render();
      body.querySelector('textarea')?.focus();
    });
    refresh();

    const list = notes.map((note) =>
      h(
        'div',
        { class: 'note' },
        h('div', { class: 'text' }, note.text),
        h('button', { class: 'quiet', onclick: () => editNote(note) }, 'Edit'),
        h('button', { class: 'quiet', onclick: () => deleteNote(note) }, '✕'),
      ),
    );
    const left = remaining();
    fill(body, 
      toast ?? '',
      left > 0 ? [input, counter, h('div', { class: 'row' }, add)] : h('p', { class: 'dim' }, `You've shared ${view?.submit.max ?? 3} cards. Thank you.`),
      notes.length ? h('p', { class: 'small faint' }, 'Private notes (only on this phone)') : '',
      list,
      left > 0 && notes.length
        ? h('button', { class: 'primary', onclick: () => ((step = 'pick'), (toast = null), render()) }, `Pick up to ${left} to share →`)
        : '',
    );
  }

  function editNote(note) {
    notes = notes.filter((n) => n !== note);
    picked.delete(note.id);
    saveNotes();
    step = 'write';
    render(note.text);
    body.querySelector('textarea')?.focus();
  }

  function deleteNote(note) {
    notes = notes.filter((n) => n !== note);
    picked.delete(note.id);
    saveNotes();
    render();
  }

  function renderPick() {
    const left = remaining();
    picked = new Set([...picked].filter((id) => notes.some((n) => n.id === id)));
    const share = h('button', { class: 'primary', disabled: picked.size === 0 }, picked.size > 1 ? `Share ${picked.size} cards` : 'Share 1 card');
    share.addEventListener('click', async () => {
      const chosen = notes.filter((n) => picked.has(n.id));
      share.disabled = true;
      try {
        await post('submit', { cid, texts: chosen.map((n) => n.text) });
        notes = notes.filter((n) => !picked.has(n.id));
        picked.clear();
        saveNotes();
        step = 'write';
        toast = h('div', { class: 'toast' }, 'Shared. Look up when Erik moves on.');
        render();
      } catch (err) {
        share.disabled = false;
        showError(body, err);
      }
    });
    fill(body, 
      h('p', {}, `Pick up to ${left} to share as cards. The rest stay here and are discarded.`),
      notes.map((note) => {
        const on = picked.has(note.id);
        const hint = on ? identifierHint(note.text) : null;
        return h(
          'div',
          { class: 'stack', style: { gap: '6px' } },
          h(
            'button',
            {
              class: `note pickable${on ? ' picked' : ''}`,
              onclick: () => {
                if (on) picked.delete(note.id);
                else if (picked.size < left) picked.add(note.id);
                render();
              },
            },
            h('span', { class: 'check' }),
            h('span', { class: 'text' }, note.text),
          ),
          hint && h('div', { class: 'row' }, h('div', { class: 'grow' }, hint), h('button', { class: 'quiet', onclick: () => editNote(note) }, 'Edit')),
        );
      }),
      share,
      h('button', { class: 'quiet', onclick: () => ((step = 'write'), render()) }, '← Back to notes'),
    );
  }

  function render(prefill) {
    if (step === 'pick' && remaining() > 0 && notes.length) renderPick();
    else {
      step = 'write';
      renderWrite(prefill);
    }
  }

  function tickTimer() {
    const left = view?.submit.endsAt ? view.submit.endsAt - serverNow() : Infinity;
    timer.textContent = left <= 60_000 ? (left > 0 ? `About a minute left to share (${formatClock(left)})` : 'Time is nearly up: share what you want now.') : '';
  }
  const interval = setInterval(tickTimer, 1000);

  let lastRemaining = null;
  return {
    el,
    update(v) {
      view = v;
      tickTimer();
      // Re-render only when something that changes the layout changed, so
      // typing is never interrupted.
      if (remaining() !== lastRemaining) {
        const first = lastRemaining === null;
        lastRemaining = remaining();
        if (first || !el.contains(document.activeElement)) render();
      }
    },
    destroy() {
      clearInterval(interval);
    },
  };
}

// ---- reactions: one card at a time, one pass ---------------------------------

function reactScreen() {
  const el = h('div', { class: 'stack' });
  let groups = [];
  let done = new Set(local.get('reacted', []));
  let current = null;
  let selected = new Set();
  let custom = [];
  let finished = false;
  let sentDone = false;

  function order() {
    const ids = groups.map((g) => g.id).sort((a, b) => a - b);
    return seededShuffle(ids, `${cid}:react`).items;
  }

  function textFor(group) {
    // Each phone sees one wording from a group of near-duplicates.
    const { rand } = seededShuffle([], `${cid}:${group.id}`);
    return group.texts[Math.floor(rand() * group.texts.length)];
  }

  async function finish() {
    finished = true;
    fill(el, lookUp('Look up', 'That was every card. Thank you.').el);
    if (!sentDone) {
      sentDone = true;
      post('reactDone', { cid }).catch(() => (sentDone = false));
    }
  }

  function show() {
    const ids = order();
    const nextId = ids.find((id) => !done.has(id));
    if (nextId === undefined) return finish();
    if (current?.id === nextId) return;
    current = groups.find((g) => g.id === nextId);
    selected = new Set();
    custom = [];
    const position = ids.filter((id) => done.has(id)).length + 1;

    const grid = h(
      'div',
      { class: 'emoji-grid' },
      PRESETS.map(({ e, label }) => {
        const b = h('button', { 'aria-pressed': 'false' }, h('span', { class: 'e' }, e), h('span', { class: 'l' }, label));
        b.addEventListener('click', () => {
          if (selected.has(e)) selected.delete(e);
          else selected.add(e);
          b.classList.toggle('on', selected.has(e));
          b.setAttribute('aria-pressed', String(selected.has(e)));
        });
        return b;
      }),
    );
    const chips = h('div', { class: 'row wrap' });
    const input = h('input', { type: 'text', placeholder: '＋ any emoji', maxLength: 16, 'aria-label': 'Add any emoji' });
    input.addEventListener('input', () => {
      const e = firstEmoji(input.value);
      if (!e) return;
      input.value = '';
      if (PRESETS.some((p) => p.e === e) || custom.includes(e) || custom.length >= 4) return;
      custom.push(e);
      selected.add(e);
      const chip = h('button', { class: 'chip on' }, e);
      chip.addEventListener('click', () => {
        if (selected.has(e)) selected.delete(e);
        else selected.add(e);
        chip.classList.toggle('on', selected.has(e));
      });
      chips.append(chip);
    });
    const next = h('button', { class: 'primary' }, 'Next');
    next.addEventListener('click', async () => {
      next.disabled = true;
      try {
        await post('react', { cid, groupId: current.id, emojis: [...selected] });
      } catch (err) {
        if (!/every card|No such card/.test(err.message)) {
          next.disabled = false;
          return showError(el, err);
        }
      }
      done.add(current.id);
      local.set('reacted', [...done]);
      show();
    });

    fill(el, 
      h('div', { class: 'small faint' }, `Card ${position} of ${ids.length}`),
      h('div', { class: 'react-card' }, textFor(current)),
      grid,
      h('div', { class: 'row wrap custom-row' }, input, chips),
      next,
    );
  }

  return {
    el,
    update(v) {
      if (finished) return;
      groups = v.react.groups;
      if (v.react.done) return finish();
      // A hidden card leaves the stack, even mid-way.
      if (current && !groups.some((g) => g.id === current.id)) current = null;
      show();
    },
  };
}

// ---- walk-through and last call: look up, with a few light taps ---------------

function walkScreen(first) {
  const last = first.phase === 'lastcall';
  const el = h('div', { class: 'stack', style: { flex: '1' } });
  const head = h('div', { class: 'lookup' }, h('div', { class: 'big' }, last ? 'Last call' : 'Look up'));
  const signals = h('div', { class: 'signals' });
  const pauseButton = h('button', {}, 'Ask for an anonymous pause');
  const pausePanel = h('div');
  el.append(head, pausePanel, last ? '' : signals, pauseButton);

  const toggles = {};
  const signal = (kind, label, sub) => {
    const b = h('button', {}, label, h('span', { class: 'sub' }, sub));
    b.addEventListener('click', () => {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on);
      post('signal', { cid, kind, on }).catch(() => b.classList.toggle('on', !on));
    });
    toggles[kind] = b;
    return b;
  };
  signals.append(signal('stay', 'Stay', 'on this card'), signal('moveOn', 'Move on', 'only Erik sees'), signal('back', 'Go back', 'a card'));
  pauseButton.addEventListener('click', () => {
    const on = !pauseButton.classList.contains('on');
    pauseButton.classList.toggle('on', on);
    pauseButton.textContent = on ? 'Pause requested (tap to cancel)' : 'Ask for an anonymous pause';
    post('requestPause', { cid, on }).catch(() => pauseButton.classList.toggle('on', !on));
  });

  let pauseKey = null;
  let pause = null;
  const countdown = h('div', { class: 'timer' });
  const tick = () => {
    if (!pause) return;
    const end = pause.graceEndsAt ?? pause.endsAt;
    countdown.textContent = pause.graceEndsAt
      ? `Time's up: send as is or cancel (${formatClock(end - serverNow())})`
      : formatClock(end - serverNow());
  };
  const interval = setInterval(tick, 500);

  function renderPause() {
    if (!pause) return fill(pausePanel, );
    const parts = [h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Anonymous pause'), countdown)];
    if (pause.text) parts.push(h('div', { class: 'about' }, pause.text));
    if (pause.submitted) {
      parts.push(h('p', { class: 'dim' }, 'Sent. Look up.'));
    } else if (pause.opened) {
      const input = h('textarea', { rows: 3, maxLength: HARD_MAX, placeholder: 'Your anonymous comment' });
      input.value = local.get('comment', '');
      const hint = h('div');
      const send = h('button', { class: 'primary grow' }, 'Send');
      const refresh = () => {
        local.set('comment', input.value);
        send.disabled = !input.value.trim();
        fill(hint, identifierHint(input.value) ?? '');
      };
      input.addEventListener('input', refresh);
      refresh();
      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          await post('comment', { cid, text: input.value });
          local.set('comment', '');
        } catch (err) {
          send.disabled = false;
          showError(pausePanel, err);
        }
      });
      const cancel = h('button', { class: 'quiet' }, 'Cancel');
      cancel.addEventListener('click', () => {
        local.set('comment', '');
        post('cancelComment', { cid }).catch(() => {});
      });
      parts.push(input, hint, h('div', { class: 'row' }, cancel, send));
      setTimeout(() => input.focus(), 0);
    } else if (!pause.graceEndsAt) {
      parts.push(h('button', { onclick: () => post('openComment', { cid }).catch((err) => showError(pausePanel, err)) }, 'Add a comment'));
    }
    fill(pausePanel, h('div', { class: 'pause-panel' }, parts));
    tick();
  }

  return {
    el,
    update(v) {
      const w = v.walk;
      for (const [kind, b] of Object.entries(toggles)) b.classList.toggle('on', !!w.mine[kind]);
      pauseButton.classList.toggle('on', w.mine.pause);
      pauseButton.textContent = w.mine.pause ? 'Pause requested (tap to cancel)' : 'Ask for an anonymous pause';
      pause = w.pause;
      pauseButton.hidden = !!pause;
      signals.hidden = !!pause;
      const key = pause ? `${pause.startedAt}:${pause.opened}:${pause.submitted}:${!!pause.graceEndsAt}` : null;
      if (key !== pauseKey) {
        pauseKey = key;
        renderPause();
      }
    },
    destroy() {
      clearInterval(interval);
    },
  };
}
