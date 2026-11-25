// The quiet "N people writing" count. Shared by the phones, which say they
// are typing, and the server, which counts them.

// A phone counts as "writing" this long after it last said it typed.
export const WRITING_WINDOW_MS = 8_000;
// A phone says it is typing at most this often, and never with any text.
export const TYPING_EVERY_MS = 3_000;

// The phone's throttle: called on every keystroke with the time, it says
// whether to tell the server. Only the first keystroke after a gap of
// TYPING_EVERY_MS is sent, and nothing is sent once typing stops, so the
// count runs from up to TYPING_EVERY_MS before the last keystroke.
export function typingThrottle() {
  let last = -Infinity;
  return (now) => {
    if (now - last < TYPING_EVERY_MS) return false;
    last = now;
    return true;
  };
}
