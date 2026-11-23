// The finale's timeline. Shared by the projector, which plays it, and the
// server, which asks the facilitator to move on once it has played.

// With a full room (about 400 reactions) it takes about 12 seconds: the
// replay about 6, the pooling 2.5, and 3 of quiet before the facilitator is
// asked "Ready to shred?". Fewer reactions replay faster.
export const START_DELAY_MS = 600; // before the first emoji arrives
export const REPLAY_MS = 5600; // the longest the replay of reactions runs
export const STEP_MS = 400; // the longest average gap between two emojis
export const MAX_PARTICLES = 700;
export const POOL_DELAY_MS = 700; // after the last emoji, before they pool
export const POOL_MS = 1800; // the pooling itself: they gather, then become one emoji per type
export const QUIET_MS = 3200; // the finished picture stays up this long

// Long sequences are sampled: every nth reaction becomes a particle.
export const sampleEvery = (reactionCount) => Math.max(1, Math.ceil(reactionCount / MAX_PARTICLES));

// When the i-th of n particles arrives, in ms from the start of the replay:
// slow at first, quicker in the middle, slow again at the end, so it stays
// calm. The count so far follows a sine ease-in-out over the replay, blended
// with an even pace so the first and last few don't wait too long.
export function arrivalMs(i, n, replayMs) {
  const u = (i + 0.5) / n;
  return replayMs * (0.4 * u + (0.6 * Math.acos(1 - 2 * u)) / Math.PI);
}

// In ms from the finale's start: when the replay starts and how long it runs,
// when the particles start to pool, and when it has played and been on screen
// a while. The replay samples long sequences exactly as the projector does.
export function finaleTimeline(reactionCount) {
  if (reactionCount <= 0) return { replayAt: START_DELAY_MS, replayMs: 0, poolAt: START_DELAY_MS, doneAt: START_DELAY_MS + QUIET_MS };
  const sampled = Math.ceil(reactionCount / sampleEvery(reactionCount));
  const replayMs = Math.min(STEP_MS * sampled, REPLAY_MS);
  const poolAt = START_DELAY_MS + replayMs + POOL_DELAY_MS;
  return { replayAt: START_DELAY_MS, replayMs, poolAt, doneAt: poolAt + POOL_MS + QUIET_MS };
}
