// What the room is waiting on, and what is due when. The app runs each part;
// when a part is over, the facilitator is asked to confirm the move. Nothing
// here changes state.
import { LAST_SLIDE_MS, MIN_CARD_MS, MIN_WALK_MS, WALK_END_BEFORE_MINUTES } from './phases.js';
import { finaleTimeline } from '../public/shared/finale-timing.js';

export function pendingMove(state, now, { phoneCount = 0 } = {}) {
  switch (state.phase) {
    case 'submit':
      if (state.submitEndsAt !== null && now >= state.submitEndsAt) return { to: 'cluster', label: 'Ready for grouping?' };
      return null;
    case 'react': {
      const done = Object.values(state.clients).filter((c) => c.reactDone).length;
      if ((state.reactEndsAt !== null && now >= state.reactEndsAt) || (phoneCount > 0 && done >= phoneCount)) {
        return { to: 'walk', label: 'Ready for the walk-through?' };
      }
      return null;
    }
    case 'walk':
      if (state.walk.done) return { to: 'finale', label: 'Ready for the finale?' };
      return null;
    case 'finale':
      if (now >= state.phaseStartedAt + finaleTimeline(state.reactions.length).doneAt) return { to: 'shred', label: 'Ready to shred?' };
      return null;
    default:
      return null;
  }
}

// The phones' last warning comes a minute before submissions close; the
// grouping starts then on the cards so far, so the facilitator can read and
// approve themes while people finish.
export const EARLY_GROUPING_MS = 60_000;

// Whether to start that early grouping now: once per session, in submit, with
// cards to group and no themes yet (a round that already grouped keeps its themes).
export function earlyGroupingDue(state, now) {
  return (
    state.phase === 'submit' &&
    !state.clustering.early &&
    state.clustering.status !== 'running' &&
    state.themes.length === 0 &&
    state.submitEndsAt !== null &&
    now >= state.submitEndsAt - EARLY_GROUPING_MS &&
    state.cards.some((c) => !c.hidden)
  );
}

// When the walk-through must be over: fixed on the talk clock, so a pause or a
// slow card eats into later cards instead of moving the finish.
export function walkEndsAt(talk, now) {
  const startedAt = talk.startedAt ?? now;
  return Math.max(now + MIN_WALK_MS, startedAt + (talk.minutes - WALK_END_BEFORE_MINUTES) * 60_000);
}

// Cards left, counting the current one and the overview, not the last slide.
export function cardsLeft(walk) {
  return Math.max(1, walk.stream.length - 1 - walk.index);
}

// The current card's share of the time left (20 seconds are kept for the last slide).
export function cardMs(walk, now) {
  return Math.max(MIN_CARD_MS, (walk.endsAt - LAST_SLIDE_MS - now) / cardsLeft(walk));
}
