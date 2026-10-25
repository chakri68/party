import type { GameContext, GameEventEnvelope, StreamRelay, StreamResult, TimerRequest } from "@games/game-core";
import { parseControl } from "../shared/wire.ts";
import {
  COUNTDOWN_MS,
  RESET_PENALTY_MS,
  type BlindRallyEvent,
  teamColor,
  type BlindRallyState,
  type GhostRelay,
  type RunState,
  type TeamState,
} from "../shared/types.ts";
import { GO, isLive, moveTo, TIME_UP } from "./phases.ts";
import { isFull, seatOf } from "./teams.ts";

// The race itself: start, clock, and the two high-rate streams. Steps 8–12
// (snapshot plausibility, checkpoints, finish, disconnect grace) land here.

export interface Out {
  events: GameEventEnvelope<BlindRallyEvent>[];
  timers: TimerRequest[];
}

const pub = (event: BlindRallyEvent): GameEventEnvelope<BlindRallyEvent> => ({ visibility: { kind: "public" }, event });

const newRun = (): RunState => ({ status: "running", lastSeq: 0, resets: 0, penaltyMs: 0 });

/** Full cars get a run; half-empty ones were refused by startBlocker, empty ones sit it out. */
export function startCountdown(state: BlindRallyState, ctx: GameContext, out: Out): void {
  moveTo(state, "countdown");
  for (const t of state.teams) t.run = isFull(t) ? newRun() : null;
  state.startsAt = ctx.now + COUNTDOWN_MS;
  state.endsAt = state.startsAt + state.settings.timeLimit * 60_000;
  out.timers.push(
    { kind: "set", timerId: GO, delayMs: COUNTDOWN_MS },
    { kind: "set", timerId: TIME_UP, delayMs: state.endsAt - ctx.now },
  );
  out.events.push(pub({ type: "countdown", startsAt: state.startsAt }));
}

/** Time's up, or the host called it. Whoever hasn't finished is DNF. */
export function endRace(state: BlindRallyState, ctx: GameContext, reason: "time" | "host", out: Out): void {
  moveTo(state, "finished");
  state.endedAt = ctx.now;
  for (const t of state.teams) if (t.run?.status === "running") t.run.status = "dnf";
  out.timers.push({ kind: "cancel", timerId: GO }, { kind: "cancel", timerId: TIME_UP });
  out.events.push(pub({ type: "race-over", reason }));
}

/**
 * The Driver asks; Godot does the moving (back to its last checkpoint) when
 * the Navigator's host sees the event. Step 10 checks it against the server's
 * own checkpoint record.
 */
export function resetCar(team: TeamState, out: Out): void {
  const run = team.run!;
  run.resets++;
  run.penaltyMs += RESET_PENALTY_MS;
  out.events.push(pub({ type: "reset", teamId: team.id, penaltyMs: run.penaltyMs }));
}

/** The team's run, if this player may drive it right now. */
export function liveRun(state: BlindRallyState, playerId: string, now: number) {
  const seat = seatOf(state, playerId);
  if (!seat || !seat.team.run || seat.team.run.status !== "running" || !isLive(state, now)) return null;
  return seat;
}

/** A copy of `state` with one team's run patched. Streams run at 25 Hz a car: no structuredClone here. */
function withRun(state: BlindRallyState, teamId: number, patch: Partial<RunState>): BlindRallyState {
  return {
    ...state,
    teams: state.teams.map((t) => (t.id === teamId && t.run ? { ...t, run: { ...t.run, ...patch } } : t)),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Both streams, best-effort and never persisted (an eviction loses a few
 * hundred ms of seq, which only makes the next input look newer).
 *
 * - `in` from a Driver: to their Navigator and nobody else.
 * - `snap` / `ev` from a Navigator: reduced to speed and impacts, to their
 *   Driver only. On a shared stage the position also goes to the other
 *   teams' Navigators as a ghost; it never reaches a Driver (spec §8.2).
 */
export function onRaceStream(state: BlindRallyState, playerId: string, data: unknown, now: number): StreamResult<BlindRallyState> | null {
  const t = typeof data === "object" && data !== null ? (data as { t?: unknown }).t : undefined;
  const seat = liveRun(state, playerId, now);
  if (!seat) return null;
  const { team, role } = seat;
  const run = team.run!;

  if (t === "in") {
    if (role !== "driver" || !team.navigatorId) return null;
    const input = parseControl(data);
    if (!input || input.seq <= run.lastSeq) return null;
    return {
      state: withRun(state, team.id, { lastSeq: input.seq }),
      relays: [{ to: [team.navigatorId], data: input }],
      persist: false,
    };
  }

  if (role !== "navigator" || !team.driverId) return null;
  const o = data as Record<string, unknown>;
  // Step 8: plausibility (speed × Δt, teleports) and the last accepted snapshot go here.
  if (t === "snap" && finite(o.speed)) {
    const speed = Math.round(Math.min(100, Math.max(-100, o.speed)) * 10) / 10;
    const relays: StreamRelay[] = [{ to: [team.driverId], data: { t: "dash", speed } }];
    const ghost = state.settings.stageMode === "shared" ? ghostOf(team, o, speed) : null;
    if (ghost) {
      // The other cars' Navigators, and only them: a Driver must never learn where anything is.
      const to = state.teams.filter((r) => r.id !== team.id && r.run?.status === "running" && r.navigatorId).map((r) => r.navigatorId!);
      if (to.length) relays.push({ to, data: ghost });
    }
    return { state, relays, persist: false };
  }
  if (t === "ev" && o.kind === "impact" && finite(o.strength)) {
    const strength = Math.round(Math.min(10, Math.max(0, o.strength)) * 10) / 10;
    return { state, relays: [{ to: [team.driverId], data: { t: "hit", strength } }], persist: false };
  }
  // cp / finish are game-actions from step 10 on: reliable and versioned, not streamed.
  return null;
}

const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(finite);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The shared-stage ghost: just enough to draw a rival (§8.2), rebuilt field by field. */
function ghostOf(team: TeamState, o: Record<string, unknown>, speed: number): GhostRelay | null {
  if (!isVec3(o.position) || !finite(o.heading)) return null;
  return {
    t: "ghost",
    teamId: team.id,
    color: teamColor(team.color).hex,
    tick: Number.isInteger(o.tick) ? (o.tick as number) : 0,
    position: [r2(o.position[0]), r2(o.position[1]), r2(o.position[2])],
    heading: Math.round(o.heading * 1000) / 1000,
    speed,
  };
}
