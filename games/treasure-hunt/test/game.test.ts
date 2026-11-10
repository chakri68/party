import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { treasureHuntSettingFields } from "../shared/rules-text.ts";

const ctx = (extra: Partial<GameContext> = {}): GameContext => ({ now: 1000, randomInt: seededRandomInt(7), hostId: "p0", ...extra });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const make = (n = 2) => th.createGame(players(n), { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx());
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

function act(state: THState, id: string, action: Parameters<typeof th.handleAction>[2], c = ctx()) {
  const r = th.handleAction(state, id, action, c);
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}
/** Everyone ready, then the host (p0) starts. */
const started = (state: THState, c = ctx()) => act(state.players.reduce((s, p) => act(s, p.id, { type: "ready" }, c).state, state), "p0", { type: "start" }, c);

describe("treasure hunt server", () => {
  it("creates in teams with a layout and no timer", () => {
    const t = make();
    expect(t.state.phase).toBe("teams");
    expect(t.state.layout.seed).toBe(t.state.seed);
    expect(t.state.seed).toBeGreaterThanOrEqual(0);
    expect(t.state.seed).toBeLessThan(2 ** 31);
    expect(t.state.players.every((p) => !p.ready)).toBe(true);
    expect(t.timers).toEqual([]);
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(["p0", "p1"]);
  });

  it("everyone ready still waits for the host's start", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    expect(th.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    t = act(t.state, "p1", { type: "ready" }, ctx({ now: 5000 }));
    expect(t.state.phase).toBe("teams");
    expect(t.events).toEqual([]);
    expect(th.getAwaitedPlayerIds(t.state)).toEqual([]);
    t = act(t.state, "p0", { type: "start" }, ctx({ now: 6000 }));
    expect(t.state.phase).toBe("countdown");
    expect(t.state.countdownEndsAt).toBe(6000 + 3000);
    expect(t.events.map((e) => e.event)).toEqual([{ type: "countdown", spectators: [] }]);
  });

  it("a late ready after a solo start is a no-op", () => {
    let t = started(make(1).state);
    const p0 = t.state.players[0]!;
    expect(p0.spectator).toBe(false);
    const pool = t.state.teams[0]!.pool;
    expect(pool.length).toBeGreaterThan(0);
    expect(act(t.state, "p0", { type: "ready" }).state).toEqual(t.state);
    t = th.onTimer!(t.state, "countdown", ctx({ now: 93_000 }));
    expect(t.state.phase).toBe("hunting");
    expect(th.getPrivateState(t.state, "p0").clues.length).toBe(pool.length);
  });

  it("a countdown with no hunters finishes at once", () => {
    // Only reachable through odd states: p0 is a ready spectator.
    const s0 = make(1).state;
    const s = { ...s0, players: s0.players.map((p) => ({ ...p, ready: true, spectator: true })) };
    const t = act(s, "p0", { type: "start" }, ctx({ now: 4000 }));
    expect(t.state.phase).toBe("finished");
    expect(types(t)).toEqual(["ended"]);
  });

  it("a hunt with no hunters finishes at once", () => {
    let t = started(make(1).state);
    expect(t.state.phase).toBe("countdown");
    const s = { ...t.state, players: t.state.players.map((p) => ({ ...p, spectator: true, pool: [] })) };
    t = th.onTimer!(s, "countdown", ctx({ now: 7000 }));
    expect(t.state.phase).toBe("finished");
    expect(types(t)).toEqual(["ended"]);
    expect(t.timers).not.toContainEqual(expect.objectContaining({ kind: "set", timerId: "round" }));
  });

  it("ignores a stale ready-timeout from an M2 room", () => {
    const t = make(1);
    const after = th.onTimer!(t.state, "ready-timeout", ctx());
    expect(after.state).toEqual(t.state);
    expect(after.events).toEqual([]);
  });

  it("accepts a late or repeated ready as a no-op", () => {
    const t = started(make().state);
    const late = act(t.state, "p1", { type: "ready" }, ctx({ now: 99999 }));
    expect(late.state).toEqual(t.state);
    expect(late.events).toEqual([]);
    const dup = make();
    const a = act(dup.state, "p0", { type: "ready" });
    expect(act(a.state, "p0", { type: "ready" }).state).toEqual(a.state);
  });

  it("rejects end from a non-host", () => {
    const t = started(make().state);
    const r = th.handleAction(t.state, "p1", { type: "end" }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: "not-host" } });
  });

  it("rejects end in the teams phase", () => {
    const r = th.handleAction(make().state, "p0", { type: "end" }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: "not-hunting" } });
  });

  it("rejects end in the countdown", () => {
    const t = started(make().state);
    expect(th.handleAction(t.state, "p0", { type: "end" }, ctx())).toMatchObject({ ok: false, error: { code: "not-hunting" } });
  });

  it("host ends a hunting round", () => {
    let t = started(make().state);
    t = th.onTimer!(t.state, "countdown", ctx({ now: 7000 }));
    t = act(t.state, "p0", { type: "end" }, ctx({ now: 7777 }));
    expect(t.state.phase).toBe("finished");
    expect(t.state.endedAt).toBe(7777);
    expect(types(t)).toEqual(["ended"]);
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "round" });
    expect(th.getResult(t.state)).toEqual({
      winnerIds: [],
      standings: [
        { playerId: "p0", value: 0, label: "0 found · Orange" },
        { playerId: "p1", value: 0, label: "0 found · Sky" },
      ],
      headline: "Nobody found a cache.",
    });
  });

  it("getResult is null before the end", () => {
    expect(th.getResult(make().state)).toBeNull();
  });

  it("removing the last unready player does not start the round", () => {
    let t = make();
    t = act(t.state, "p0", { type: "ready" });
    t = th.onPlayerRemoved!(t.state, "p1", ctx({ now: 4000 }));
    expect(t.state.phase).toBe("teams");
    expect(types(t)).toEqual(["player-removed"]);
    expect(t.state.players.find((p) => p.id === "p1")!.removed).toBe(true);
    expect(th.getAwaitedPlayerIds(t.state)).toEqual([]);
  });

  it("finishes when no players are left", () => {
    let t = make(1);
    t = th.onPlayerRemoved!(t.state, "p0", ctx());
    expect(t.state.phase).toBe("finished");
    expect(th.getResult(t.state)).not.toBeNull();
  });

  it("public state carries the seed, not the layout", () => {
    const t = make();
    const pub = th.getPublicState(t.state);
    expect(pub.seed).toBe(t.state.layout.seed);
    expect(pub).not.toHaveProperty("layout");
  });

  it("is deterministic for a given RNG", () => {
    expect(make().state.seed).toBe(make().state.seed);
  });

  it("parseAction rejects unknown shapes", () => {
    expect(th.parseAction({ type: "ready" })).toEqual({ type: "ready" });
    expect(th.parseAction({ type: "end" })).toEqual({ type: "end" });
    expect(th.parseAction({ type: "claim", cacheId: "c3", x: 1 })).toEqual({ type: "claim", cacheId: "c3" });
    for (const bad of [null, undefined, 3, "ready", [], {}, { type: "nope" }, { type: 1 }, { type: "claim" }, { type: "claim", cacheId: 3 }, { type: "claim", cacheId: "c".repeat(40) }])
      expect(th.parseAction(bad)).toBeNull();
  });

  it("parseSettings defaults to Timed, 30 minutes, and rejects junk", () => {
    const d = { mode: "timed", minutes: 30, target: 5 };
    expect(th.parseSettings(undefined)).toEqual(d);
    expect(th.parseSettings({})).toEqual(d);
    for (const m of [15, 30, 60]) expect(th.parseSettings({ minutes: m })).toEqual({ ...d, minutes: m });
    for (const bad of [5, [], { minutes: 20 }, { minutes: "30" }]) expect(th.parseSettings(bad)).toBeNull();
  });

  it("setting fields: a Round length select after Mode", () => {
    const f = treasureHuntSettingFields({ minutes: 60 }, 3).filter((x) => x.key === "minutes");
    expect(f).toEqual([
      {
        key: "minutes",
        label: "Round length",
        selected: 2,
        options: [
          { label: "15 minutes", patch: { minutes: 15 } },
          { label: "30 minutes", patch: { minutes: 30 } },
          { label: "60 minutes", patch: { minutes: 60 } },
        ],
      },
    ]);
    expect(treasureHuntSettingFields(undefined, 1)[1]!.selected).toBe(1);
    expect(treasureHuntSettingFields("junk", 1)[1]!.selected).toBe(1);
  });
});
