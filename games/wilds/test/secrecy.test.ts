import type { GameEventEnvelope } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import type { Plan, Step, WildsPublicState } from "../shared/types.ts";
import { act, g, GG, nextAll, ok, type S, start, type T, voteAll } from "./helpers.ts";

const LOOK: Plan = [{ kind: "look" }, { kind: "look" }];

/** Tiles a step names, for the steps that would say what is in the fog. */
const tilesOf = (s: Step): string[] =>
  s.t === "spider" ? s.path : s.t === "out" ? s.tiles
    : s.t === "noise" || s.t === "lit" || s.t === "burnt" || s.t === "bridge" ? [s.tile] : [];

function sealed(t: { state: S; events: GameEventEnvelope<unknown>[] }, label: string): void {
  const s = t.state;
  const all = s.world.explorers.map((e) => e.id);
  const guides = s.world.explorers.filter((e) => e.role === "guide").map((e) => e.id);
  const check = (secret: string, allowed: string[]) =>
    expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret, allowed }), `${label}: ${secret}`).toEqual([]);
  const pub: WildsPublicState = g.getPublicState(s);

  // Closed tiles: only their id, and smoke or an icon.
  const closed = new Set<string>();
  for (const tile of pub.tiles) {
    if (tile.open) continue;
    closed.add(tile.id);
    for (const k of Object.keys(tile)) expect(["id", "open", "smoke", "marker"], `${label}: ${tile.id}.${k}`).toContain(k);
    expect(s.world.tiles[tile.id]!.open).toBe(false);
  }
  expect(pub.tiles.filter((x) => x.open).length).toBe(s.world.order.filter((x) => s.world.tiles[x]!.open).length);

  // The spider in the fog.
  if (!s.world.tiles[s.world.spider.tile]!.open) expect(pub.spider, label).toBeNull();
  for (const p of pub.spider?.arrow?.path ?? []) expect(closed.has(p), `${label}: arrow into fog`).toBe(false);
  for (const step of pub.lastRound?.steps ?? []) {
    for (const x of tilesOf(step)) expect(closed.has(x), `${label}: ${step.t} on fog ${x}`).toBe(false);
  }

  // The next event: a Guide's alone.
  check('"next":"', guides);
  for (const id of all) {
    const priv = g.getPrivateState(s, id);
    expect("next" in priv, `${label}: next for ${id}`).toBe(guides.includes(id));
  }
  // Party stats, never.
  for (const secret of ["rescues", "firesLit", "stats", "noGoVotes"]) check(secret, []);
  // Plans before the beats.
  if (s.phase === "plan") {
    for (const id of all) {
      const plan = s.plans[id] && JSON.stringify(s.plans[id]);
      if (plan) check(plan, all.filter((x) => s.plans[x] && JSON.stringify(s.plans[x]) === plan));
    }
    // Last round's report may name a Lure that has played; this round's is still a secret.
    const lurers = all.filter((id) => s.plans[id]?.some((c) => c.kind === "item" && c.item === "lure"));
    if (lurers.length) check('"item":"lure"', lurers);
  }
  // An open ballot: who voted, never what.
  if (s.ballot) for (const [id, v] of Object.entries(s.ballot.votes)) check(`"vote":${v}`, [id]);
}

function play(roles: Record<string, string>, seed: number): T {
  let t: T = start(3, { sunLimit: 8 }, seed);
  const step = (next: T, label: string) => { sealed(next, label); t = next; };
  sealed(t, "start");
  for (const [id, role] of Object.entries(roles)) step(ok(act(t.state, id, { type: "pick-role", role })), `role ${id}`);
  expect(t.state.phase).toBe("plan");
  for (let r = 0; t.state.phase !== "over" && r < 12; r++) {
    const s = t.state;
    const up = s.world.explorers.filter((e) => !e.left && !e.down);
    // p0 Lures at its own tile, once it has a Lure.
    const p0 = s.world.explorers[0]!;
    if (r === 0) p0.items = ["lure"];
    for (const e of up) {
      const plan: Plan = e.id === "p0" && p0.items.includes("lure")
        ? [{ kind: "item", item: "lure", at: p0.tile }, { kind: "look" }]
        : e.id === "p2" ? GG : LOOK;
      step(ok(act(t.state, e.id, { type: "set-plan", plan })), `round ${r} plan ${e.id}`);
    }
    for (const e of up) {
      if (t.state.phase !== "plan") break;
      step(ok(act(t.state, e.id, { type: "ready" })), `round ${r} ready ${e.id}`);
    }
    if (t.state.phase === "choice") {
      step(ok(act(t.state, "p0", { type: "vote", option: 1 })), `round ${r} vote p0`);
      step(voteAll(t.state, 0), `round ${r} votes`);
    }
    expect(t.state.phase).toBe("report");
    step(nextAll(t.state), `round ${r} next`);
  }
  return t;
}

describe("secrecy", () => {
  it.each([1, 2, 3, 4, 5])("keeps every secret through a game with a Guide (seed %i)", (seed) => {
    const t = play({ p0: "runner", p1: "guide", p2: "protector" }, seed);
    expect(t.state.phase).toBe("over");
  });

  it.each([1, 2, 3])("puts the next event nowhere without a Guide (seed %i)", (seed) => {
    play({ p0: "runner", p1: "fixer", p2: "protector" }, seed);
  });

  it("gives the Guide the next event", () => {
    let s = start(2).state;
    s = ok(act(s, "p0", { type: "pick-role", role: "guide" })).state;
    expect(g.getPrivateState(s, "p0").next).toBe(s.next);
    expect(g.getPrivateState(s, "p1").next).toBeUndefined();
  });

  it("shows the gate and the ruins as icons in the fog", () => {
    const s = start(2).state;
    const pub = g.getPublicState(s);
    const tile = (id: string) => pub.tiles.find((x) => x.id === id)!;
    expect(tile(s.board.gate)).toEqual({ id: s.board.gate, open: false, marker: "gate" });
    for (const [ruin, at] of Object.entries(s.board.ruins)) expect(tile(at)).toEqual({ id: at, open: false, marker: ruin });
  });

  it("shows smoke next to fire in the fog", () => {
    const s = start(2).state;
    const shut = s.world.order.find((x) => !s.world.tiles[x]!.open && x !== s.board.gate && !s.world.tiles[x]!.ruin)!;
    s.world.tiles[shut]!.fire = 2;
    const pub = g.getPublicState(s);
    expect(pub.tiles.find((x) => x.id === shut)).toEqual({ id: shut, open: false, smoke: true });
  });
});
