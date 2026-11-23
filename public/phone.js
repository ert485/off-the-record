// The participant's phone. Private notes live only in this tab's
// sessionStorage: they never leave the phone. They're wiped when the shred
// reaches the phone or the tab closes. A phone that was offline at the shred
// wipes them as soon as it reconnects to a later session; the phone also says
// that closing the tab is the sure way.
import { subscribe, fill, post, h, formatClock, serverNow, seededShuffle } from './shared/client.js';
import { PRESETS, firstEmoji } from './shared/emoji.js';
import { loadChecker, HINT } from './shared/identifier-check.js';

const PROMPT = 'Write down something you experienced, felt, or were surprised by in 2026.';
const SOFT_MAX = 140;
const HARD_MAX = 200;
// Every keyboard puts its emojis somewhere slightly different.
const MAX_OWN = 6; // own-emoji chips shown on a card

const EMOJI_KEYBOARD_HOWTO =
  'Open your keyboard’s emojis: usually a smiley key (😀 or ☺) by the space bar or above the keys. Then tap Next.';

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
let screenSession = null;

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
    // Notes from a session this phone missed the end of (offline at the
    // shred) are wiped as soon as it sees a different session.
    const notesFrom = local.get('session', null);
    if (notesFrom && view.session && notesFrom !== view.session) local.clear();
    if (view.session) local.set('session', view.session);
    if (view.phase !== screenPhase || view.session !== screenSession) {
      screenSession = view.session;
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
  demo: () => lookUp('Starting soon', 'Look up: the facilitator is showing how this works.'),
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
  finale: () => lookUp(),
  shred: () => {
    local.clear();
    return { el: h('div', { class: 'black' }, 'Shredded. You can close this tab.') };
  },
  closing: () => {
    local.clear();
    return { el: h('div', { class: 'black' }, 'Thank you. You can close this tab.') };
  },
};

// ---- submissions: private notes, then pick up to 3 --------------------------

const DEFAULT_PLACEHOLDER = 'Write freely. Notes stay on this phone until you choose to share them.';

function submitScreen() {
  let notes = local.get('notes', []);
  // What this phone already shared, so its owner can still see it. Kept and
  // wiped exactly like the private notes.
  let sent = local.get('sent', []);
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
  const sentHead = h('p', { class: 'small faint' }, 'Already shared');
  const sentList = h('div', { class: 'stack' });
  const list = h('div', { class: 'stack' });
  const pickButton = h('button', { class: 'primary' });
  const writeStep = h('div', { class: 'stack' }, toast, writeArea, doneText, sentHead, sentList, listHead, list, pickButton);
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
    // All 3 shared: the writing box closes (anything half-typed joins the
    // list), and the notes left over stay on the phone, read-only, until the
    // shred or the tab closes, like every other private note.
    if (left <= 0) {
      saveDraft();
      toast.hidden = true;
    }
    writeArea.hidden = left <= 0;
    doneText.hidden = left > 0;
    doneText.textContent = `You've shared ${view?.submit.max ?? 3} cards. Thank you. Look up when the facilitator moves on.`;
    listHead.hidden = notes.length === 0;
    listHead.textContent = left > 0 ? 'Private notes (only on this phone)' : 'Not shared. Only on this phone; wiped at the shred. To be sure, close this tab.';
    sentHead.hidden = sent.length === 0;
    fill(sentList, sent.map((text) => h('div', { class: 'note sent' }, h('span', { class: 'tick' }, '✓'), h('div', { class: 'text' }, text))));
    fill(
      list,
      notes.map((note) =>
        h(
          'div',
          { class: 'note' },
          h('div', { class: 'text' }, note.text),
          left > 0 && h('button', { class: 'quiet', onclick: () => editNote(note) }, 'Edit'),
          left > 0 && h('button', { class: 'quiet', onclick: () => deleteNote(note) }, '✕'),
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
        sent = [...sent, ...chosen.map((n) => n.text)];
        local.set('sent', sent);
        notes = notes.filter((n) => !picked.has(n.id));
        picked.clear();
        saveNotes();
        step = 'write';
        const stillLeft = remaining() - chosen.length;
        toast.textContent =
          stillLeft > 0
            ? `Shared. You can still share ${stillLeft} more while there's time, or look up when the facilitator moves on.`
            : 'Shared: that’s all 3. Look up when the facilitator moves on.';
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
  const timer = h('div', { class: 'timer-banner', hidden: true });
  const body = h('div', { class: 'stack' });
  const el = h('div', { class: 'stack' }, timer, body);
  let groups = [];
  let endsAt = null;
  // The card on screen, so a phase change can send what's unsent on it.
  let current = null;
  // What this phone reacted to each card with, and the receipt that lets it
  // change those reactions. Kept and wiped like the private notes.
  const mine = local.get('reactions', {});
  // Comment drafts per card, kept like the private notes.
  const drafts = local.get('commentDrafts', {});
  let index = null; // position in this phone's shuffled order
  let shownId = null;
  let finished = false;
  let sentDone = false;

  // Two warnings, like the submission ones. Nothing locks at zero.
  function tickTimer() {
    const left = endsAt ? endsAt - serverNow() : Infinity;
    timer.hidden = finished || left > 60_000 || left <= 0;
    if (left > 15_000) timer.textContent = `Finish the card you're on (${formatClock(left)}).`;
    else timer.textContent = `15 seconds: send this card (${formatClock(left)}).`;
    timer.classList.toggle('urgent', left <= 15_000);
  }
  const timerInterval = setInterval(tickTimer, 1000);

  function order() {
    const ids = groups.map((g) => g.id).sort((a, b) => a - b);
    return seededShuffle(ids, `${cid}:react`).items;
  }

  function textFor(group) {
    // Each phone sees one wording from a group of near-duplicates.
    const { rand } = seededShuffle([], `${cid}:${group.id}`);
    return group.texts[Math.floor(rand() * group.texts.length)];
  }

  function finish() {
    finished = true;
    shownId = null;
    current = null;
    tickTimer();
    fill(
      body,
      lookUp('Look up', 'That was every card. Thank you. Waiting for everyone else to finish.').el,
      h('button', { class: 'quiet', onclick: () => ((finished = false), (index = order().length - 1), show()) }, '◀ Back to the last card'),
    );
    if (!sentDone) {
      sentDone = true;
      post('reactDone', { cid }).catch(() => (sentDone = false));
    }
  }

  function show() {
    const ids = order();
    if (!ids.length) return finish();
    // Start at the first card this phone hasn't reacted to.
    if (index === null) index = ids.findIndex((id) => !mine[id]);
    if (index < 0 || index >= ids.length) return finish();
    const id = ids[index];
    if (shownId === id) return;
    shownId = id;
    current = null;
    const group = groups.find((g) => g.id === id);
    const before = mine[id];
    const selected = new Set(before?.emojis ?? []);
    // Your own emojis: this card's, then ones you've used on other cards,
    // offered as one-tap chips so you don't have to find them again.
    const isPreset = (e) => PRESETS.some((p) => p.e === e);
    const recent = local.get('recentEmojis', []);
    const custom = [...new Set([...[...selected].filter((e) => !isPreset(e)), ...recent])].slice(0, MAX_OWN);

    const grid = h(
      'div',
      { class: 'emoji-grid' },
      PRESETS.map(({ e, label }) => {
        const b = h('button', { class: selected.has(e) ? 'on' : '', 'aria-pressed': String(selected.has(e)) }, h('span', { class: 'e' }, e), h('span', { class: 'l' }, label));
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
    const addChip = (e, first = false) => {
      const chip = h('button', { class: `chip${selected.has(e) ? ' on' : ''}` }, e);
      chip.addEventListener('click', () => {
        if (selected.has(e)) selected.delete(e);
        else selected.add(e);
        chip.classList.toggle('on', selected.has(e));
      });
      if (first) chips.prepend(chip);
      else chips.append(chip);
    };
    custom.forEach((e) => addChip(e));
    const input = h('input', { type: 'text', placeholder: 'Type an emoji', maxLength: 16, 'aria-label': 'Add your own emoji', hidden: true });
    const emojiHint = h('div', { class: 'emoji-hint', hidden: true }, 'Emojis only: switch to the emoji keyboard.');
    const howTo = h('div', { class: 'small dim', hidden: true }, EMOJI_KEYBOARD_HOWTO);
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
      if (custom.includes(e)) {
        // Already a chip: just select it.
        if (!selected.has(e)) chips.children[custom.indexOf(e)].click();
        return;
      }
      if (custom.length >= MAX_OWN) {
        // Full: the new one replaces the oldest chip that isn't picked on
        // this card (or the oldest one, if all are picked).
        let i = custom.length - 1;
        while (i > 0 && selected.has(custom[i])) i -= 1;
        if (selected.has(custom[i])) i = custom.length - 1;
        selected.delete(custom[i]);
        custom.splice(i, 1);
        chips.children[i].remove();
      }
      custom.unshift(e);
      selected.add(e);
      addChip(e, true);
    });

    const comment = h('textarea', { rows: 2, maxLength: HARD_MAX, placeholder: 'Add a comment (optional)', 'aria-label': 'Add a comment' });
    comment.value = drafts[id] ?? before?.comment ?? '';
    const commentHint = h('div');
    const refreshComment = () => {
      drafts[id] = comment.value;
      local.set('commentDrafts', drafts);
      fill(commentHint, identifierHint(comment.value) ?? '');
    };
    comment.addEventListener('input', refreshComment);
    refreshComment();

    // Sends the emojis and comment together, with the receipt when this card
    // was sent before. A first send with neither is not sent at all.
    let sending = false;
    const dirty = () => {
      const emojis = [...selected];
      const text = comment.value.trim();
      if (!before) return emojis.length > 0 || text !== '';
      const sameEmojis = emojis.length === before.emojis.length && emojis.every((e) => before.emojis.includes(e));
      return !sameEmojis || text !== (before.comment ?? '');
    };
    async function send() {
      const emojis = [...selected];
      const text = comment.value.trim();
      sending = true;
      try {
        const { receipt } = await post('react', { cid, groupId: id, emojis, receipt: before?.receipt, comment: text });
        mine[id] = { emojis, comment: text, receipt: receipt ?? before?.receipt };
        local.set('reactions', mine);
        // Remember your own emojis for later cards, most recent first.
        const own = custom.filter((e) => selected.has(e)); // newest first, as shown
        if (own.length) local.set('recentEmojis', [...new Set([...own, ...local.get('recentEmojis', [])])].slice(0, MAX_OWN));
      } finally {
        sending = false;
      }
    }

    // Sends this card if it has anything unsent, then moves by `step` cards.
    async function save(step) {
      if (dirty()) {
        try {
          await send();
        } catch (err) {
          if (!/every card|No such card/.test(err.message)) {
            // Stay on this card, with both buttons working again, so a
            // dropped connection never leaves the phone stuck here.
            next.disabled = false;
            back.disabled = index === 0;
            return showError(body, err);
          }
        }
      }
      index += step;
      show();
    }
    // The phase left reactions: send what's unsent on this card, once. The
    // draft stays in storage if it fails, so nothing is lost from the phone.
    current = {
      flush() {
        if (sending || !dirty()) return;
        send().catch(() => {});
      },
    };

    const next = h('button', { class: 'primary grow' }, 'Next');
    next.addEventListener('click', () => ((next.disabled = true), save(1)));
    const back = h('button', { disabled: index === 0 }, '◀ Previous');
    back.addEventListener('click', () => ((back.disabled = true), save(-1)));

    fill(
      body,
      h('div', { class: 'small faint' }, `Card ${index + 1} of ${ids.length}`, (before?.emojis.length || before?.comment) ? ' · you reacted to this one' : ''),
      h('div', { class: 'react-card' }, textFor(group)),
      grid,
      h('div', { class: 'row wrap custom-row' }, addOwn, input, chips),
      howTo,
      emojiHint,
      comment,
      commentHint,
      h('div', { class: 'row' }, back, next),
    );
  }

  return {
    el,
    update(v) {
      groups = v.react.groups;
      endsAt = v.react.endsAt;
      tickTimer();
      if (finished) return;
      if (v.react.done && index === null) return finish();
      // Keep the place by card, not by position: a hidden card leaves the
      // stack, even mid-way, and the cards after it move up.
      if (shownId !== null) {
        const i = order().indexOf(shownId);
        if (i >= 0) index = i;
        else shownId = index = null;
      }
      show();
    },
    destroy() {
      clearInterval(timerInterval);
      current?.flush();
    },
  };
}

// ---- walk-through: look up, with two light taps -------------------------------

function walkScreen() {
  const el = h('div', { class: 'stack', style: { flex: '1' } });
  const signals = h('div', { class: 'signals' });
  el.append(h('div', { class: 'lookup' }, h('div', { class: 'big' }, 'Look up')), signals);

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
  signals.append(signal('stay', 'Stay', 'on this card'), signal('back', 'Go back', 'a card'));

  return {
    el,
    update(v) {
      for (const [kind, b] of Object.entries(toggles)) b.classList.toggle('on', !!v.walk.mine[kind]);
    },
  };
}
