// Test helpers for games. Imported by game tests, which bring their own
// `expect`, so nothing here may import vitest.

import type { AnyGameDefinition, GameEventEnvelope } from "./index.ts";

/**
 * Everywhere a secret shows up that a seat outside `allowed` would receive:
 * public state, other seats' private state, public events, private events
 * addressed elsewhere. Empty means it kept. Matching is on the JSON the wire
 * would carry, ignoring case, so "Wolf" in a label counts as "wolf".
 *
 * Public anything is always a leak, even when every seat is allowed: public
 * state also reaches whoever joins later. Call it at each step of a scripted
 * game, up to the phase where the secret is meant to come out.
 *
 *   expect(findLeaks({ def, state, events, players, secret: "wolf", allowed: wolves })).toEqual([]);
 */
export function findLeaks<S>(opts: {
  def: Pick<AnyGameDefinition, "getPublicState" | "getPrivateState">;
  state: S;
  events?: GameEventEnvelope<unknown>[];
  players: string[];
  secret: string;
  allowed: string[];
}): string[] {
  const { def, state, events = [], players, allowed } = opts;
  const secret = opts.secret.toLowerCase();
  const has = (value: unknown) => (JSON.stringify(value) ?? "").toLowerCase().includes(secret);
  const out: string[] = [];

  if (has(def.getPublicState(state))) out.push("public state");
  for (const id of players) {
    if (!allowed.includes(id) && has(def.getPrivateState(state, id))) out.push(`private state of ${id}`);
  }
  events.forEach((e, i) => {
    if (!has(e.event)) return;
    if (e.visibility.kind === "public") out.push(`public event #${i}`);
    else if (!allowed.includes(e.visibility.playerId)) out.push(`private event #${i} to ${e.visibility.playerId}`);
  });
  return out;
}
