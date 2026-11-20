// The session's phases, in order. The facilitator moves forward and back;
// every phone follows. See "Session flow" in the spec.
export const PHASES = ['join', 'submit', 'cluster', 'react', 'walk', 'lastcall', 'finale', 'shred', 'closing'];

// Planned clock in minutes for each phase: [start, end]. From the spec's
// 25-minute timing table. Drives the facilitator-only pace marker.
export const PLAN = {
  join: [0, 2],
  submit: [2, 6],
  cluster: [6, 7],
  react: [7, 9.5],
  walk: [9.5, 19],
  lastcall: [19, 19.5],
  finale: [19.5, 20.5],
  shred: [20.5, 21.5],
  closing: [21.5, 22.5],
};

export const SUBMIT_MINUTES = 4;

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
