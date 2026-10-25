import type { BlindRallyState, Phase } from "../shared/types.ts";

// The game's own FSM (map §2). The room sits in `playing` from TEAMS to the
// end of the race; `getResult` going non-null at `finished` hands it to the
// shell's results screen. NOMINATION and VOTING slot in before countdown in M3.

const NEXT: Record<Phase, readonly Phase[]> = {
  teams: ["countdown"],
  countdown: ["racing", "finished"],
  racing: ["finished"],
  finished: [],
};

export const canMove = (from: Phase, to: Phase) => NEXT[from].includes(to);

/** Moves the (already cloned) state on. A move the table doesn't allow is a bug, not a user error. */
export function moveTo(state: BlindRallyState, to: Phase): void {
  if (!canMove(state.phase, to)) throw new Error(`blind-rally: ${state.phase} → ${to} isn't a move`);
  state.phase = to;
}

/** Timer ids. Setting one again replaces it. */
export const GO = "go";
export const TIME_UP = "time-up";

/**
 * Cars may move. Decided by the server clock, not the phase: the alarm that
 * flips countdown → racing can land late, and the race starts on time anyway.
 */
export function isLive(state: BlindRallyState, now: number): boolean {
  return (
    (state.phase === "countdown" || state.phase === "racing") &&
    state.startsAt !== null &&
    state.endsAt !== null &&
    now >= state.startsAt &&
    now < state.endsAt
  );
}
