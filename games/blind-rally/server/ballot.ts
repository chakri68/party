import { stableHash } from "@games/game-core";
import { effectiveTrackPick, type BlindRallyState, type TrackBallot } from "../shared/types.ts";
import { trackCatalog } from "./geometry.ts";
import { isEmpty } from "./teams.ts";

// Fair Race's track (spec §7.1): the host's pick, or one lobby-wide ballot
// with a vote per team. The count runs live, so `trackId` is always the
// leader and the Navigators' Godot loads the right course when they ready up;
// the race start locks it, since nothing can vote after TEAMS.
//
// Chaos Cup (M3) will hang a ballot per target team off `ballots`; the count
// and the tie-break below don't care which target they're counting for.

/** Fair Race's ballot, made on the spot if it's missing. Mutates the (cloned) state. */
export function fairBallot(state: BlindRallyState): TrackBallot {
  let b = state.ballots.find((x) => x.target === "all");
  if (!b) state.ballots.push((b = { target: "all", votes: [], tied: [] }));
  return b;
}

/**
 * The count: most votes wins. A tie is settled by the room seed (spec §7.2.5)
 * and reported as one, never broken in secret. No votes at all: null, and the
 * track stays whatever it was (the default, or last race's on a rematch).
 */
export function tally(state: BlindRallyState, ballot: TrackBallot): { trackId: string; tied: string[] } | null {
  const c = count(
    ballot.votes.map((v) => v.trackId),
    trackCatalog().map((t) => t.id),
    `${state.seed}:${ballot.target}`,
  );
  return c && { trackId: c.winner, tied: c.tied };
}

/**
 * The count behind every ballot: most votes wins, ties go to the seeded coin.
 * `order` is the canonical list, so the coin sees the same leaders whoever
 * voted first; `seedKey` says which ballot it is, so two ballots in one room
 * don't flip the same coin. Null when nobody voted.
 */
export function count<T extends string>(votes: T[], order: readonly T[], seedKey: string): { winner: T; tied: T[] } | null {
  const counts = new Map<T, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  const leaders = order.filter((id) => counts.get(id) === top);
  if (leaders.length === 1) return { winner: leaders[0]!, tied: [] };
  const pick = leaders[stableHash(`${seedKey}:${leaders.join(",")}`) % leaders.length]!;
  return { winner: pick, tied: [...leaders] };
}

/**
 * After anything that might move the count: drops votes from cars that have
 * gone or emptied, recounts, and moves `trackId` to the leader. Returns
 * whether the track changed; see setTrack for who that un-readies.
 */
export function settleTrack(state: BlindRallyState): boolean {
  if (state.phase !== "teams") return false;
  const ballot = fairBallot(state);
  const live = new Set(state.teams.filter((t) => !isEmpty(t)).map((t) => t.id));
  ballot.votes = ballot.votes.filter((v) => live.has(v.teamId));
  if (effectiveTrackPick(state.settings) !== "ballot") {
    ballot.votes = [];
    ballot.tied = [];
    return false;
  }
  const count = tally(state, ballot);
  ballot.tied = count?.tied ?? [];
  if (!count || count.trackId === state.trackId) return false;
  setTrack(state, count.trackId);
  return true;
}

/**
 * Moves the room to `trackId`. A change un-readies the Navigators and only
 * them: a ready Navigator has booted the old course, and the Driver's screen
 * has no track in it. So a vote that doesn't move the leader touches nobody,
 * and one that does sends each car's Navigator back to look, without making
 * the whole lobby ready up again for the sake of a stage they can't see.
 */
export function setTrack(state: BlindRallyState, trackId: string): boolean {
  if (state.trackId === trackId) return false;
  state.trackId = trackId;
  const navigators = new Set(state.teams.map((t) => t.navigatorId));
  for (const p of state.players) if (navigators.has(p.id)) p.ready = false;
  return true;
}
