import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { treasureHuntGame as th } from "../server/game.ts";
import { READY_TIMEOUT_MS, type THState } from "../shared/types.ts";

const ctx = (extra: Partial<GameContext> = {}): GameContext => ({ now: 1000, randomInt: seededRandomInt(7), hostId: "p0", ...extra });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const make = (n = 2) => th.createGame(players(n), {}, { roundNumber: 1, dealerSeat: 0 }, ctx());
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

function act(state: THState, id: string, action: Parameters<typeof th.handleAction>[2], c = ctx()) {
  const r = th.handleAction(state, id, action, c);
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}

describe("treasure hunt server", () => {
  it("creates in generating with a layout and the ready timer", () => {
    const t = make();
    expect(t.state.phase).toBe("generating");
    expect(t.state.layout.seed).toBe(t.state.seed);
    expect(t.state.seed).toBeGreaterThanOrEqual(0);
    expect(t.state.seed).toBeLessThan(2 ** 31);
    expect(t.state.players.every((p) => !p.ready)).toBe(true);
    expect(t.timers).toEqual([{ kind: "set", timerId: "ready-timeout", delayMs: READY_TIMEOUT_MS }]);
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(["p0", "p1"]);
  });

  it("starts exploring when everyone is ready, and cancels the timer", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    expect(t.state.phase).toBe("generating");
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    t = act(t.state, "p1", { type: "ready" }, ctx({ now: 5000 }));
    expect(t.state.phase).toBe("exploring");
    expect(t.state.startedAt).toBe(5000);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "explore-start", spectators: [] }]);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "ready-timeout" });
    expect(th.getAwaitedPlayerIds(t.state)).toEqual([]);
  });

  it("timeout turns the unready into spectators and starts", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    t = th.onTimer!(t.state, "ready-timeout", ctx({ now: 9000 }));
    expect(t.state.phase).toBe("exploring");
    expect(t.state.players.find((p) => p.id === "p1")!.spectator).toBe(true);
    expect(t.state.players.find((p) => p.id === "p0")!.spectator).toBe(false);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "explore-start", spectators: ["p1"] }]);
    expect(t.state.startedAt).toBe(9000);
  });

  it("ignores the timer outside generating", () => {
    let t = make(1);
    t = act(t.state, "p0", { type: "ready" });
    const after = th.onTimer!(t.state, "ready-timeout", ctx());
    expect(after.state).toEqual(t.state);
    expect(after.events).toEqual([]);
  });

  it("accepts a late or repeated ready as a no-op", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    t = act(t.state, "p1", { type: "ready" });
    const late = act(t.state, "p1", { type: "ready" }, ctx({ now: 99999 }));
    expect(late.state).toEqual(t.state);
    expect(late.events).toEqual([]);
    const dup = make();
    const a = act(dup.state, "p0", { type: "ready" });
    expect(act(a.state, "p0", { type: "ready" }).state).toEqual(a.state);
  });

  it("rejects end from a non-host", () => {
    const t = act(act(make().state, "p0", { type: "ready" }).state, "p1", { type: "ready" });
    const r = th.handleAction(t.state, "p1", { type: "end" }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: "not-host" } });
  });

  it("rejects end while generating", () => {
    const r = th.handleAction(make().state, "p0", { type: "end" }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: "not-exploring" } });
  });

  it("host ends an exploring round", () => {
    let t = act(act(make().state, "p0", { type: "ready" }).state, "p1", { type: "ready" });
    t = act(t.state, "p0", { type: "end" }, ctx({ now: 7777 }));
    expect(t.state.phase).toBe("finished");
    expect(t.state.endedAt).toBe(7777);
    expect(types(t)).toEqual(["ended"]);
    expect(th.getResult(t.state)).toEqual({ winnerIds: [], standings: [], headline: "Exploring is over." });
  });

  it("getResult is null before the end", () => {
    expect(th.getResult(make().state)).toBeNull();
  });

  it("removing the last unready player starts the round", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    t = th.onPlayerRemoved!(t.state, "p1", ctx({ now: 4000 }));
    expect(t.state.phase).toBe("exploring");
    expect(types(t)).toEqual(["player-removed", "explore-start"]);
    expect(t.state.players.find((p) => p.id === "p1")!.removed).toBe(true);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "ready-timeout" });
  });

  it("finishes when no players are left", () => {
    let t = make(1);
    t = th.onPlayerRemoved!(t.state, "p0", ctx());
    expect(t.state.phase).toBe("finished");
    expect(th.getResult(t.state)).not.toBeNull();
  });

  it("public state carries the layout", () => {
    const t = make();
    const pub = th.getPublicState(t.state);
    expect(pub.layout).toEqual(t.state.layout);
    expect(pub.layout.macro.heights.length).toBe(61 * 61);
    expect(pub).not.toHaveProperty("seed");
  });

  it("is deterministic for a given RNG", () => {
    expect(make().state.seed).toBe(make().state.seed);
  });

  it("parseAction rejects unknown shapes", () => {
    expect(th.parseAction({ type: "ready" })).toEqual({ type: "ready" });
    expect(th.parseAction({ type: "end" })).toEqual({ type: "end" });
    for (const bad of [null, undefined, 3, "ready", [], {}, { type: "nope" }, { type: 1 }]) expect(th.parseAction(bad)).toBeNull();
  });

  it("parseSettings accepts empty and rejects junk", () => {
    expect(th.parseSettings(undefined)).toEqual({});
    expect(th.parseSettings({})).toEqual({});
    expect(th.parseSettings(5)).toBeNull();
  });
});
