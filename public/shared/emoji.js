// Shared by the phones and the server.

// The 16 preset reactions. Any emoji from the phone keyboard is also allowed.
// Only the first two rows carry a label: those read the same for everyone.
// The rest (🔥 can mean many things) are left open on purpose.
export const PRESETS = [
  { e: '🙋', label: 'me too' },
  { e: '🫂', label: 'sending care' },
  { e: '😂', label: 'laughed' },
  { e: '🥲', label: 'bittersweet' },
  { e: '😢', label: 'sad' },
  { e: '😤', label: 'frustrated' },
  { e: '😰', label: 'anxious' },
  { e: '🎉', label: 'glad for you' },
  { e: '🔥' },
  { e: '🤯' },
  { e: '🫠' },
  { e: '😮‍💨' },
  { e: '💪' },
  { e: '❤️' },
  { e: '🙏' },
  { e: '👀' },
];

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// True when the string is exactly one emoji (including skin tones, ZWJ
// sequences and flags), so reactions can't carry words.
export function isSingleEmoji(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 32) return false;
  if ([...segmenter.segment(s)].length !== 1) return false;
  if (/[\p{L}\p{N}]/u.test(s.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')) && !/⃣/u.test(s)) return false;
  return /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|⃣/u.test(s);
}

// The first emoji in a string of keyboard input, or null.
export function firstEmoji(s) {
  for (const { segment } of segmenter.segment(s ?? '')) {
    if (isSingleEmoji(segment)) return segment;
  }
  return null;
}
