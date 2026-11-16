import { TILE_ORDER, coords } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { expect } from "vitest";
import { wildsGame as g } from "../server/game.ts";
import {
  DEFAULT_SETTINGS, type ItemId, type Plan, type Role, type Terrain, type Tile, type TileId, type WildsEvent,
  type WildsServerState, type WildsSettings, type World,
} from "../shared/types.ts";

export interface BlankOpts {
  explorers?: { id: string; tile: TileId; role?: Role; items?: ItemId[]; hearts?: number }[];
  tiles?: Record<TileId, Partial<Tile>>;
  spider?: TileId;
  nest?: TileId;
}

/** A 37-tile all-grass, all-open world with terrain overrides. Spider at "3,0" by default. */
export function blankWorld(map: Partial<Record<TileId, Terrain>> = {}, opts: BlankOpts = {}): World {
  const tiles: World["tiles"] = {};
  for (const id of TILE_ORDER) {
    const { q, r } = coords(id);
    tiles[id] = {
      id, q, r, terrain: map[id] ?? "grass", open: true, fire: 0, noise: 0,
      cache: false, nest: id === (opts.nest ?? "3,0"), ruin: null, litThisTurn: false,
      ...(opts.tiles?.[id] ?? {}),
    };
  }
  return {
    tiles, order: [...TILE_ORDER],
    explorers: (opts.explorers ?? []).map((e) => ({
      id: e.id, role: e.role ?? null, tile: e.tile, hearts: e.hearts ?? N.hearts, items: [...(e.items ?? [])],
      down: false, shield: false, left: false,
    })),
    spider: { tile: opts.spider ?? "3,0", rest: false, still: false },
    stones: [], half: [], gateOpen: false,
    sun: 0, round: 1, sunLimit: 10, speedBonus: 0,
  };
}

// ---- the game half ---------------------------------------------------------

export { g };
export type S = WildsServerState;
export type T = GameTransition<S, WildsEvent>;

export const GG: Plan = [{ kind: "guard" }, { kind: "guard" }];
export const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: "p0" });
export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** A game of n players, in the roles phase. */
export function start(n: number, settings: Partial<WildsSettings> = {}, seed = 1): T {
  return g.createGame(players(n), { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed));
}

/** By default a second before the deadline. */
export const act = (s: S, playerId: string, action: unknown, now = s.deadline - 1000, seed = 1) => {
  const parsed = g.parseAction(action);
  if (!parsed) throw new Error(`parseAction refused ${JSON.stringify(action)}`);
  return g.handleAction(s, playerId, parsed, ctx(now, seed));
};

export function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

export function err(result: ReturnType<typeof act>): string {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

export const ring = (s: S, seed = 1): T => g.onTimer!(s, "phase", ctx(s.deadline, seed));
/** Everyone still in. */
export const ids = (s: S) => s.world.explorers.filter((e) => !e.left).map((e) => e.id);

/** Everyone picks a role (Fixer unless given), and round 1's plan opens. */
export function pickRoles(s: S, roles: Record<string, string> = {}): S {
  for (const id of ids(s)) s = ok(act(s, id, { type: "pick-role", role: roles[id] ?? "fixer" })).state;
  expect(s.phase).toBe("plan");
  return s;
}

/** set-plan then ready for each player named. */
export function planAll(s: S, plans: Record<string, Plan>): T {
  let t: T = { state: s, events: [] };
  for (const [id, plan] of Object.entries(plans)) {
    if (t.state.phase !== "plan") break;
    t = ok(act(t.state, id, { type: "set-plan", plan }));
    t = ok(act(t.state, id, { type: "ready" }));
  }
  return t;
}

/** Everyone still eligible votes `option`. Stops once the vote closes. */
export function voteAll(s: S, option: number, except: Record<string, number> = {}): T {
  let t: T = { state: s, events: [] };
  for (const id of s.ballot?.eligible ?? []) {
    if (t.state.phase !== "choice") break;
    t = ok(act(t.state, id, { type: "vote", option: except[id] ?? option }));
  }
  return t;
}

/** Everyone taps Next in the report. */
export function nextAll(s: S): T {
  let t: T = { state: s, events: [] };
  for (const id of ids(s)) {
    if (t.state.phase !== "report") break;
    t = ok(act(t.state, id, { type: "next" }));
  }
  return t;
}

/** Every explorer who can plans (Guard, Guard unless given), any vote goes to 0, then Next. */
export function round(s: S, plans: Record<string, Plan> = {}): S {
  expect(s.phase).toBe("plan");
  const all: Record<string, Plan> = {};
  for (const e of s.world.explorers) if (!e.left && !e.down) all[e.id] = plans[e.id] ?? GG;
  s = planAll(s, all).state;
  if (s.phase === "choice") s = voteAll(s, 0).state;
  expect(s.phase).toBe("report");
  return nextAll(s).state;
}
