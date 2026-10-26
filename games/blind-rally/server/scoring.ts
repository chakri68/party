import type { GameOutcome } from "@games/game-core";
import { formatClock } from "../shared/wire.ts";
import type { BlindRallyState, TeamState } from "../shared/types.ts";
import { trackData } from "./geometry.ts";
import { closestGuess, effectiveTime } from "./race.ts";
import { members } from "./teams.ts";

// Results (spec §5): finishers by effective time, then DNFs by checkpoints
// passed. Equal is a tie, shown as one ("=2nd"), never broken in secret.
// "Equal" is at the timing board's precision, tenths, so two times that
// print the same rank the same.

export interface Placing {
  team: TeamState;
  rank: number;
  tied: boolean;
  /** Effective time, finishers only. */
  timeMs: number | null;
}

const ORDINAL = ["th", "st", "nd", "rd"];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ORDINAL[n % 10] ?? "th"}`;

export function placings(state: BlindRallyState): Placing[] {
  const racing = state.teams.filter((t) => t.run);
  const key = (t: TeamState): [number, number] => {
    const run = t.run!;
    return run.status === "finished"
      ? [0, Math.floor(effectiveTime(state, run, run.finishedAt!) / 100)]
      : [1, -run.cp];
  };
  const sorted = racing
    .map((team) => ({ team, k: key(team) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.team.id - b.team.id);
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  return sorted.map(({ team, k }) => {
    const first = sorted.findIndex((x) => same(x.k, k));
    const run = team.run!;
    return {
      team,
      rank: first + 1,
      tied: sorted.filter((x) => same(x.k, k)).length > 1,
      timeMs: run.status === "finished" ? effectiveTime(state, run, run.finishedAt!) : null,
    };
  });
}

/** "1st · Team 2 · Pine Panic · 1:42.3 (+5 s reset, 12.0 s paused off)" or "=3rd · Team 1 · Pine Panic · DNF, 3/5 checkpoints". */
export function placingLabel(state: BlindRallyState, p: Placing): string {
  const run = p.team.run!;
  const track = trackData(state.trackId);
  const n = track.checkpoints.length;
  const extras = [
    run.penaltyMs ? `+${run.penaltyMs / 1000} s reset${run.resets === 1 ? "" : "s"}` : "",
    run.pausedMs >= 100 ? `${(Math.floor(run.pausedMs / 100) / 10).toFixed(1)} s paused off` : "",
  ].filter(Boolean);
  const place = `${p.tied ? "=" : ""}${ordinal(p.rank)}`;
  const result = p.timeMs !== null ? formatClock(p.timeMs) : `DNF, ${run.cp}/${n} checkpoints`;
  return `${place} · Team ${p.team.id} · ${track.name} · ${result}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

/**
 * The Navigator's best guess pin against where the server had the car when
 * they placed it: "Closest guess: 12 m off after CP3". Null with no pin the
 * server could check. A small stat, not a score.
 */
export function guessLine(team: TeamState): string | null {
  const g = team.run ? closestGuess(team.run) : null;
  if (!g) return null;
  const m = Math.round(g.offM);
  return `Closest guess: ${m < 1 ? "spot on" : `${m} m off`} ${g.cp ? `after CP${g.cp}` : "before CP1"}`;
}

export function result(state: BlindRallyState): GameOutcome {
  const ps = placings(state);
  const winners = ps.filter((p) => p.rank === 1 && p.timeMs !== null).flatMap((p) => members(p.team));
  const standings = ps.flatMap((p) => {
    const label = placingLabel(state, p);
    // One line per team, on the Navigator's row: the pins were theirs. client/styles.css breaks it onto its own line.
    const guess = guessLine(p.team);
    return members(p.team).map((playerId) => ({
      playerId,
      value: p.rank,
      label: guess && playerId === p.team.navigatorId ? `${label}\n${guess}` : label,
    }));
  });
  const seated = new Set(standings.map((s) => s.playerId));
  for (const p of state.players) if (!seated.has(p.id)) standings.push({ playerId: p.id, value: 0, label: "Watched" });
  return { winnerIds: winners, standings };
}
