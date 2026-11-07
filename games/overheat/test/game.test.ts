import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import { ROUND_END_MS } from "../shared/types.ts";
import { act, ctx, err, find, ok, players, stateWith, types } from "./helpers.ts";

const cfg = { target: 150, powers: "off" } as const;
const byId = (s: ReturnType<typeof stateWith>, id: string) => s.players.find((p) => p.id === id)!;

describe("core", () => {
  it("creates a game with a rigged deck, first player from the dealer seat", () => {
    const t = oh.createGame(players(3), cfg, { roundNumber: 1, dealerSeat: 1 }, ctx(), { deck: ["R5", "B4"] });
    const pub = oh.getPublicState(t.state);
    expect(pub.currentPlayerId).toBe("p1");
    expect(pub.gauge).toBeGreaterThanOrEqual(18);
    expect(pub.gauge).toBeLessThanOrEqual(30);
    expect(types(t)).toEqual(["round-start"]);
    expect(pub.deckCount).toBe(2);
    expect(pub).not.toHaveProperty("deck");
    expect(pub).not.toHaveProperty("discard");
  });

  it("builds and shuffles a full deck when none is given", () => {
    const t = oh.createGame(players(2), cfg, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(t.state.deck).toHaveLength(72);
  });

  it("throws on a bad rigged code", () => {
    expect(() => oh.createGame(players(2), cfg, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: ["Z9"] })).toThrow();
  });

  it("rejects out-of-range player counts", () => {
    expect(() => oh.createGame(players(1), cfg, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
    expect(() => oh.createGame(players(9), cfg, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–8/);
  });

  it("validates settings and actions", () => {
    expect(oh.parseSettings({ target: 120 })).toBeNull();
    expect(oh.parseAction({ type: "bank" })).toEqual({ type: "bank" });
    expect(oh.parseAction({ type: "fly" })).toBeNull();
  });

  it("makes you flip before banking, then flips a card and passes the turn", () => {
    const s = stateWith({ deck: ["R5"] });
    expect(err(act(s, "p0", { type: "bank" }))).toBe("must-flip");
    const t = ok(act(s, "p0", { type: "flip" }));
    const p0 = byId(t.state, "p0");
    expect(p0.engine.map((e) => e.card.value)).toEqual([5]);
    expect(p0.heat).toBe(5);
    expect(oh.getPublicState(t.state).currentPlayerId).toBe("p1");
    expect(find(t, "flip")).toMatchObject({ playerId: "p0", heat: 5 });
  });

  it("busts only when heat is strictly over the gauge", () => {
    const s = stateWith({ deck: ["G5"], players: [{ heat: 20 }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p0")).toMatchObject({ status: "busted", roundPoints: 0 });
    expect(find(t, "bust")).toMatchObject({ heat: 25, gauge: 24 });
  });

  it("redlines and banks at exactly the gauge", () => {
    const s = stateWith({ deck: ["G5"], players: [{ heat: 19 }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    const p0 = byId(t.state, "p0");
    expect(p0.status).toBe("banked");
    expect(p0.roundPoints).toBe(5 + 10); // engine is just G5: the 19 heat has no cards behind it
    expect(types(t)).toEqual(expect.arrayContaining(["redline", "bank"]));
  });

  it("pays 24 + 10 + bonus on a real redline", () => {
    const s = stateWith({ deck: ["G5"], players: [{ engine: ["R9", "R8", "R2"] }] });
    // heat is 19 from the engine; G5 makes 24. Bonus: 3 reds = 5.
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p0").roundPoints).toBe(24 + 10 + 5);
  });

  it("adds colour and rainbow bonuses at bank", () => {
    const s = stateWith({ players: [{ engine: ["R1", "R2", "R3", "A1", "B1", "G1"], flipped: true }] });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(byId(t.state, "p0").roundPoints).toBe(9 + 5 + 5);
    expect(byId(t.state, "p0").score).toBe(19);
  });

  it("ends the round when nobody is flipping, then starts the next", () => {
    const s = stateWith({
      first: 0,
      players: [{ engine: ["R3"], flipped: true }, { status: "banked" }, { status: "busted" }],
    });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(t.state.step).toBe("round-end");
    expect(t.timers).toEqual([{ kind: "set", timerId: "next-round", delayMs: ROUND_END_MS }]);
    expect(t.state.roundEndsAt).toBe(ROUND_END_MS);
    expect(types(t)).toContain("round-end");
    const t2 = oh.onTimer!(t.state, "next-round", ctx());
    expect(t2.state.round).toBe(2);
    expect(t2.state.firstIndex).toBe(1);
    expect(t2.state.turnIndex).toBe(1);
    expect(t2.state.step).toBe("turn");
    expect(t2.state.players.every((p) => p.status === "flipping" && p.engine.length === 0 && p.heat === 0)).toBe(true);
    expect(t2.state.discard.length).toBeGreaterThanOrEqual(1);
    expect(types(t2)[0]).toBe("round-start");
  });

  it("reshuffles the discard when the deck runs out", () => {
    const s = stateWith({ deck: [], discard: ["B7"] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p0").engine.map((e) => e.card.value)).toEqual([7]);
    expect(types(t)).toContain("reshuffle");
  });

  it("ends the game when a score reaches the target", () => {
    const s = stateWith({
      players: [{ score: 140, engine: ["R7", "A5"], flipped: true }, { status: "banked" }, { status: "busted" }],
    });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(t.state.phase).toBe("finished");
    expect(t.state.winnerIds).toEqual(["p0"]);
    expect((t.timers ?? []).some((x) => x.kind === "set")).toBe(false);
    expect(types(t)).toContain("game-over");
    expect(oh.getResult(t.state)!.standings[0]).toMatchObject({ playerId: "p0", label: "152 pts" });
  });

  it("shares the win on equal top scores", () => {
    const s = stateWith({
      players: [{ score: 140, engine: ["R7", "A5"], flipped: true }, { score: 152, status: "banked" }, { status: "busted" }],
    });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(t.state.winnerIds.sort()).toEqual(["p0", "p1"]);
  });

  it("rejects actions out of turn, after the end, and during the round-end pause", () => {
    const s = stateWith({ deck: ["R5"] });
    expect(err(act(s, "p1", { type: "flip" }))).toBe("not-your-turn");
    expect(err(act(s, "nobody", { type: "flip" }))).toBe("not-in-game");
    expect(err(act({ ...s, step: "round-end" }, "p0", { type: "flip" }))).toBe("round-over");
    expect(err(act({ ...s, step: "choosing" }, "p0", { type: "flip" }))).toBe("choosing");
    expect(err(act({ ...s, step: "choosing" }, "p0", { type: "bank" }))).toBe("choosing");
    expect(err(act({ ...s, phase: "finished" }, "p0", { type: "flip" }))).toBe("game-finished");
  });

  it("awaits the current player only during a turn", () => {
    const s = stateWith();
    expect(oh.getAwaitedPlayerIds(s)).toEqual(["p0"]);
    expect(oh.getAwaitedPlayerIds({ ...s, step: "round-end" })).toEqual([]);
  });
});
