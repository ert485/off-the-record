// The participant's phone. Private notes live only in this tab's
// sessionStorage: they never leave the phone, and they're wiped when the tab
// closes or the session is shredded.
import { subscribe, fill, post, h, formatClock, serverNow, seededShuffle } from './shared/client.js';
import { PRESETS, firstEmoji } from './shared/emoji.js';
import { loadChecker, HINT } from './shared/identifier-check.js';

const PROMPT = 'Write down something you experienced, felt, or were surprised by in 2026.';
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
        h('li', {}, 'Notes you don’t share never leave this phone.'),
        h('li', {}, 'Everything on our server is shredded tonight.'),
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

const DEFAULT_PLACEHOLDER = 'Write freely. Notes stay on this phone until you choose to share them.';

function submitScreen() {
  let notes = local.get('notes', []);
  let step = 'write';
  let picked = new Set();
  let view = null;
  const saveNotes = () => local.set('notes', notes);
  const remaining = () => (view ? view.submit.max - view.submit.submitted : 3);

  // The writing area is built once and never replaced, so the iPhone keyboard
  // stays attached to the same textarea while notes are added.
  const input = h('textarea', { rows: 4, maxLength: HARD_MAX, placeholder: DEFAULT_PLACEHOLDER });
  input.value = local.get('draft', '');
  const counter = h('div', { class: 'counter' });
  const save = h('button', { class: 'grow' }, 'Save note');
  const writeArea = h('div', { class: 'stack' }, input, counter, h('div', { class: 'row' }, save));
  const doneText = h('p', { class: 'dim' });
  const toast = h('div', { class: 'toast', hidden: true });
  const listHead = h('p', { class: 'small faint' }, 'Private notes (only on this phone)');
  const list = h('div', { class: 'stack' });
  const pickButton = h('button', { class: 'primary' });
  const writeStep = h('div', { class: 'stack' }, toast, writeArea, doneText, listHead, list, pickButton);
  const pickStep = h('div', { class: 'stack' });
  const timer = h('div', { class: 'timer-banner', hidden: true });
  const el = h('div', { class: 'stack' }, h('h2', {}, PROMPT), timer, writeStep, pickStep);

  function refreshInput() {
    counter.textContent = `${input.value.length}/${SOFT_MAX}`;
    counter.classList.toggle('over', input.value.length > SOFT_MAX);
    save.disabled = input.value.trim().length === 0;
    local.set('draft', input.value);
    refreshPickButton();
  }

  // Only offer picking when there's something to pick (a saved note, or text
  // in the box, which picking saves first).
  function refreshPickButton() {
    const left = remaining();
    pickButton.hidden = left <= 0 || (notes.length === 0 && !input.value.trim());
    pickButton.textContent = `Pick up to ${left} to share →`;
  }
  input.addEventListener('input', refreshInput);

  // Keeps whatever is in the box as a note. Returns true if it saved one.
  function saveDraft() {
    const text = input.value.trim();
    if (!text) return false;
    notes.push({ id: newId(), text });
    saveNotes();
    input.value = '';
    refreshInput();
    return true;
  }

  save.addEventListener('click', () => {
    if (saveDraft()) renderList();
    input.focus();
  });

  pickButton.addEventListener('click', () => {
    // Anything still in the box counts as a note: nothing typed is lost.
    saveDraft();
    toast.hidden = true;
    if (!notes.length) return;
    step = 'pick';
    render();
  });

  function renderList() {
    const left = remaining();
    if (left <= 0 && (notes.length || input.value)) {
      // All 3 shared: the notes left over are discarded now, as promised.
      notes = [];
      saveNotes();
      input.value = '';
      refreshInput();
      toast.hidden = true;
    }
    writeArea.hidden = left <= 0;
    doneText.hidden = left > 0;
    doneText.textContent = `You've shared ${view?.submit.max ?? 3} cards. Thank you. Your other notes are discarded. Look up when Erik moves on.`;
    listHead.hidden = notes.length === 0;
    fill(
      list,
      notes.map((note) =>
        h(
          'div',
          { class: 'note' },
          h('div', { class: 'text' }, note.text),
          h('button', { class: 'quiet', onclick: () => editNote(note) }, 'Edit'),
          h('button', { class: 'quiet', onclick: () => deleteNote(note) }, '✕'),
        ),
      ),
    );
    refreshPickButton();
  }

  function editNote(note) {
    saveDraft(); // don't overwrite something half-written
    notes = notes.filter((n) => n !== note);
    picked.delete(note.id);
    saveNotes();
    input.value = note.text;
    refreshInput();
    step = 'write';
    render();
    input.focus();
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
        const stillLeft = remaining() - chosen.length;
        toast.textContent =
          stillLeft > 0
            ? `Shared. You can still share ${stillLeft} more while there's time, or look up when Erik moves on.`
            : 'Shared: that’s all 3. Look up when Erik moves on.';
        toast.hidden = false;
        render();
      } catch (err) {
        share.disabled = false;
        showError(pickStep, err);
      }
    });
    fill(
      pickStep,
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

  function render() {
    if (step === 'pick' && (remaining() <= 0 || !notes.length)) step = 'write';
    writeStep.hidden = step !== 'write';
    pickStep.hidden = step !== 'pick';
    if (step === 'pick') renderPick();
    else renderList();
  }

  // Two warnings, so there's time to finish a note and still pick.
  function tickTimer() {
    const left = view?.submit.endsAt ? view.submit.endsAt - serverNow() : Infinity;
    // No warning once all 3 are shared: there's nothing left to do.
    timer.hidden = left > 120_000 || remaining() <= 0;
    if (left > 60_000) timer.textContent = `About 2 minutes left. Leave time to pick what you share (${formatClock(left)}).`;
    else if (left > 0) timer.textContent = `About a minute left: pick what to share now (${formatClock(left)}).`;
    else timer.textContent = 'Time is up any moment: share what you want now.';
    timer.classList.toggle('urgent', left <= 60_000);
  }
  const interval = setInterval(tickTimer, 1000);

  // Nudges: rotating placeholder text. The server says which nudge to show:
  // all of them in turn (too few cards to tell yet), one (the least-covered
  // direction), or none (the mix is already varied, or nudges are off).
  let nudgeIndex = 0;
  function tickNudge() {
    const n = view?.submit;
    if (!n?.nudgesOn || !n.nudge) return (input.placeholder = DEFAULT_PLACEHOLDER);
    const texts = n.nudge.texts;
    input.placeholder = texts[nudgeIndex++ % texts.length];
  }
  const nudgeInterval = setInterval(tickNudge, 6000);

  refreshInput();
  let lastRemaining = null;
  return {
    el,
    update(v) {
      const firstUpdate = view === null;
      view = v;
      tickTimer();
      if (firstUpdate) tickNudge();
      if (remaining() !== lastRemaining) {
        lastRemaining = remaining();
        render();
      }
    },
    destroy() {
      clearInterval(interval);
      clearInterval(nudgeInterval);
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
    fill(el, lookUp('Look up', 'That was every card. Thank you. Waiting for everyone else to finish.').el);
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
    // Any emoji from the phone's keyboard: a clear button that opens a box
    // and explains how to get to the emoji keyboard.
    const chips = h('div', { class: 'row wrap' });
    const input = h('input', { type: 'text', placeholder: 'Type an emoji', maxLength: 16, 'aria-label': 'Add your own emoji', hidden: true });
    const emojiHint = h('div', { class: 'emoji-hint', hidden: true }, 'Emojis only: switch to the emoji keyboard.');
    const howTo = h('div', { class: 'small dim', hidden: true }, 'Switch your keyboard to emojis (the 😀 or 🌐 key), pick any, then tap Next.');
    const addOwn = h('button', { class: 'add-own' }, '＋ Add your own emoji');
    addOwn.addEventListener('click', () => {
      addOwn.hidden = true;
      input.hidden = false;
      howTo.hidden = false;
      input.focus();
    });
    input.addEventListener('input', () => {
      const e = firstEmoji(input.value);
      // Reactions are emojis only. Letters are cleared with a hint rather than
      // sitting in the box looking like they'll be sent.
      emojiHint.hidden = !!e || !input.value.trim();
      if (!e) {
        if (/[\p{L}\p{N}]/u.test(input.value)) setTimeout(() => (input.value = ''), 600);
        return;
      }
      input.value = '';
      const preset = PRESETS.findIndex((p) => p.e === e);
      if (preset >= 0) {
        if (!selected.has(e)) grid.children[preset].click();
        return;
      }
      if (custom.includes(e) || custom.length >= 4) return;
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
      h('div', { class: 'row wrap custom-row' }, addOwn, input, chips),
      howTo,
      emojiHint,
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
  // Last call is in person first: say it aloud. The anonymous pause is the
  // alternative, not the main ask.
  const head = h(
    'div',
    { class: 'lookup' },
    h('div', { class: 'big' }, last ? 'Last call' : 'Look up'),
    last && h('p', { class: 'lastcall-sub' }, 'Anything else to say? Out loud, or anonymously:'),
  );
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
