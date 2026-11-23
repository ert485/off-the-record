// The shred animation's timeline. Shared by the projector, which plays it,
// and the server, which moves everyone on to the closing screen once the
// animation and a moment of black are over.

// First a moment showing what's about to happen: a cursor clicks "Delete".
export const PRELUDE_MS = 3400;
export const FIRST_SHEET_MS = PRELUDE_MS + 400;
export const REST_MS = 700; // a sheet sits on the shredder this long before it's pulled
export const PULL_MS = 2600;
export const SHEET_GAP_MS = 500;
export const SETTLE_MS = 1800; // the last strips land, then the fade starts
export const FADE_MS = 2000;
export const BLANK_MS = 1500; // the beat of silence on black, then the closing fades in

// Cards go through in at most 6 sheets, so the shred fits its minute
// whatever the card count. Returns the cards grouped into sheets.
export function cardSheets(cards) {
  const target = Math.min(6, Math.ceil(cards.length / 3));
  const per = Math.ceil(cards.length / Math.max(1, target));
  const sheets = [];
  for (let i = 0; i < cards.length; i += per) sheets.push(cards.slice(i, i + per));
  return sheets;
}

// Each sheet's times, in ms from the start of the shred: when it appears on
// the shredder, and when and for how long it is pulled through.
export function sheetTimes(count) {
  return Array.from({ length: count }, (_, i) => {
    const at = FIRST_SHEET_MS + i * (PULL_MS + SHEET_GAP_MS);
    return { at, pullAt: at + REST_MS, pullMs: PULL_MS };
  });
}

// The sheets' times, when the fade starts and when the closing screen should
// appear, in ms from the start of the shred.
export function shredTimeline({ emojis, cards }) {
  const count = (emojis.length ? 1 : 0) + cardSheets(cards).length;
  const fadeAt = FIRST_SHEET_MS + count * (PULL_MS + SHEET_GAP_MS) + SETTLE_MS;
  return { sheets: sheetTimes(count), fadeAt, closingAt: fadeAt + FADE_MS + BLANK_MS };
}
