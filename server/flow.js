// What the room is waiting on. The app runs each part; when a part is over,
// the facilitator is asked to confirm the move. Nothing here changes state.
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
    case 'finale':
      if (now >= state.phaseStartedAt + finaleTimeline(state.reactions.length).doneAt) return { to: 'shred', label: 'Ready to shred?' };
      return null;
    default:
      return null;
  }
}
