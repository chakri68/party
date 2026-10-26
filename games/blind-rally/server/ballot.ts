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

/** FNV-1a: a stable 32-bit hash, so a tie between the same tracks in the same room always lands the same way. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The count: most votes wins. A tie is settled by the room seed (spec §7.2.5)
 * and reported as one, never broken in secret. No votes at all: null, and the
 * track stays whatever it was (the default, or last race's on a rematch).
 */
export function tally(state: BlindRallyState, ballot: TrackBallot): { trackId: string; tied: string[] } | null {
  const counts = new Map<string, number>();
  for (const v of ballot.votes) counts.set(v.trackId, (counts.get(v.trackId) ?? 0) + 1);
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  // In the file's order, so the coin sees the same list whoever voted first.
  const leaders = trackCatalog().map((t) => t.id).filter((id) => counts.get(id) === top);
  if (leaders.length === 1) return { trackId: leaders[0]!, tied: [] };
  const pick = leaders[hash(`${state.seed}:${ballot.target}:${leaders.join(",")}`) % leaders.length]!;
  return { trackId: pick, tied: leaders };
}

/**
 * After anything that might move the count: drops votes from cars that have
 * gone or emptied, recounts, and moves `trackId` to the leader. Returns
 * whether the track changed; if it did, everyone has to ready up again,
 * because a ready Navigator has already booted the old course.
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

/** Moves the room to `trackId`; a change un-readies everyone (see settleTrack). */
export function setTrack(state: BlindRallyState, trackId: string): boolean {
  if (state.trackId === trackId) return false;
  state.trackId = trackId;
  for (const p of state.players) p.ready = false;
  return true;
}
