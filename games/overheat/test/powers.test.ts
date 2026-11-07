import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import type { OverheatServerState } from "../shared/types.ts";
import { act, err, find, ok, stateWith, types } from "./helpers.ts";

const byId = (s: OverheatServerState, id: string) => s.players.find((p) => p.id === id)!;
const cardId = (s: OverheatServerState, id: string, k = 0) => byId(s, id).engine[k]!.card.id;
const evs = (t: { events: { event: { type: string } }[] }, type: string) =>
  t.events.map((e) => e.event as { type: string; playerId?: string }).filter((e) => e.type === type);

describe("powers", () => {
  it("Vent cools by 5, floors at 0, and leaves points alone", () => {
    const s = stateWith({ n: 3, deck: ["vent"], players: [{ engine: ["R3"] }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    const p0 = byId(t.state, "p0");
    expect(p0.heat).toBe(0);
    expect(p0.engine.map((e) => e.card.value)).toEqual([3]);
    expect(find(t, "vent")).toMatchObject({ playerId: "p0", heat: 0 });
    expect(t.state.discard.map((c) => c.kind === "power" && c.power)).toEqual(["vent"]);
  });

  it("Turbo doubles the next number card's heat and points", () => {
    const s = stateWith({ deck: ["turbo", "R6"], players: [{}, { status: "banked" }] });
    let t = ok(act(s, "p0", { type: "flip" }));
    expect(find(t, "turbo")).toMatchObject({ playerId: "p0" });
    expect(byId(t.state, "p0").turbo).toBe(true);
    t = ok(act(t.state, "p0", { type: "flip" }));
    const p0 = byId(t.state, "p0");
    expect(p0.engine[0]!.mult).toBe(2);
    expect(p0.heat).toBe(12);
    expect(p0.turbo).toBe(false);
    expect(find(t, "flip")).toMatchObject({ mult: 2, heat: 12 });
    t = ok(act(t.state, "p0", { type: "bank" }));
    expect(byId(t.state, "p0").roundPoints).toBe(12);
  });

  it("a second Turbo does nothing extra", () => {
    let s = stateWith({ deck: ["turbo", "turbo", "R6", "R6"], players: [{}, { status: "banked" }] });
    for (let i = 0; i < 4; i++) s = ok(act(s, "p0", { type: "flip" })).state;
    const p0 = byId(s, "p0");
    expect(p0.engine.map((e) => e.mult)).toEqual([2, 1]);
    expect(p0.heat).toBe(18);
  });

  it("Shove puts a number card into the target and can bust them", () => {
    const s = stateWith({ deck: ["shove", "R2"], players: [{}, { heat: 26, gauge: 27 }, {}] });
    let t = ok(act(s, "p0", { type: "flip" }));
    expect(t.state.step).toBe("choosing");
    expect(t.state.pending).toMatchObject({ kind: "shove", chooserId: "p0" });
    expect(oh.getAwaitedPlayerIds(t.state)).toEqual(["p0"]);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(types(t)).toEqual(["shove", "flip", "bust"]);
    expect(find(t, "flip")).toMatchObject({ playerId: "p1", by: "p0", heat: 28 });
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(t.state.step).toBe("turn");
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p2");
  });

  it("Shove into a Turbo'd target doubles the card", () => {
    const s = stateWith({ deck: ["shove", "R2"], players: [{}, { turbo: true }, {}] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1")).toMatchObject({ heat: 4, turbo: false });
  });

  it("Shove that flips a Vent cools the target", () => {
    const s = stateWith({ deck: ["shove", "vent"], players: [{}, { engine: ["R9"] }, {}] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1").heat).toBe(4);
    expect(find(t, "vent")).toMatchObject({ playerId: "p1" });
  });

  it("Shove that flips a Fuse makes the target choose, then the turn passes from the flipper", () => {
    const s = stateWith({ deck: ["shove", "fuse"] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p2" }));
    expect(t.state.step).toBe("choosing");
    expect(t.state.pending).toMatchObject({ kind: "fuse", chooserId: "p2" });
    expect(oh.getAwaitedPlayerIds(t.state)).toEqual(["p2"]);
    expect(oh.getPublicState(t.state).awaitedId).toBe("p2");
    expect(err(act(t.state, "p0", { type: "target", targetId: "p1" }))).toBe("not-choosing");
    t = ok(act(t.state, "p2", { type: "target", targetId: "p0" }));
    expect(find(t, "fuse")).toMatchObject({ playerId: "p2", targetId: "p0", fuses: 1 });
    expect(byId(t.state, "p0").fuses).toBe(1);
    expect(t.state.step).toBe("turn");
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
    expect(t.state.discard).toHaveLength(2);
  });

  it("Shove into a target that redlines still passes the turn from the flipper", () => {
    const s = stateWith({ deck: ["shove", "R2"], players: [{}, {}, { heat: 22 }] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p2" }));
    expect(byId(t.state, "p2").status).toBe("banked");
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("Wrench swaps the chosen cards with their mult and rechecks both", () => {
    const s = stateWith({
      deck: ["wrench"],
      players: [{ engine: ["R9"], mult2: [0] }, { engine: ["B1"], heat: 20 }, {}],
    });
    expect(s.players[0]!.heat).toBe(18);
    let t = ok(act(s, "p0", { type: "flip" }));
    expect(t.state.pending).toMatchObject({ kind: "wrench", chooserId: "p0" });
    const mine = cardId(s, "p0");
    const theirs = cardId(s, "p1");
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine, theirs }));
    expect(types(t)).toEqual(["wrench", "bust"]);
    expect(find(t, "wrench")).toMatchObject({ playerId: "p0", targetId: "p1", gave: { mult: 2 }, got: { mult: 1 } });
    expect(byId(t.state, "p0").engine).toEqual([{ card: expect.objectContaining({ id: theirs }), mult: 1 }]);
    expect(byId(t.state, "p1").engine).toEqual([{ card: expect.objectContaining({ id: mine }), mult: 2 }]);
    expect(byId(t.state, "p0").heat).toBe(1);
    expect(byId(t.state, "p1")).toMatchObject({ heat: 37, status: "busted" });
  });

  it("Wrench fizzles when the chooser's engine is empty", () => {
    const s = stateWith({ deck: ["wrench"], players: [{}, { engine: ["B1"] }, {}] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(t.state.step).toBe("turn");
    expect(find(t, "fizzle")).toMatchObject({ playerId: "p0", card: { power: "wrench" } });
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("Wrench floors heat at 0", () => {
    const s = stateWith({ deck: ["wrench"], players: [{ engine: ["R9"], heat: 0 }, { engine: ["B1"] }, {}] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: cardId(s, "p0"), theirs: cardId(s, "p1") }));
    expect(byId(t.state, "p0").heat).toBe(0);
    expect(byId(t.state, "p1").heat).toBe(9);
  });

  it("Fuse ticks at the start of each of the target's turns", () => {
    const s = stateWith({ deck: ["R1"], players: [{}, { fuses: 2, heat: 3 }, {}] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p1").heat).toBe(5);
    expect(find(t, "fuse-tick")).toMatchObject({ playerId: "p1", heat: 5, fuses: 2 });
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("a Fuse card attaches, then ticks at the target's next turn", () => {
    const s = stateWith({ deck: ["fuse", "R1"] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(types(t)).toEqual(["fuse", "fuse-tick"]);
    expect(byId(t.state, "p1").heat).toBe(1);
  });

  it("a fuse tick that hits the gauge redlines and the turn moves on", () => {
    const s = stateWith({ deck: ["R1"], players: [{}, { fuses: 1, heat: 23 }, {}] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p1")).toMatchObject({ status: "banked", redline: true });
    expect(types(t)).toEqual(["flip", "fuse-tick", "redline", "bank"]);
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p2");
  });

  it("a fuse tick that busts the last flipper ends the round", () => {
    const s = stateWith({
      n: 2,
      players: [{ engine: ["R1"], flipped: true }, { fuses: 1, heat: 24 }],
    });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(t.state.step).toBe("round-end");
  });

  it("a lone flipper with a fuse ticks once per turn, not forever", () => {
    const s = stateWith({ n: 2, deck: ["R1"], players: [{ fuses: 1 }, { status: "banked" }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(evs(t, "fuse-tick")).toHaveLength(1);
    expect(byId(t.state, "p0").heat).toBe(2);
  });

  it("Heatwave hits only flipping players, busts in seat order from the flipper", () => {
    const s = stateWith({
      n: 4,
      turn: 1,
      deck: ["heatwave"],
      players: [{ heat: 22 }, { heat: 22 }, { status: "banked", heat: 22 }, { heat: 22 }],
    });
    const t = ok(act(s, "p1", { type: "flip" }));
    expect(find(t, "heatwave")).toMatchObject({ playerId: "p1", hit: ["p1", "p3", "p0"] });
    expect(evs(t, "bust").map((e) => e.playerId)).toEqual(["p1", "p3", "p0"]);
    expect(t.state.players.map((p) => p.gauge)).toEqual([21, 21, 24, 21]);
    expect(t.state.step).toBe("round-end");
  });

  it("an aimed card with every other player out fizzles", () => {
    for (const power of ["shove", "fuse", "wrench"]) {
      const s = stateWith({
        deck: [power],
        players: [{ engine: ["R1"] }, { status: "banked", engine: ["R2"] }, { status: "busted", engine: ["R3"] }],
      });
      const t = ok(act(s, "p0", { type: "flip" }));
      expect(t.state.step).toBe("turn");
      expect(find(t, "fizzle")).toMatchObject({ playerId: "p0", card: { power } });
      expect(t.state.discard).toHaveLength(1);
    }
  });

  it("with deck and discard empty, Flip banks the flipper", () => {
    const s = stateWith({ n: 3, deck: [], players: [{ engine: ["R4"] }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(types(t)).toEqual(["fizzle", "bank"]);
    expect(find(t, "fizzle")).toEqual({ type: "fizzle", playerId: "p0", card: null });
    expect(byId(t.state, "p0")).toMatchObject({ status: "banked", roundPoints: 4 });
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("with deck and discard empty, Shove's draw fizzles", () => {
    const s = stateWith({ deck: ["shove"] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(types(t)).toEqual(["shove", "fizzle"]);
    expect(find(t, "fizzle")).toMatchObject({ card: null });
    expect(byId(t.state, "p1").engine).toEqual([]);
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("rejects hostile choice actions and leaves state unchanged", () => {
    const shove = ok(act(stateWith({ deck: ["shove", "R1"], players: [{}, { status: "banked" }, {}] }), "p0", { type: "flip" })).state;
    const wrench = ok(
      act(stateWith({ deck: ["wrench"], players: [{ engine: ["R1"] }, { engine: ["B2"] }, { engine: ["G3"] }] }), "p0", {
        type: "flip",
      }),
    ).state;
    const cases: [OverheatServerState, string, Parameters<typeof act>[2], string][] = [
      [shove, "p0", { type: "target", targetId: "p0" }, "bad-target"],
      [shove, "p0", { type: "target", targetId: "p1" }, "bad-target"],
      [shove, "p0", { type: "target", targetId: "nobody" }, "bad-target"],
      [shove, "p2", { type: "target", targetId: "p0" }, "not-choosing"],
      [shove, "p0", { type: "wrench", targetId: "p2", mine: 0, theirs: 0 }, "not-choosing"],
      [shove, "p0", { type: "flip" }, "choosing"],
      [shove, "p0", { type: "bank" }, "choosing"],
      [wrench, "p0", { type: "target", targetId: "p1" }, "not-choosing"],
      [wrench, "p0", { type: "wrench", targetId: "p1", mine: cardId(wrench, "p2"), theirs: cardId(wrench, "p1") }, "bad-card"],
      [wrench, "p0", { type: "wrench", targetId: "p1", mine: cardId(wrench, "p0"), theirs: cardId(wrench, "p2") }, "bad-card"],
      [wrench, "p0", { type: "wrench", targetId: "p0", mine: cardId(wrench, "p0"), theirs: cardId(wrench, "p0") }, "bad-target"],
      [stateWith(), "p0", { type: "target", targetId: "p1" }, "not-choosing"],
    ];
    for (const [s, who, a, code] of cases) {
      const before = structuredClone(s);
      expect(err(act(s, who, a))).toBe(code);
      expect(s).toEqual(before);
    }
  });

  it("parses choice actions", () => {
    expect(oh.parseAction({ type: "target", targetId: "p1" })).toEqual({ type: "target", targetId: "p1" });
    expect(oh.parseAction({ type: "wrench", targetId: "p1", mine: 1, theirs: 2 })).toEqual({
      type: "wrench",
      targetId: "p1",
      mine: 1,
      theirs: 2,
    });
    expect(oh.parseAction({ type: "target" })).toBeNull();
    expect(oh.parseAction({ type: "wrench", targetId: "p1", mine: "1", theirs: 2 })).toBeNull();
  });
});
