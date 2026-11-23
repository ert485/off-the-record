// The finale's timeline. Shared by the projector, which plays it, and the
// server, which asks the facilitator to move on once it has played.

export const START_DELAY_MS = 1200; // before the first emoji arrives
export const REPLAY_MS = 10_000; // the longest the replay of reactions runs
export const STEP_MS = 400; // the longest gap between two emojis
export const MAX_PARTICLES = 700;
export const POOL_DELAY_MS = 2000; // after the last emoji, before they pool
export const POOL_MS = 1300; // the pooling itself
export const QUIET_MS = 8000; // the finished picture stays up this long

// Long sequences are sampled: every nth reaction becomes a particle.
export const sampleEvery = (reactionCount) => Math.max(1, Math.ceil(reactionCount / MAX_PARTICLES));

// When the i-th of n particles arrives, in ms from the start of the replay.
export function arrivalMs(i, n, replayMs) {
  return (replayMs / n) * i;
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
