// The finale's timeline. Shared by the projector, which plays it, and the
// server, which asks the facilitator to move on once it has played.

export const START_DELAY_MS = 1200; // before the first emoji arrives
export const REPLAY_MS = 10_000; // the longest the replay of reactions runs
export const STEP_MS = 400; // the longest gap between two emojis
export const MAX_PARTICLES = 700;
export const POOL_DELAY_MS = 2000; // after the last emoji, before they pool
export const POOL_MS = 1300; // the pooling itself
export const QUIET_MS = 8000; // the finished picture stays up this long

// ms from the finale's start until it has played and been on screen a while.
// The replay samples long sequences exactly as the projector does.
export function finaleTimeline(reactionCount) {
  if (reactionCount <= 0) return { doneAt: START_DELAY_MS + QUIET_MS };
  const every = Math.ceil(reactionCount / MAX_PARTICLES);
  const sampled = Math.ceil(reactionCount / every);
  const replay = Math.min(STEP_MS * sampled, REPLAY_MS);
  return { doneAt: START_DELAY_MS + replay + POOL_DELAY_MS + POOL_MS + QUIET_MS };
}
