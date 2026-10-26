import { seededRandomInt, type GameContext } from "@games/game-core";
import { expect } from "vitest";
import { blindRallyGame as game } from "../server/game.ts";
import { defaultTrack, trackData } from "../server/geometry.ts";
import { DEFAULT_SETTINGS, type BlindRallyAction, type BlindRallySettings, type BlindRallyState } from "../shared/types.ts";

export { game };

/** p0 is the host unless a test says otherwise. */
export const ctx = (now = 0, hostId: string | null = "p0"): GameContext => ({ now, randomInt: seededRandomInt(1), hostId });

export function newGame(players = 2, settings: Partial<BlindRallySettings> = {}, carry?: unknown): BlindRallyState {
  const ids = Array.from({ length: players }, (_, i) => ({ id: `p${i}` }));
  return game.createGame(ids, { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0, ...(carry !== undefined && { carry }) }, ctx()).state;
}

/** Applies an action that must succeed. */
export function act(state: BlindRallyState, playerId: string, action: BlindRallyAction, at = ctx()): BlindRallyState {
  const r = game.handleAction(state, playerId, action, at);
  if (!r.ok) throw new Error(`${action.type} by ${playerId}: ${r.error.code} ${r.error.message}`);
  return r.transition.state;
}

/** An action that must fail, with this code. */
export function refused(state: BlindRallyState, playerId: string, action: BlindRallyAction, code: string, at = ctx()) {
  const r = game.handleAction(state, playerId, action, at);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

/**
 * Teams of [driver, navigator] pairs, everyone ready, and the race started at
 * t=0, so the clock runs from COUNTDOWN_MS.
 */
export function racing(pairs: [string, string][], players = pairs.length * 2, settings: Partial<BlindRallySettings> = {}): BlindRallyState {
  let s = newGame(players, settings);
  pairs.forEach(([d, n], i) => {
    s = act(s, d, { type: "team.join", teamId: i + 1, role: "driver" });
    s = act(s, n, { type: "team.join", teamId: i + 1, role: "navigator" });
  });
  for (const id of pairs.flat()) s = act(s, id, { type: "player.ready", ready: true });
  return act(s, "p0", { type: "race.start" });
}

/** The track every test races on, and where its car starts. */
export const TRACK = trackData(defaultTrack());
export const SPAWN = TRACK.spawn.position;

/** A Navigator snapshot at `position` (the spawn by default), as Godot sends it. */
export const snapAt = (position: [number, number, number] = SPAWN, extra: object = {}) => ({
  t: "snap",
  tick: 9,
  position,
  heading: 1.2,
  velocity: [3, 0, 4],
  speed: 23.456,
  distance: 410,
  checkpointHint: 2,
  surface: "gravel",
  ...extra,
});

export const east = (dx: number, from: [number, number, number] = SPAWN): [number, number, number] => [from[0] + dx, from[1], from[2]];

type V3 = [number, number, number];

/**
 * Drives `nav`'s car to `to` with plausible snapshots, 100 m every 2.5 s of
 * server time, the way a real car (at 40 m/s) would arrive. Returns where the
 * clock got to.
 */
export function driveTo(state: BlindRallyState, nav: string, to: V3, now: number): { state: BlindRallyState; now: number } {
  const team = state.teams.find((t) => t.navigatorId === nav)!;
  const from: V3 = team.run!.snap?.position ?? SPAWN;
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 100));
  let s = state;
  let t = now;
  // The very first snapshot of a run has to be on the line.
  if (!team.run!.snap) s = game.onStream!(s, nav, snapAt(from, { speed: 0 }), ctx(t))!.state;
  for (let i = 1; i <= steps; i++) {
    t += 2_500;
    const k = i / steps;
    const p: V3 = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
    const out = game.onStream!(s, nav, snapAt(p, { speed: 30 }), ctx(t));
    if (!out) throw new Error(`driveTo: snapshot ${i}/${steps} refused at ${p.join(",")}`);
    s = out.state;
  }
  return { state: s, now: t };
}

/** Through the next checkpoints up to `upTo` (1-based), in order, each claimed as Godot would. */
export function passCheckpoints(state: BlindRallyState, nav: string, upTo: number, now: number) {
  let s = state;
  let t = now;
  const from = state.teams.find((x) => x.navigatorId === nav)!.run!.cp + 1;
  for (let id = from; id <= upTo; id++) {
    ({ state: s, now: t } = driveTo(s, nav, TRACK.checkpoints[id - 1]!.position, t));
    s = act(s, nav, { type: "race.event", kind: "cp", checkpointId: id }, ctx(t));
  }
  return { state: s, now: t };
}

/** Every checkpoint left, then the line. */
export function finishRun(state: BlindRallyState, nav: string, now: number) {
  let { state: s, now: t } = passCheckpoints(state, nav, TRACK.checkpoints.length, now);
  ({ state: s, now: t } = driveTo(s, nav, TRACK.finish.position, t));
  s = act(s, nav, { type: "race.event", kind: "finish" }, ctx(t));
  return { state: s, now: t };
}
