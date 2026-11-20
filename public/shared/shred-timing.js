// The shred animation's timeline. Shared by the projector, which plays it,
// and the server, which moves everyone on to the closing screen once the
// animation and a moment of black are over.

// First a moment showing what's about to happen: a cursor clicks "Delete".
export const PRELUDE_MS = 3400;
export const FIRST_SHEET_MS = PRELUDE_MS + 400;
export const PULL_MS = 2600;
export const SHEET_GAP_MS = 500;
export const SETTLE_MS = 3500; // the last strips land, then the fade starts
export const FADE_MS = 2000;
export const BLANK_MS = 3000; // the beat of silence on black, then the closing fades in

// Cards go through in at most 6 sheets, so the shred fits its minute
// whatever the card count. Returns the cards grouped into sheets.
export function cardSheets(cards) {
  const target = Math.min(6, Math.ceil(cards.length / 3));
  const per = Math.ceil(cards.length / Math.max(1, target));
  const sheets = [];
  for (let i = 0; i < cards.length; i += per) sheets.push(cards.slice(i, i + per));
  return sheets;
}

// When the fade starts and when the closing screen should appear, in ms from
// the start of the shred.
export function shredTimeline({ emojis, cards }) {
  const sheets = (emojis.length ? 1 : 0) + cardSheets(cards).length;
  const fadeAt = FIRST_SHEET_MS + sheets * (PULL_MS + SHEET_GAP_MS) + SETTLE_MS;
  return { fadeAt, closingAt: fadeAt + FADE_MS + BLANK_MS };
}
