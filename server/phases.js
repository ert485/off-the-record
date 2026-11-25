// The session's phases, in order. The facilitator moves forward and back;
// every phone follows. See "Session flow" in the spec.
export const PHASES = ['teaser', 'demo', 'join', 'submit', 'cluster', 'react', 'walk', 'finale', 'shred', 'closing'];

// Planned talk-clock minutes for each phase: [start, end]. From the spec's
// 25-minute talk plan. The teaser has no entry: it is before the talk. Drives the facilitator-only pace marker.
export const PLAN = {
  demo: [1.5, 3.5],
  join: [3.5, 5],
  submit: [5, 10],
  cluster: [10, 10.5],
  react: [10.5, 15.5],
  walk: [15.5, 21.5],
  finale: [21.5, 22.5],
  shred: [22.5, 23.5],
  closing: [23.5, 24.5],
};

export const TALK_MINUTES = 25;
export const SUBMIT_MINUTES = 5;
export const REACT_MINUTES = 5;
// Reactions still count this long after the room moves on.
export const REACT_GRACE_MS = 10_000;
// Each phone's deck fits the reaction window: about 8 seconds a card, with a
// minute kept for the thought at the end, and never fewer than 8 cards
// (deckSize in flow.js).
export const CARD_REACT_MS = 8_000;
export const AFTERTHOUGHT_RESERVE_MS = 60_000;
export const MIN_DECK = 8;
// A phone counts as "writing" this long after it last said it typed.
export const WRITING_WINDOW_MS = 20_000;
// The harshness check runs once there's been this long with no new card or thought.
export const HARSHNESS_QUIET_MS = 5_000;

// The walk-through runs itself. The last slide gets 20 seconds ("Anything
// else? Out loud."), or a page of afterthoughts every 10 seconds when there
// are some (lastSlideMs in flow.js), no card gets less than the floor, and the
// walk ends at minute talk.minutes - 3.5 on the talk clock (21.5 of 25),
// never shorter than the minimum.
export const LAST_SLIDE_MS = 20_000;
export const AFTERTHOUGHTS_PER_PAGE = 4;
export const AFTERTHOUGHT_PAGE_MS = 10_000;
export const MIN_CARD_MS = 15_000;
export const MIN_WALK_MS = 180_000;
export const WALK_END_BEFORE_MINUTES = 3.5;

export function nextPhase(phase) {
  const i = PHASES.indexOf(phase);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null;
}

// Back is always available, except that nothing can come back from the shred.
export function previousPhase(phase) {
  if (phase === 'shred' || phase === 'closing') return null;
  const i = PHASES.indexOf(phase);
  return i > 0 ? PHASES[i - 1] : null;
}

// Minutes ahead (positive) or behind (negative) the plan; 0 means on time.
// In the walk-through, progress through the stream sets where we should be.
export function paceMinutes({ phase, elapsedMinutes, walkIndex = 0, walkLength = 0 }) {
  const span = PLAN[phase];
  if (!span) return 0;
  let [lo, hi] = span;
  if (phase === 'walk' && walkLength > 0) {
    const step = (hi - lo) / walkLength;
    lo = span[0] + walkIndex * step;
    hi = lo + step;
  }
  if (elapsedMinutes < lo) return lo - elapsedMinutes;
  if (elapsedMinutes > hi) return hi - elapsedMinutes;
  return 0;
}
