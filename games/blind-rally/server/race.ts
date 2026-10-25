import type { GameContext, GameError, GameEventEnvelope, StreamRelay, StreamResult, TimerRequest } from "@games/game-core";
import { parseControl, parseSnapshot, type ParsedSnapshot } from "../shared/wire.ts";
import { flatDistance, insideBounds, recoveryFor, type TrackData } from "../shared/track-data.ts";
import {
  COUNTDOWN_MS,
  RACE_GRACE_MS,
  RESET_HOLD_MS,
  RESET_PENALTY_MS,
  type BlindRallyEvent,
  teamColor,
  type BlindRallyState,
  type GhostRelay,
  type Role,
  type RunState,
  type TeamState,
} from "../shared/types.ts";
import { trackData } from "./geometry.ts";
import { GO, isLive, moveTo, TIME_UP } from "./phases.ts";
import { isFull, seatOf } from "./teams.ts";

// The race itself: start, clock, the two high-rate streams, and the rules the
// server holds the Navigator's Godot to (spec §5, §8.3). Godot runs the
// physics, so all of this is plausibility, not proof: a casual room.

export interface Out {
  events: GameEventEnvelope<BlindRallyEvent>[];
  timers: TimerRequest[];
}

const pub = (event: BlindRallyEvent): GameEventEnvelope<BlindRallyEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: BlindRallyEvent): GameEventEnvelope<BlindRallyEvent> => ({ visibility: { kind: "private", playerId }, event });

// ---------------------------------------------------------------------------
// Plausibility (step 8)
// ---------------------------------------------------------------------------

/** m/s. The car tops out near 32 (115 km/h); this leaves room for a downhill and a tailwind. */
export const MAX_SPEED = 45;
/** Arrival jitter: two snapshots can land together after a stall, 100 ms of Godot time apart. */
const SLACK_S = 0.5;
const SLACK_M = 5;
/** A long silence doesn't buy a long jump: Godot stops when its tab does. */
const MAX_GAP_S = 3;
/** The first snapshot of a run has to be on the line. */
const SPAWN_RADIUS = 15;
/** After a reset or a Navigator's return, how close to the anchor the car must reappear. */
const ANCHOR_RADIUS = 15;
/** How long that one authorised jump stays open. */
const MOVE_WINDOW_MS = 10_000;
/** A checkpoint claim needs a snapshot this recent to check it against. */
const GATE_SNAP_AGE_MS = 2_000;
const GATE_SLACK_M = 6;
/** Off the map by more than this is out of the world, whatever Godot says. */
const BOUNDS_MARGIN = 50;
/** The stream path writes the last snapshot to storage at most this often. */
const SAVE_EVERY_MS = 1_000;

/** One drop-out grace timer per team: `grace:2`. */
export const GRACE_TIMER = "grace:";
export const graceTimer = (teamId: number) => `${GRACE_TIMER}${teamId}`;

const newRun = (): RunState => ({
  status: "running",
  lastSeq: 0,
  resets: 0,
  penaltyMs: 0,
  cp: 0,
  snap: null,
  savedAt: 0,
  movedAt: null,
  holdUntil: 0,
  finishedAt: null,
  pausedMs: 0,
  pausedSince: null,
  away: [],
  graceEndsAt: null,
});

/**
 * Whether the server believes this snapshot, given the last one it did.
 * "anchor" is the authorised jump back to a recovery anchor, which also
 * closes the window for another.
 */
export function plausible(run: RunState, track: TrackData, s: ParsedSnapshot, now: number): "ok" | "anchor" | false {
  if (Math.abs(s.speed) > MAX_SPEED) return false;
  if (!insideBounds(track, s.position, BOUNDS_MARGIN)) return false;
  if (run.movedAt !== null && now - run.movedAt <= MOVE_WINDOW_MS && flatDistance(s.position, recoveryFor(track, run.cp).position) <= ANCHOR_RADIUS) {
    return "anchor";
  }
  if (!run.snap) return flatDistance(s.position, track.spawn.position) <= SPAWN_RADIUS ? "ok" : false;
  const dt = Math.min(MAX_GAP_S, Math.max(0, now - run.snap.at) / 1000);
  return flatDistance(s.position, run.snap.position) <= MAX_SPEED * (dt + SLACK_S) + SLACK_M ? "ok" : false;
}

// ---------------------------------------------------------------------------
// Start and end
// ---------------------------------------------------------------------------

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

/** Time's up, the host called it, or nobody's left out there. Whoever hasn't finished is DNF. */
export function endRace(state: BlindRallyState, ctx: GameContext, reason: "time" | "host" | "done", out: Out): void {
  moveTo(state, "finished");
  state.endedAt = ctx.now;
  for (const t of state.teams) {
    if (!t.run) continue;
    if (t.run.status === "running") t.run.status = "dnf";
    closePause(state, t.run, ctx.now);
    out.timers.push({ kind: "cancel", timerId: graceTimer(t.id) });
  }
  out.timers.push({ kind: "cancel", timerId: GO }, { kind: "cancel", timerId: TIME_UP });
  out.events.push(pub({ type: "race-over", reason }));
}

/** The last car home (or out) ends it: nobody waits for a clock with nothing left to time. */
function endIfDone(state: BlindRallyState, ctx: GameContext, out: Out): void {
  const runs = state.teams.flatMap((t) => (t.run ? [t.run] : []));
  if (runs.length && runs.every((r) => r.status !== "running")) endRace(state, ctx, "done", out);
}

/** Effective time (spec §5): wall clock from the start, minus drop-out pauses, plus penalties. */
export function effectiveTime(state: BlindRallyState, run: RunState, end: number): number {
  return Math.max(0, end - (state.startsAt ?? end)) - run.pausedMs + run.penaltyMs;
}

/** The team's run, if this player may drive it right now. */
export function liveRun(state: BlindRallyState, playerId: string, now: number) {
  const seat = seatOf(state, playerId);
  if (!seat || !seat.team.run || seat.team.run.status !== "running" || !isLive(state, now)) return null;
  return seat;
}

// ---------------------------------------------------------------------------
// Reset, checkpoints, finish (step 10)
// ---------------------------------------------------------------------------

/**
 * The Driver asked and the server said yes: +5 s, and the car goes back to
 * the anchor after the last checkpoint the *server* accepted, so a reset
 * can't skip one. The Navigator's Godot hears where; the next snapshot may
 * jump there, and nowhere else.
 */
export function resetCar(team: TeamState, now: number, out: Out): void {
  const run = team.run!;
  run.resets++;
  run.penaltyMs += RESET_PENALTY_MS;
  run.movedAt = now;
  run.holdUntil = now + RESET_HOLD_MS;
  out.events.push(pub({ type: "reset", teamId: team.id, penaltyMs: run.penaltyMs }));
  if (team.navigatorId) out.events.push(only(team.navigatorId, { type: "recover", teamId: team.id, checkpoint: run.cp, holdMs: RESET_HOLD_MS }));
}

export type GateClaim = { kind: "cp"; checkpointId: number } | { kind: "finish" };

/**
 * A Navigator's Godot says the car went through a gate. True only in order,
 * and only if the last snapshot the server believed was near enough to it.
 */
export function checkGate(state: BlindRallyState, run: RunState, claim: GateClaim, now: number): GameError | null {
  const track = trackData(state.trackId);
  const n = track.checkpoints.length;
  let gate: { position: [number, number, number]; radius: number };
  if (claim.kind === "cp") {
    if (claim.checkpointId <= run.cp) return { code: "already-passed", message: `Checkpoint ${claim.checkpointId} already counted.` };
    if (claim.checkpointId !== run.cp + 1) return { code: "out-of-order", message: `Checkpoint ${run.cp + 1} first.` };
    gate = track.checkpoints[run.cp]!;
  } else {
    if (run.cp < n) return { code: "checkpoints-missing", message: `${n - run.cp} checkpoint${n - run.cp === 1 ? "" : "s"} still to go: the finish doesn't count yet.` };
    gate = track.finish;
  }
  const snap = run.snap;
  const age = snap ? now - snap.at : Infinity;
  if (!snap || age > GATE_SNAP_AGE_MS) return { code: "no-position", message: "The server hasn't seen the car lately." };
  const reach = gate.radius + GATE_SLACK_M + MAX_SPEED * (age / 1000);
  if (flatDistance(snap.position, gate.position) > reach) return { code: "too-far", message: "The car's nowhere near that gate." };
  return null;
}

/** Applies a claim checkGate passed. */
export function passGate(state: BlindRallyState, team: TeamState, claim: GateClaim, ctx: GameContext, out: Out): void {
  const run = team.run!;
  if (claim.kind === "cp") {
    run.cp = claim.checkpointId;
    return;
  }
  run.status = "finished";
  run.finishedAt = ctx.now;
  out.events.push(pub({ type: "team-finished", teamId: team.id, timeMs: effectiveTime(state, run, ctx.now) }));
  endIfDone(state, ctx, out);
}

// ---------------------------------------------------------------------------
// Drop-outs (step 12, spec §8.3)
// ---------------------------------------------------------------------------

/** Stops counting a pause: only the part inside the race window was ever on the clock. */
function closePause(state: BlindRallyState, run: RunState, now: number): void {
  if (run.pausedSince === null) return;
  const from = Math.max(run.pausedSince, state.startsAt ?? now);
  const to = Math.min(now, state.endsAt ?? now);
  run.pausedMs += Math.max(0, to - from);
  run.pausedSince = null;
}

/** A team that's on the road right now, countdown included. */
function racingSeat(state: BlindRallyState, playerId: string) {
  if (state.phase !== "countdown" && state.phase !== "racing") return null;
  const seat = seatOf(state, playerId);
  return seat?.team.run?.status === "running" ? seat : null;
}

/**
 * Someone's socket went. The team pauses: its clock stops, nothing it sends
 * counts, and the grace timer starts (once, from the first drop: two drops
 * don't buy 60 s). A gone Driver also means the car stops now, not after
 * Godot's input timeout.
 */
export function playerAway(state: BlindRallyState, playerId: string, now: number, out: Out): boolean {
  const seat = racingSeat(state, playerId);
  if (!seat || seat.team.run!.away.includes(seat.role)) return false;
  const { team, role } = seat;
  const run = team.run!;
  run.away.push(role);
  run.pausedSince ??= now;
  if (run.graceEndsAt === null) {
    run.graceEndsAt = now + RACE_GRACE_MS;
    out.timers.push({ kind: "set", timerId: graceTimer(team.id), delayMs: RACE_GRACE_MS });
  }
  if (role === "driver" && team.navigatorId) out.events.push(only(team.navigatorId, { type: "park", teamId: team.id }));
  return true;
}

/**
 * Back within grace. The team resumes once both are here. A Navigator's
 * Godot starts fresh, so its car may reappear at the anchor of the last
 * accepted checkpoint, which is where it's told to put it.
 */
export function playerBack(state: BlindRallyState, playerId: string, now: number, out: Out): boolean {
  const seat = racingSeat(state, playerId);
  if (!seat || !seat.team.run!.away.includes(seat.role)) return false;
  const { team, role } = seat;
  const run = team.run!;
  run.away = run.away.filter((r: Role) => r !== role);
  if (role === "navigator") run.movedAt = now;
  if (!run.away.length) {
    closePause(state, run, now);
    run.graceEndsAt = null;
    out.timers.push({ kind: "cancel", timerId: graceTimer(team.id) });
  }
  return true;
}

/** Grace ran out with someone still gone, or they left the room for good. */
export function teamOut(state: BlindRallyState, teamId: number, reason: "grace" | "left", ctx: GameContext, out: Out): boolean {
  const team = state.teams.find((t) => t.id === teamId);
  const run = team?.run;
  if (!run || run.status !== "running" || (state.phase !== "countdown" && state.phase !== "racing")) return false;
  if (reason === "grace" && !run.away.length) return false;
  run.status = "dnf";
  closePause(state, run, ctx.now);
  run.graceEndsAt = null;
  out.timers.push({ kind: "cancel", timerId: graceTimer(teamId) });
  out.events.push(pub({ type: "team-out", teamId, reason }));
  endIfDone(state, ctx, out);
  return true;
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** A copy of `state` with one team's run patched. Streams run at 25 Hz a car: no structuredClone here. */
function withRun(state: BlindRallyState, teamId: number, patch: Partial<RunState>): BlindRallyState {
  return {
    ...state,
    teams: state.teams.map((t) => (t.id === teamId && t.run ? { ...t, run: { ...t.run, ...patch } } : t)),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Both streams, best-effort.
 *
 * - `in` from a Driver: to their Navigator and nobody else. Never persisted
 *   (an eviction loses a few hundred ms of seq, which only makes the next
 *   input look newer). Dropped while the car's held after a reset.
 * - `snap` from a Navigator: checked (speed cap, distance from the last
 *   accepted one by server time, bounds; a jump only to the anchor of an
 *   authorised move), kept as the last accepted snapshot, and written to
 *   storage at most once a second. The Driver gets the speed and nothing
 *   else; on a shared stage the other Navigators get a ghost (spec §8.2).
 * - `ev` impacts: a hit flash on the Driver's dash.
 *
 * A paused team (someone's dropped) sends nothing that counts.
 */
export function onRaceStream(state: BlindRallyState, playerId: string, data: unknown, now: number): StreamResult<BlindRallyState> | null {
  const t = typeof data === "object" && data !== null ? (data as { t?: unknown }).t : undefined;
  const seat = liveRun(state, playerId, now);
  if (!seat) return null;
  const { team, role } = seat;
  const run = team.run!;
  if (run.away.length) return null;

  if (t === "in") {
    if (role !== "driver" || !team.navigatorId || now < run.holdUntil) return null;
    const input = parseControl(data);
    if (!input || input.seq <= run.lastSeq) return null;
    return {
      state: withRun(state, team.id, { lastSeq: input.seq }),
      relays: [{ to: [team.navigatorId], data: input }],
      persist: false,
    };
  }

  if (role !== "navigator" || !team.driverId) return null;

  if (t === "snap") {
    const s = parseSnapshot(data);
    if (!s) return null;
    const verdict = plausible(run, trackData(state.trackId), s, now);
    if (!verdict) return null;
    const save = now - run.savedAt >= SAVE_EVERY_MS;
    const next = withRun(state, team.id, {
      snap: { at: now, tick: s.tick, position: s.position, speed: s.speed, distance: s.distance },
      ...(verdict === "anchor" && { movedAt: null }),
      ...(save && { savedAt: now }),
    });
    const relays: StreamRelay[] = [{ to: [team.driverId], data: { t: "dash", speed: s.speed } }];
    if (state.settings.stageMode === "shared") {
      // The other cars' Navigators, and only them: a Driver must never learn where anything is.
      const to = state.teams.filter((r) => r.id !== team.id && r.run?.status === "running" && r.navigatorId).map((r) => r.navigatorId!);
      if (to.length) relays.push({ to, data: ghostOf(team, s) });
    }
    return { state: next, relays, persist: save };
  }

  const o = data as Record<string, unknown>;
  if (t === "ev" && o.kind === "impact" && finite(o.strength)) {
    const strength = Math.round(Math.min(10, Math.max(0, o.strength)) * 10) / 10;
    return { state, relays: [{ to: [team.driverId], data: { t: "hit", strength } }], persist: false };
  }
  // cp / finish are `race.event` game-actions: reliable and versioned, not streamed.
  return null;
}

/** The shared-stage ghost: just enough to draw a rival (§8.2), rebuilt field by field. */
function ghostOf(team: TeamState, s: ParsedSnapshot): GhostRelay {
  return {
    t: "ghost",
    teamId: team.id,
    color: teamColor(team.color).hex,
    tick: s.tick,
    position: s.position,
    heading: s.heading,
    speed: s.speed,
  };
}
