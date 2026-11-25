// The shred animation's timeline. Shared by the projector, which plays it,
// and the server, which moves everyone on to the closing screen once the
// animation and a moment of black are over.

// With a full room it takes about 18 seconds: the prelude about 2.5, the
// sheets 11 (however many cards), then 4.5 to settle, fade and sit on black.
// Fewer cards, fewer sheets, shorter.

// First a moment showing what's about to happen: a cursor clicks "Delete".
export const PRELUDE_MS = 2400;
export const FIRST_SHEET_MS = PRELUDE_MS + 100;
export const SHEETS_MS = 11_000; // all the sheets, at most
export const SHEET_MS = 2600; // each sheet's share when there are only a few
export const EASE = 0.3; // how much slower the first and last sheets go than the middle ones
export const SETTLE_MS = 1100; // the last strips land, then the fade starts
export const FADE_MS = 1800;
export const BLANK_MS = 1600; // the beat of silence on black, then the closing fades in (the old year is ash)

// Cards go through in at most 6 sheets, so the shred takes about the same
// time whatever the card count. Returns the cards grouped into sheets.
export function cardSheets(cards) {
  const target = Math.min(6, Math.ceil(cards.length / 3));
  const per = Math.ceil(cards.length / Math.max(1, target));
  const sheets = [];
  for (let i = 0; i < cards.length; i += per) sheets.push(cards.slice(i, i + per));
  return sheets;
}

// Each sheet's times, in ms from the start of the shred: when it appears on
// the shredder, and when and for how long it is pulled through. Each sheet
// gets a slot (a fifth resting on the shredder, three quarters being pulled,
// then a moment empty); the slots are longest at the start and the end and
// shortest in the middle (a cosine over the sequence), so it stays calm.
export function sheetTimes(count) {
  const total = Math.min(SHEETS_MS, count * SHEET_MS);
  const times = [];
  let at = FIRST_SHEET_MS;
  for (let i = 0; i < count; i++) {
    const slot = (total / count) * (count > 1 ? 1 + EASE * Math.cos((2 * Math.PI * (i + 0.5)) / count) : 1);
    times.push({ at, pullAt: at + slot * 0.2, pullMs: slot * 0.75 });
    at += slot;
  }
  return times;
}

// The sheets' times, when the fade starts and when the closing screen should
// appear, in ms from the start of the shred.
export function shredTimeline({ emojis, cards }) {
  const sheets = sheetTimes((emojis.length ? 1 : 0) + cardSheets(cards).length);
  const last = sheets.at(-1);
  const fadeAt = (last ? last.pullAt + last.pullMs : FIRST_SHEET_MS) + SETTLE_MS;
  return { sheets, fadeAt, closingAt: fadeAt + FADE_MS + BLANK_MS };
}
