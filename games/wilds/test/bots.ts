import { seededRandomInt, type GameContext } from "@games/game-core";
import { distance, neighbours, reachable } from "../shared/hex.ts";
import { passable } from "../shared/maps.ts";
import { N } from "../shared/numbers.ts";
import { percent, ROLE_ATTRS } from "../shared/roll.ts";
import { RUINS } from "../shared/ruins.ts";
import type {
  Card, Plan, PublicExplorer, PublicTile, Role, RuinId, TileId, WildsPrivateState, WildsPublicState,
  WildsServerState, WildsSettings,
} from "../shared/types.ts";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import { wildsGame as g } from "../server/game.ts";

// Simple bots for the balance check. Each one sees only the public state and its own private
// state. It picks 2 cards in priority order (task 8 brief), simulating where card 1 leaves it:
// 1. a down ally within 1: Help them;
// 2. the spider next to you and a Torch in the bag: Torch it;
// 3. on or next to an open ruin without a stone: Act (Force once sun >= limit - 3, else the
//    approach with the better odds, the Normal way);
// 4. 3 stones: on the shut gate, Act; gate open, Move to it (or next to it), then Guard;
// 5. below 2 Hearts with a Medkit: Medkit yourself;
// 6. else Move along the shortest path (fog counts as open ground) toward the nearest ruin
//    without a stone (the gate once all 3 are found). No step that gets closer: Look.
//
// Three additions to the brief's list, each because the plain bot was too dumb for a band:
// - While an ally is down, the up player nearest to them Moves toward them in rule 6 (the spec's
//   bot "helps anyone down"). Without it a far-off down player never gets up, and a 2-player
//   game is lost the moment anyone drops.
// - Equal Move choices go round the table by seat. Without it every bot computes the same path
//   and the whole group walks as one stack, so one fire spread or one bite downs everyone.
// - Seats take roles in ROLE_CYCLE order, so every table has a Runner. A random start in the
//   cycle left half the 2-player tables without one, and the Runner alone swung those games.
// Votes: Accept a bargain if anyone is down, or (stone hand) a bridge is broken. Else Refuse.
// Other choices: option 0.

type Pub = WildsPublicState;
type Open = Extract<PublicTile, { open: true }>;

const GUARD: Card = { kind: "guard" };
export const ROLE_CYCLE: Role[] = ["runner", "fixer", "protector", "guide"];

function tileMap(pub: Pub): Map<TileId, PublicTile> {
  return new Map(pub.tiles.map((t) => [t.id, t]));
}

const openTile = (m: Map<TileId, PublicTile>, id: TileId): Open | null => {
  const t = m.get(id);
  return t && t.open ? t : null;
};

/** Steps from every tile to `to`, with fog taken as walkable. */
function distTo(m: Map<TileId, PublicTile>, to: TileId): Map<TileId, number> {
  const d = new Map<TileId, number>([[to, 0]]);
  let frontier = [to];
  const ok = (id: TileId): boolean => {
    const t = m.get(id);
    if (!t) return false;
    if (!t.open) return true;
    return passable(t.terrain) && t.fire === 0;
  };
  while (frontier.length) {
    const next: TileId[] = [];
    for (const c of frontier) {
      for (const n of neighbours(c)) {
        if (d.has(n) || !ok(n)) continue;
        d.set(n, d.get(c)! + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return d;
}

/** Steps from `t` in a `distTo` map. A burning tile has no entry of its own: go by its neighbours. */
function stepsFrom(d: Map<TileId, number>, t: TileId): number {
  const own = d.get(t);
  if (own !== undefined) return own;
  return 1 + Math.min(Infinity, ...neighbours(t).map((n) => d.get(n) ?? Infinity));
}

function ruinTiles(pub: Pub): Map<RuinId, TileId> {
  const out = new Map<RuinId, TileId>();
  for (const t of pub.tiles) {
    if (t.open && t.ruin) out.set(t.ruin, t.id);
    else if (!t.open && t.marker && t.marker !== "gate") out.set(t.marker, t.id);
  }
  return out;
}

function gateTile(pub: Pub): TileId {
  for (const t of pub.tiles) {
    if (t.open && t.terrain === "gate") return t.id;
    if (!t.open && t.marker === "gate") return t.id;
  }
  return "0,0";
}

function bestApproach(role: Role | null, ruin: RuinId): 0 | 1 {
  const [a, b] = RUINS[ruin].approaches;
  const p = (x: typeof a) => percent(role ? ROLE_ATTRS[role][x.attr] : 0, x.need);
  return p(b) > p(a) ? 1 : 0;
}

interface Self { tile: TileId; items: string[]; hearts: number }

function pickCard(pub: Pub, me: PublicExplorer, self: Self, beat: number, used: Set<string>): Card {
  const m = tileMap(pub);
  const allies = pub.explorers.filter((e) => e.id !== me.id && !e.left);

  // 1. Help a down ally next to you.
  const down = allies.find((e) => e.down && !used.has(`help:${e.id}`) && distance(e.tile, self.tile) <= 1);
  if (down) { used.add(`help:${down.id}`); return { kind: "help", who: down.id }; }

  // 2. Torch the spider next to you.
  const spider = pub.spider?.tile;
  if (spider && self.items.includes("torch") && distance(spider, self.tile) === 1 && !used.has("torch")) {
    used.add("torch");
    self.items = self.items.filter((i, k) => !(i === "torch" && k === self.items.indexOf("torch")));
    return { kind: "item", item: "torch", at: spider };
  }

  const ruins = ruinTiles(pub);
  const missing = [...ruins].filter(([r]) => !pub.stones.includes(r));

  // 3. A ruin without its stone, on it or next to it.
  for (const [ruin, at] of missing) {
    if (used.has(`act:${ruin}`)) continue;
    if (distance(at, self.tile) > 1) continue;
    // Card 2 after a Move: the ruin opens once the move lands next to it.
    if (beat === 0 && !openTile(m, at)) continue;
    used.add(`act:${ruin}`);
    if (pub.half.includes(ruin)) return { kind: "act", at };
    if (pub.sun >= pub.sunLimit - 3) return { kind: "act", at, approach: "force" };
    return { kind: "act", at, approach: bestApproach(me.role, ruin), way: "normal" };
  }

  // 4. The gate.
  const gate = gateTile(pub);
  if (missing.length === 0) {
    if (!pub.gateOpen && self.tile === gate && !used.has("gate")) {
      used.add("gate");
      return { kind: "act", at: gate };
    }
    if (pub.gateOpen && distance(self.tile, gate) <= 1) return GUARD;
  }

  // 5. Medkit.
  if (self.hearts < 2 && self.items.includes("medkit")) {
    self.items = self.items.filter((i, k) => !(i === "medkit" && k === self.items.indexOf("medkit")));
    self.hearts = Math.min(N.hearts, self.hearts + N.medkit);
    return { kind: "item", item: "medkit", who: me.id };
  }

  // 6. Move toward the target, or Look.
  return moveOn(pub, m, me, self);
}

/**
 * The Move toward this bot's target: the nearest down ally it should fetch, else the nearest ruin
 * without a stone, else the gate. No reachable tile is closer: Look.
 */
function moveOn(pub: Pub, m: Map<TileId, PublicTile>, me: PublicExplorer, self: Self): Card {
  const spider = pub.spider?.tile;
  const missing = [...ruinTiles(pub)].filter(([r]) => !pub.stones.includes(r));
  let target: TileId | null = null;
  let dist: Map<TileId, number> | null = null;
  // A down ally is mine to fetch when no other up player stands nearer (ties to the lower seat).
  const up = pub.explorers.filter((e) => !e.left && !e.down);
  const downAllies = pub.explorers.filter((e) => !e.left && e.down).filter((d) => {
    const mine = distance(self.tile, d.tile);
    return up.every((o) => o.id === me.id || distance(o.tile, d.tile) > mine
      || (distance(o.tile, d.tile) === mine && pub.explorers.indexOf(o) > pub.explorers.indexOf(me)));
  }).map((e) => e.tile);
  if (downAllies.length === 0 && missing.length === 0) {
    target = gateTile(pub);
    dist = distTo(m, target);
  } else {
    let best = Infinity;
    for (const at of downAllies.length > 0 ? downAllies : missing.map(([, t]) => t)) {
      const d = distTo(m, at);
      const here = stepsFrom(d, self.tile);
      if (here < best) { best = here; target = at; dist = d; }
    }
  }
  if (!target || !dist) return { kind: "look" };
  const range = me.role === "runner" ? N.runnerMove : N.move;
  const canEnter = (id: TileId): boolean => {
    const t = openTile(m, id);
    return !!t && passable(t.terrain) && t.fire === 0 && id !== spider;
  };
  const options = reachable(self.tile, range, canEnter, (id) => openTile(m, id)?.terrain === "reeds");
  const here = stepsFrom(dist, self.tile);
  let best: TileId[] = [];
  let bestD = here;
  for (const [to] of options) {
    if (to === self.tile) continue;
    const d = dist.get(to) ?? Infinity;
    if (d < bestD) { bestD = d; best = [to]; }
    else if (d === bestD && best.length > 0) best.push(to);
  }
  if (best.length === 0) return { kind: "look" };
  // Equal choices go round the table by seat, so the group doesn't walk as one stack.
  const bestTo = best[pub.explorers.indexOf(me) % best.length]!;
  self.tile = bestTo;
  return { kind: "move", to: bestTo };
}

export function botPlan(pub: Pub, _priv: WildsPrivateState, id: string): Plan {
  const me = pub.explorers.find((e) => e.id === id)!;
  const self: Self = { tile: me.tile, items: [...me.items], hearts: me.hearts };
  const used = new Set<string>();
  const a = pickCard(pub, me, self, 0, used);
  const b = pickCard(pub, me, self, 1, used);
  return [a, b];
}

export function botVote(pub: Pub): number {
  const ev = pub.event;
  if (!ev || !ev.options) return 0;
  if (ev.id !== "stone-hand" && ev.id !== "warm-spring") return 0;
  const anyDown = pub.explorers.some((e) => !e.left && e.down);
  const broken = pub.tiles.some((t) => t.open && t.terrain === "broken");
  if (anyDown || (ev.id === "stone-hand" && broken)) return 0;
  return 1;
}

// ---- a whole game ----------------------------------------------------------

export interface GameRun {
  win: boolean;
  /** The round the game ended on. */
  rounds: number;
  /** Some tile caught fire. */
  fire: boolean;
  /** Some player went down. */
  down: boolean;
}

/** One whole game of `n` bots, seeded. Seats take the roles in ROLE_CYCLE order. */
export function playGame(n: number, seed: number, settings: Partial<WildsSettings> = {}): GameRun {
  const rnd = seededRandomInt(seed);
  const ctx = (now: number): GameContext => ({ now, randomInt: rnd, hostId: "p0" });
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  let s = g.createGame(players, { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(0)).state;
  let fire = false;
  let down = false;
  let seen: WildsServerState["lastRound"] = null;
  const act = (id: string, action: unknown): void => {
    const parsed = g.parseAction(action);
    if (!parsed) throw new Error(`bad action ${JSON.stringify(action)}`);
    const r = g.handleAction(s, id, parsed, ctx(s.deadline - 1000));
    if (!r.ok) throw new Error(`${id} ${JSON.stringify(action)}: ${r.error.message}`);
    s = r.transition.state;
  };
  for (let guard = 0; guard < 500 && s.phase !== "over"; guard++) {
    const live = s.world.explorers.filter((e) => !e.left);
    if (s.phase === "roles") {
      live.forEach((e, i) => act(e.id, { type: "pick-role", role: ROLE_CYCLE[i % ROLE_CYCLE.length] }));
    } else if (s.phase === "plan") {
      const pub = g.getPublicState(s);
      for (const e of live) {
        if (e.down || s.phase !== "plan") continue;
        act(e.id, { type: "set-plan", plan: botPlan(pub, g.getPrivateState(s, e.id), e.id) });
        act(e.id, { type: "ready" });
      }
    } else if (s.phase === "choice") {
      const pub = g.getPublicState(s);
      for (const id of [...(s.ballot?.eligible ?? [])]) {
        if (s.phase !== "choice") break;
        act(id, { type: "vote", option: botVote(pub) });
      }
    } else if (s.phase === "report") {
      // Counted from the server's full log: fire or a fall in the fog still counts.
      if (s.lastRound && s.lastRound !== seen) {
        seen = s.lastRound;
        for (const st of s.lastRound.steps) {
          if (st.t === "lit") fire = true;
          if (st.t === "down") down = true;
        }
      }
      for (const e of live) if (s.phase === "report") act(e.id, { type: "next" });
    }
  }
  if (s.phase !== "over") throw new Error(`game ${n}/${seed} did not end`);
  return { win: s.end === "win", rounds: s.world.round, fire, down };
}
