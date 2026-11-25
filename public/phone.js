// The participant's phone. Private notes live only in this tab's
// sessionStorage: they never leave the phone. They're wiped when the shred
// reaches the phone or the tab closes. A phone that was offline at the shred
// wipes them as soon as it reconnects to a later session; the phone also says
// that closing the tab is the sure way.
import { subscribe, fill, post, h, formatClock, serverNow, seededShuffle, deck, deckEnd } from './shared/client.js';
import { PRESETS, firstEmoji } from './shared/emoji.js';
import { loadChecker, HINT } from './shared/identifier-check.js';
import { struckParts } from './shared/struck.js';
import { typingThrottle } from './shared/writing.js';

const PROMPT = 'Write down something you experienced, felt, or were surprised by in 2026.';
const SOFT_MAX = 140;
const HARD_MAX = 200;
const AFTERTHOUGHT_MAX = 200; // the server's cap on the one thought at the end of the deck
// Every keyboard puts its emojis somewhere slightly different.
const MAX_EMOJIS = 22; // the server's cap per card: 16 presets + 6 of your own
const MAX_OWN = 6; // own-emoji chips shown on a card

const EMOJI_KEYBOARD_HOWTO =
  'Open your keyboard’s emojis: tap its smiley key (😀 on iPhone, ☺ on Android), by the space bar or below the keys. Then tap Next.';

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

// The seed for this phone's deck: random, made and kept on the phone, never
// sent, and wiped with the notes, so the server can't work out which cards a
// phone's deck holds. Kept in memory only if storage doesn't work.
let deckSeedMemo = null;
function deckSeed() {
  let seed = local.get('deckSeed', null);
  if (!seed) {
    local.set('deckSeed', newId());
    seed = local.get('deckSeed', null) ?? (deckSeedMemo ??= newId());
  }
  return seed;
}

let check = () => [];
loadChecker().then((c) => (check = c));

const app = document.getElementById('app');
const flash = document.getElementById('flash');
const status = document.getElementById('status');
let screen = null;
let screenKeyNow = null;
let screenSession = null;

// Join and Submit are one screen, the notepad: the room moving from one to the
// other updates it in place (no rebuild, no buzz, no flash), so someone
// mid-sentence keeps their text, their focus and their keyboard.
const screenKey = (phase) => (phase === 'join' || phase === 'submit' ? 'write' : phase);

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
    const key = screenKey(view.phase);
    if (key !== screenKeyNow || view.session !== screenSession) {
      screenSession = view.session;
      if (screenKeyNow !== null) buzz();
      screen?.destroy?.();
      screenKeyNow = key;
      screen = SCREENS[key](view);
      fill(app, screen.el);
    }
    screen.update?.(view);
  },
  (online) => status.classList.toggle('offline', !online),
);

// Tells the server this phone is typing, so the room can see people are
// writing. At most once every few seconds (shared/writing.js), and never with
// any text. Fire and forget: a dropped one only means a slightly lower count.
const typingDue = typingThrottle();
function sayTyping() {
  if (typingDue(Date.now())) post('typing', { cid }).catch(() => {});
}

// Tells the server, only when it changes, whether this phone holds a thought it
// has typed but not sent (so the facilitator can wait for it). No text.
let unsentSaid = false;
function sayUnsent(on) {
  if (on === unsentSaid) return;
  unsentSaid = on;
  post('unsent', { cid, on }).catch(() => (unsentSaid = !on));
}

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
  teaser: (view) => ({
    el: h(
      'div',
      { class: 'teaser' },
      h('h1', {}, view.teaser.title),
      // ~~words~~ in a line show struck through, still readable.
      view.teaser.lines.map((line) => h('p', {}, struckParts(line).map((p) => (p.struck ? h('s', { class: 'struck' }, p.text) : p.text)))),
    ),
  }),
  demo: () => lookUp('Starting soon', 'Look up: the facilitator is showing how this works.'),
  // Join and Submit (see screenKey).
  write: submitScreen,
  cluster: clusterScreen,
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

// What this phone already shared, so its owner can still see it: { text,
// receipt }, the receipt being what takes that card back while sharing is
// open. Kept and wiped exactly like the private notes. Entries saved before
// cards could be taken back are plain text, with no receipt: they stay listed,
// with no way to take them back.
const sentCards = () => local.get('sent', []).map((s) => (typeof s === 'string' ? { text: s, receipt: null } : s));
const sentList = (cards, takeBack) =>
  cards.map((card) =>
    h(
      'div',
      { class: 'note sent' },
      h('span', { class: 'tick' }, '✓'),
      h('div', { class: 'text' }, card.text),
      takeBack && card.receipt && h('button', { class: 'quiet', onclick: (e) => takeBack(card, e.currentTarget) }, 'Take back'),
    ),
  );

const takenBackCopy = (n) => (n === 1 ? "Taken back. It won't be shown. It's back in your notes." : "Taken back. They won't be shown. They're back in your notes.");

function submitScreen() {
  let notes = local.get('notes', []);
  let sent = sentCards();
  let step = 'write';
  let picked = new Set();
  // Shared cards unchecked in the pick step, by receipt: sharing takes them back.
  let unchecked = new Set();
  let view = null;
  const saveNotes = () => local.set('notes', notes);
  const remaining = () => (view ? view.submit.max - view.submit.submitted : 3);
  // Shared cards that can still be taken back (a receipt; not an old entry).
  const takeable = () => sent.filter((c) => c.receipt);

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
  const sentBox = h('div', { class: 'stack' });
  const list = h('div', { class: 'stack' });
  const pickButton = h('button', { class: 'primary' });
  const writeStep = h('div', { class: 'stack' }, toast, writeArea, doneText, sentHead, sentBox, listHead, list, pickButton);
  const pickStep = h('div', { class: 'stack' });
  const timer = h('div', { class: 'timer-banner', hidden: true });
  // One compact line above the prompt, kept through Submit so nothing moves
  // under someone's thumb when the room moves on. Browsers block vibration
  // until the person has touched the page: the first tap in the notepad is
  // that touch, so Android can vibrate on later phase changes.
  const promises = h('p', { class: 'small faint' }, "Anonymous. Notes you don't share never leave this phone. Everything on our server is shredded tonight.");
  const el = h('div', { class: 'stack' }, promises, h('h2', {}, PROMPT), timer, writeStep, pickStep);

  function refreshInput() {
    counter.textContent = `${input.value.length}/${SOFT_MAX}`;
    counter.classList.toggle('over', input.value.length > SOFT_MAX);
    save.disabled = input.value.trim().length === 0;
    local.set('draft', input.value);
    refreshPickButton();
  }

  // Only offer picking when there's something to pick (a saved note, or text
  // in the box, which picking saves first). With all 3 shared, picking is a
  // swap: a shared card is unchecked for a note.
  function refreshPickButton() {
    const left = remaining();
    pickButton.hidden = (left <= 0 && !takeable().length) || (notes.length === 0 && !input.value.trim());
    pickButton.textContent = left > 0 ? `Pick up to ${left} to share →` : 'Swap a shared card for a note →';
  }
  input.addEventListener('input', refreshInput);
  input.addEventListener('input', () => input.value && sayTyping());

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
    fill(sentBox, sentList(sent, takeBack));
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

  // Shares `chosen` notes and takes back `back` shared cards in one call. On
  // success, what was taken back is put back at the top of the notes, so
  // nothing written is lost. Only the lists are redrawn: the writing box and
  // what's in it are never touched.
  async function exchange(chosen, back) {
    const before = view?.submit.submitted;
    const { receipts } = await post('submit', { cid, texts: chosen.map((n) => n.text), withdraw: back.map((c) => c.receipt) });
    // The server's count follows by its next update; until then, count here.
    if (view && view.submit.submitted === before) view.submit.submitted += chosen.length - back.length;
    const gone = new Set(back.map((c) => c.receipt));
    sent = [...sent.filter((c) => !gone.has(c.receipt)), ...chosen.map((n, i) => ({ text: n.text, receipt: receipts[i] }))];
    local.set('sent', sent);
    const ids = new Set(chosen.map((n) => n.id));
    notes = [...back.map((c) => ({ id: newId(), text: c.text })), ...notes.filter((n) => !ids.has(n.id))];
    saveNotes();
    picked.clear();
    unchecked.clear();
    step = 'write';
    const left = remaining();
    const parts = [];
    if (back.length) parts.push(takenBackCopy(back.length));
    if (chosen.length) {
      parts.push(
        left > 0
          ? `Shared. You can still share ${left} more while there's time, or look up when the facilitator moves on.`
          : // A swap at 3: "You've shared 3 cards" below already says the rest.
            back.length
            ? 'Shared.'
            : 'Shared: that’s all 3. Look up when the facilitator moves on.',
      );
    }
    toast.textContent = parts.join(' ');
    lastRemaining = left;
    render();
    // With all 3 shared, "You've shared 3 cards" says it, unless a card was
    // just taken back (a swap): say that.
    toast.hidden = left <= 0 && !back.length;
  }

  async function takeBack(card, button) {
    button.disabled = true;
    try {
      await exchange([], [card]);
    } catch (err) {
      button.disabled = false;
      showError(writeStep, err);
    }
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
    const max = view?.submit.max ?? 3;
    picked = new Set([...picked].filter((id) => notes.some((n) => n.id === id)));
    unchecked = new Set([...unchecked].filter((r) => sent.some((c) => c.receipt === r)));
    // Checked in all: the shared cards still checked, and the notes picked.
    const checked = (view?.submit.submitted ?? sent.length) - unchecked.size + picked.size;
    const full = checked >= max;
    const shares = picked.size;
    const takes = unchecked.size;
    const label =
      shares && takes ? `Share ${shares}, take back ${takes}` : takes ? `Take back ${takes}` : shares > 1 ? `Share ${shares} cards` : 'Share 1 card';
    const share = h('button', { class: 'primary', disabled: shares + takes === 0 }, label);
    share.addEventListener('click', async () => {
      share.disabled = true;
      try {
        await exchange(
          notes.filter((n) => picked.has(n.id)),
          sent.filter((c) => unchecked.has(c.receipt)),
        );
      } catch (err) {
        share.disabled = false;
        showError(pickStep, err);
      }
    });
    const shared = sent.map((card) => {
      const on = !unchecked.has(card.receipt);
      return h(
        'button',
        {
          class: `note pickable${on ? ' picked' : ''}`,
          // An entry with no receipt can't be taken back.
          disabled: !card.receipt || (!on && full),
          'aria-pressed': String(on),
          onclick: () => {
            if (on) unchecked.add(card.receipt);
            else if (!full) unchecked.delete(card.receipt);
            render();
          },
        },
        h('span', { class: 'check' }),
        h('span', { class: 'text' }, card.text),
        h('span', { class: 'tag small faint' }, 'Shared'),
      );
    });
    // At 3, a note can only come in for a shared card unchecked.
    const swapHint = full && takeable().some((c) => !unchecked.has(c.receipt)) && notes.some((n) => !picked.has(n.id));
    fill(
      pickStep,
      h(
        'p',
        {},
        takeable().length
          ? `Up to ${max} in all. Uncheck a shared card to take it back; notes you don't pick stay here and are discarded.`
          : `Pick up to ${remaining()} to share as cards. The rest stay here and are discarded.`,
      ),
      shared,
      swapHint && h('p', { class: 'hint' }, 'Uncheck a shared card to swap it for this one.'),
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
              disabled: !on && full,
              'aria-pressed': String(on),
              onclick: () => {
                if (on) picked.delete(note.id);
                else if (!full) picked.add(note.id);
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
    if (step === 'pick' && (!notes.length || (remaining() <= 0 && !takeable().length))) step = 'write';
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

  let lastRemaining = null;
  refreshInput();
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

// ---- grouping: look up; what was shared stays as it is -----------------------

function clusterScreen() {
  const sent = sentCards();
  const look = lookUp('Look up', 'Grouping the cards.');
  if (!sent.length) return look;
  return {
    el: h(
      'div',
      { class: 'stack', style: { flex: '1' } },
      look.el,
      h('p', { class: 'small faint' }, 'Grouping has started: shared cards stay as they are. The facilitator can still hide any card.'),
      sentList(sent, null),
    ),
  };
}

// ---- reactions: one card at a time, one pass ---------------------------------

function reactScreen() {
  // The server clears unsent flags on leaving reactions; a restored draft raises it again.
  unsentSaid = false;
  const timer = h('div', { class: 'timer-banner', hidden: true });
  const body = h('div', { class: 'stack' });
  const el = h('div', { class: 'stack' }, timer, body);
  let groups = [];
  let endsAt = null;
  let deckSize = null;
  // The card on screen, so a phase change can send what's unsent on it.
  let current = null;
  // What this phone reacted to each card with, and the receipt that lets it
  // change those reactions. Kept and wiped like the private notes.
  const mine = local.get('reactions', {});
  let index = null; // position in this phone's shuffled order
  let shownId = null;
  let finished = false;
  let sentDone = false;
  // The cards this phone has shown, so a card that joins the deck behind
  // where it is (unhidden, or come in late) is still reached. Kept on the
  // phone, never sent, and wiped like the notes.
  const seen = new Set(local.get('seenCards', []));
  const markSeen = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    local.set('seenCards', [...seen]);
  };
  // The "New cards came in" line at the end of the deck.
  let freshLine = null;
  let shownUnseen = null;
  // On a card reached by jumping to one not yet shown: Next goes on to the
  // next such card (or the end), not back through cards already seen.
  // "◀ Previous" goes back to stepping through the deck in order.
  let catchingUp = false;

  // Two warnings, like the submission ones, early enough to leave time for
  // the thought at the end. None once the thought is sent or skipped.
  // Nothing locks at zero.
  function tickTimer() {
    const left = endsAt ? endsAt - serverNow() : Infinity;
    timer.hidden = local.get('afterthoughtDone', false) || left > 120_000 || left <= 0;
    if (left > 60_000) timer.textContent = `About 2 minutes left: finish your cards, then add a thought if you like (${formatClock(left)}).`;
    else timer.textContent = `About a minute left: send your thought now (${formatClock(left)}).`;
    timer.classList.toggle('urgent', left <= 60_000);
  }
  const timerInterval = setInterval(tickTimer, 1000);

  // This phone's deck: deckSize cards of its own shuffle, from a seed the
  // server never sees, so it never learns which cards the phone saw. Cards
  // already reacted to stay in it; fewer cards than that: all of them.
  function order() {
    const reacted = new Set(Object.keys(mine).map(Number));
    return deck(groups.map((g) => g.id), deckSeed(), deckSize, reacted);
  }
  // The end of the deck: the first card in it not yet shown (a card reacted
  // to counts as shown), and whether "That was every card" is true.
  const deckState = () => deckEnd(order(), groups.length, new Set([...seen, ...Object.keys(mine).map(Number)]));
  const askCopy = (every) => (every ? 'That was every card. Any new thoughts after seeing them all?' : 'That was your deck. Any new thoughts after seeing it?');
  const waitCopy = (every) => `${every ? 'That was every card' : 'That was your deck'}. Thank you. Waiting for everyone else to finish.`;

  function textFor(group) {
    // Each phone sees one wording from a group of near-duplicates.
    const { rand } = seededShuffle([], `${cid}:${group.id}`);
    return group.texts[Math.floor(rand() * group.texts.length)];
  }

  // The end of the deck: one thought, if there's anything new after seeing
  // the deck, and a way back to add an emoji. The thought is sent only when
  // its button is tapped, never when the room moves on; an unsent draft stays
  // on the phone and is wiped like the notes.
  function finish() {
    finished = true;
    shownId = null;
    current = null;
    tickTimer();
    freshLine = h('div', { class: 'stack', hidden: true });
    shownUnseen = null;
    fill(
      body,
      freshLine,
      thoughtBox(),
      h('p', { class: 'small dim' }, 'While you wait: any keyboard emoji works, not just the 16. Tap “＋ Add your own emoji” on a card, then the smiley key (😀 or ☺).'),
      h('button', { class: 'quiet', onclick: () => ((finished = false), (index = order().length - 1), show()) }, '◀ Back to the last card'),
    );
    refreshEnd();
    if (!sentDone) {
      sentDone = true;
      post('reactDone', { cid }).catch(() => (sentDone = false));
    }
  }

  // New cards in the deck while the phone is at its end: say so, with a way
  // to them, but leave the phone where it is (someone may be typing a
  // thought; the draft is kept either way). The words follow what's true.
  function refreshEnd() {
    if (!finished) return;
    const { unseen, everyCard } = deckState();
    const ask = body.querySelector('[data-end="ask"]');
    if (ask) ask.textContent = askCopy(everyCard);
    const wait = body.querySelector('[data-end="wait"]');
    if (wait) wait.textContent = waitCopy(everyCard);
    // Only rebuild the button when the unseen card changes: SSE updates come
    // several times a second, and a button replaced between press and release
    // loses the tap.
    if (unseen === shownUnseen) return;
    shownUnseen = unseen;
    freshLine.hidden = unseen === null;
    fill(freshLine, unseen === null ? '' : [h('p', {}, 'New cards came in.'), h('button', { class: 'primary', onclick: seeNew }, 'See them ▶')]);
  }
  function seeNew() {
    const ids = order();
    const { unseen } = deckState();
    if (unseen === null) return refreshEnd();
    finished = false;
    shownId = null;
    index = ids.indexOf(unseen);
    catchingUp = true;
    show();
  }

  // The end-of-deck thought. Kept on the phone and wiped like the notes:
  // 'afterthought' is what was sent ({ text, receipt }), 'afterthoughtDraft'
  // what's typed and not sent, 'afterthoughtDone' that the box was closed
  // (sent, or "Nothing to add").
  function thoughtBox() {
    const box = h('div', { class: 'stack' });
    const render = () => fill(box, local.get('afterthoughtDone', false) ? done() : write());
    const close = () => {
      local.set('afterthoughtDraft', null);
      local.set('afterthoughtDone', true);
      sayUnsent(false);
      render();
      tickTimer();
    };
    function write() {
      const sent = local.get('afterthought', null);
      const had = !!sent?.text;
      const input = h('textarea', { rows: 3, maxLength: AFTERTHOUGHT_MAX, placeholder: 'Optional. For the last slide, with no name.', 'aria-label': 'Your thought' });
      input.value = local.get('afterthoughtDraft', null) ?? sent?.text ?? '';
      const counter = h('div', { class: 'counter' });
      const hint = h('div');
      const add = h('button', { class: 'primary grow' });
      const skip = h('button', { class: 'quiet', onclick: close }, had ? 'Keep it as it was' : 'Nothing to add');
      const refresh = () => {
        local.set('afterthoughtDraft', input.value);
        counter.textContent = `${input.value.length}/${AFTERTHOUGHT_MAX}`;
        fill(hint, identifierHint(input.value) ?? '');
        const text = input.value.trim();
        add.textContent = !had ? 'Add this thought' : text ? 'Change this thought' : 'Take back this thought';
        add.disabled = had ? text === sent.text : !text;
        // Typed and not sent: a restored draft counts too, once, on the first refresh.
        sayUnsent(!!text && text !== sent?.text);
      };
      input.addEventListener('input', refresh);
      input.addEventListener('input', () => input.value && sayTyping());
      add.addEventListener('click', async () => {
        const text = input.value.trim();
        add.disabled = true;
        try {
          const { receipt } = await post('afterthought', { cid, text, receipt: sent?.receipt });
          local.set('afterthought', { text, receipt: receipt ?? sent?.receipt });
          close();
        } catch (err) {
          add.disabled = false;
          showError(box, err);
        }
      });
      refresh();
      return [h('h2', { 'data-end': 'ask' }, askCopy(deckState().everyCard)), input, counter, hint, h('div', { class: 'row' }, add, skip)];
    }
    function done() {
      const text = local.get('afterthought', null)?.text;
      const reopen = () => (local.set('afterthoughtDone', false), render(), tickTimer());
      return [
        lookUp('Look up', text ? 'Thank you. Your thought is in, with no name. It’s for the last slide.' : h('span', { 'data-end': 'wait' }, waitCopy(deckState().everyCard))).el,
        text ? h('div', { class: 'note sent' }, h('span', { class: 'tick' }, '✓'), h('div', { class: 'text' }, text)) : '',
        h('button', { class: 'quiet', onclick: reopen }, text ? 'Change your thought' : 'Add a thought after all'),
      ];
    }
    render();
    return box;
  }

  function show() {
    const ids = order();
    if (!ids.length) return finish();
    // Start at the first card this phone hasn't reacted to.
    if (index === null) index = ids.findIndex((id) => !mine[id]);
    // Past the end: a card in the deck not yet shown comes first.
    if (index < 0 || index >= ids.length) {
      const { unseen } = deckState();
      if (unseen === null) return finish();
      index = ids.indexOf(unseen);
      catchingUp = true;
    }
    const id = ids[index];
    if (shownId === id) return;
    shownId = id;
    markSeen(id);
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
        const b = h('button', { class: selected.has(e) ? 'on' : '', 'aria-pressed': String(selected.has(e)) }, h('span', { class: 'e' }, e), label ? h('span', { class: 'l' }, label) : null);
        b.addEventListener('click', () => {
          if (selected.has(e)) selected.delete(e);
          else if (selected.size < MAX_EMOJIS) selected.add(e);
          b.classList.toggle('on', selected.has(e));
          b.setAttribute('aria-pressed', String(selected.has(e)));
          refreshLimit();
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
        else if (selected.size < MAX_EMOJIS) selected.add(e);
        chip.classList.toggle('on', selected.has(e));
        refreshLimit();
      });
      if (first) chips.prepend(chip);
      else chips.append(chip);
    };
    custom.forEach((e) => addChip(e));
    const input = h('input', { type: 'text', placeholder: 'Type an emoji', maxLength: 16, 'aria-label': 'Add your own emoji', hidden: true });
    const emojiHint = h('div', { class: 'emoji-hint', hidden: true }, 'Emojis only: switch to the emoji keyboard.');
    const howTo = h('div', { class: 'small dim', hidden: true }, EMOJI_KEYBOARD_HOWTO);
    const addOwn = h('button', { class: 'add-own' }, '＋ Add your own emoji');
    const limitHint = h('div', { class: 'emoji-hint', hidden: true }, `Up to ${MAX_EMOJIS} on a card. Tap one to remove it, then add another.`);
    // At the cap, whatever isn't picked can't be picked; unpicking re-enables.
    function refreshLimit() {
      const full = selected.size >= MAX_EMOJIS;
      for (const b of [...grid.children, ...chips.children]) b.disabled = full && !b.classList.contains('on');
      addOwn.disabled = full;
      input.disabled = full;
      limitHint.hidden = !full;
    }
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
      if (selected.size >= MAX_EMOJIS && !selected.has(e)) return;
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
      refreshLimit();
    });

    // Sends the emojis, with the receipt when this card was sent before. A
    // first send with none is not sent at all.
    let sending = false;
    const dirty = () => {
      const emojis = [...selected];
      if (!before) return emojis.length > 0;
      return emojis.length !== before.emojis.length || !emojis.every((e) => before.emojis.includes(e));
    };
    async function send() {
      const emojis = [...selected];
      sending = true;
      try {
        const { receipt } = await post('react', { cid, groupId: id, emojis, receipt: before?.receipt });
        mine[id] = { emojis, receipt: receipt ?? before?.receipt };
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
      if (step < 0) catchingUp = false;
      // Past the end, show() goes to the next card not yet shown, or finishes.
      index = step > 0 && catchingUp ? Infinity : index + step;
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
      h('div', { class: 'small faint' }, `Card ${index + 1} of ${ids.length}`, before?.emojis.length ? ' · you reacted to this one' : ''),
      h('div', { class: 'react-card' }, textFor(group)),
      grid,
      h('div', { class: 'row wrap custom-row' }, addOwn, input, chips),
      howTo,
      emojiHint,
      limitHint,
      h('div', { class: 'row' }, back, next),
    );
    refreshLimit();
  }

  return {
    el,
    update(v) {
      groups = v.react.groups;
      endsAt = v.react.endsAt;
      deckSize = v.react.deckSize;
      tickTimer();
      if (finished) return refreshEnd();
      // Finished before (a reload): back to the end, unless the deck has a card not yet shown.
      if (v.react.done && index === null) {
        const { unseen } = deckState();
        if (unseen === null) return finish();
        index = order().indexOf(unseen);
        catchingUp = true;
      }
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

// ---- walk-through: look up -------------------------------

function walkScreen() {
  const el = h('div', { class: 'stack', style: { flex: '1' } });
  el.append(h('div', { class: 'lookup' }, h('div', { class: 'big' }, 'Look up')));
  return { el, update() {} };
}
