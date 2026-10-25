import { seededRandomInt, type GameContext } from "@games/game-core";
import { expect } from "vitest";
import { blindRallyGame as game } from "../server/game.ts";
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
