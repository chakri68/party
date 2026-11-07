import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import type { OverheatServerState } from "../shared/types.ts";
import { act, ctx, find, ok, stateWith, types } from "./helpers.ts";

const byId = (s: OverheatServerState, id: string) => s.players.find((p) => p.id === id)!;
const skip = (s: OverheatServerState, id: string, seed = 1) => oh.skipTurn!(s, id, ctx(seed));
const remove = (s: OverheatServerState, id: string) => oh.onPlayerRemoved!(s, id, ctx());

describe("skipTurn", () => {
  it("banks on a normal turn", () => {
    const s = stateWith({ players: [{ engine: ["R5", "B4"], flipped: true }, {}, {}] });
    const t = skip(s, "p0");
    expect(types(t)).toEqual(["turn-skipped", "bank"]);
    expect(byId(t.state, "p0").status).toBe("banked");
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("flips on a first turn", () => {
    const s = stateWith({ deck: ["R5"] });
    const t = skip(s, "p0");
    expect(types(t)).toEqual(["turn-skipped", "flip"]);
    expect(byId(t.state, "p0")).toMatchObject({ flipped: true, status: "flipping", heat: 5 });
  });

  it("picks a valid target for a pending Fuse, the same way every time", () => {
    const s = stateWith({ n: 4, deck: ["fuse"], players: [{}, {}, { status: "banked" }, {}] });
    const pending = ok(act(s, "p0", { type: "flip" })).state;
    const a = skip(pending, "p0", 5);
    const b = skip(pending, "p0", 5);
    const fuse = find(a, "fuse")!;
    expect(["p1", "p3"]).toContain(fuse.targetId);
    expect(find(b, "fuse")!.targetId).toBe(fuse.targetId);
    expect(types(a)[0]).toBe("turn-skipped");
    expect(a.state.step).toBe("turn");
  });

  it("picks real cards for a pending Wrench", () => {
    const s = stateWith({ deck: ["wrench"], players: [{ engine: ["R2", "B3"] }, { engine: ["G4", "A5"] }, { status: "banked" }] });
    const pending = ok(act(s, "p0", { type: "flip" })).state;
    const t = skip(pending, "p0", 3);
    expect(find(t, "wrench")).toMatchObject({ playerId: "p0", targetId: "p1" });
    expect(t.state.step).toBe("turn");
  });

  it("does nothing from a player who isn't awaited", () => {
    const s = stateWith();
    expect(skip(s, "p1")).toEqual({ state: s, events: [] });
    expect(skip(s, "nobody").events).toEqual([]);
    const pending = ok(act(stateWith({ deck: ["fuse"] }), "p0", { type: "flip" })).state;
    expect(skip(pending, "p1").events).toEqual([]);
  });
});

describe("onPlayerRemoved", () => {
  it("is a no-op for an unknown id, a repeat, or a finished game", () => {
    const s = stateWith();
    expect(remove(s, "zz")).toEqual({ state: s, events: [] });
    const gone = remove(s, "p2").state;
    expect(remove(gone, "p2").events).toEqual([]);
    const over = { ...s, phase: "finished" as const };
    expect(remove(over, "p1").events).toEqual([]);
  });

  it("moves the turn on when the current player leaves", () => {
    const t = remove(stateWith(), "p0");
    expect(types(t)).toEqual(["player-removed"]);
    expect(byId(t.state, "p0")).toMatchObject({ removed: true, status: "out" });
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("drops the card when the pending chooser leaves", () => {
    const s = ok(act(stateWith({ deck: ["fuse"] }), "p0", { type: "flip" })).state;
    const t = remove(s, "p0");
    expect(t.state.pending).toBeNull();
    expect(t.state.step).toBe("turn");
    expect(t.state.discard).toHaveLength(1);
    expect(byId(t.state, "p1").fuses).toBe(0);
    expect(byId(t.state, "p2").fuses).toBe(0);
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("keeps a Shove choice when the turn owner leaves, then moves on past their seat", () => {
    let s = ok(act(stateWith({ n: 4, deck: ["shove", "fuse"] }), "p0", { type: "flip" })).state;
    s = ok(act(s, "p0", { type: "target", targetId: "p2" })).state;
    expect(s.pending).toMatchObject({ kind: "fuse", chooserId: "p2" });
    const t = remove(s, "p0");
    expect(t.state.pending).toMatchObject({ kind: "fuse", chooserId: "p2" });
    expect(oh.getAwaitedPlayerIds(t.state)).toEqual(["p2"]);
    const after = ok(act(t.state, "p2", { type: "target", targetId: "p3" }));
    expect(byId(after.state, "p3").fuses).toBe(1);
    expect(oh.getPublicState(after.state).currentPlayerId).toBe("p1");
  });

  it("fizzles the chooser's card when the only valid target leaves", () => {
    const s = ok(act(stateWith({ deck: ["fuse"], players: [{}, {}, { status: "banked" }] }), "p0", { type: "flip" })).state;
    expect(s.pending).not.toBeNull();
    const t = remove(s, "p1");
    expect(types(t)).toEqual(["player-removed", "fizzle"]);
    expect(t.state.pending).toBeNull();
    expect(t.state.step).toBe("turn");
    expect(t.state.discard).toHaveLength(1);
    // p0 is the only one left flipping, so the turn comes back to them.
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p0");
  });

  it("keeps the choice when another valid target remains", () => {
    const s = ok(act(stateWith({ deck: ["fuse"] }), "p0", { type: "flip" })).state;
    const t = remove(s, "p1");
    expect(t.state.pending).toMatchObject({ kind: "fuse", chooserId: "p0" });
  });

  it("ends the game as abandoned when one player is left", () => {
    const t = remove(stateWith({ n: 2 }), "p1");
    expect(t.state.phase).toBe("finished");
    expect(t.state.endReason).toBe("abandoned");
    expect(types(t)).toEqual(["player-removed", "game-over"]);
  });
});

describe("rounds", () => {
  it("rotates the first player across round ends and skips a removed seat", () => {
    let s = stateWith({ n: 4, first: 0, players: [{}, {}, {}, {}] });
    const endRound = (st: OverheatServerState) => {
      const banked = { ...st, players: st.players.map((p) => ({ ...p, status: p.removed ? p.status : ("banked" as const) })), step: "round-end" as const };
      return oh.onTimer!(banked, "next-round", ctx()).state;
    };
    s = endRound(s);
    expect(s.firstIndex).toBe(1);
    expect(oh.getPublicState(s).currentPlayerId).toBe("p1");
    s = remove(s, "p2").state;
    s = endRound(s);
    expect(s.firstIndex).toBe(3);
    expect(oh.getPublicState(s).currentPlayerId).toBe("p3");
    expect(byId(s, "p2").status).toBe("out");
  });
});

describe("getResult", () => {
  it("labels scores as points", () => {
    const s = stateWith({ players: [{ score: 142 }, { score: 90 }] });
    const done = { ...s, phase: "finished" as const, winnerIds: ["p0"] };
    expect(oh.getResult(done)!.standings[0]).toMatchObject({ playerId: "p0", value: 142, label: "142 pts" });
  });
});
