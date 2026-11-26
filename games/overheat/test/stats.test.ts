import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import { bankScore } from "../shared/rules.ts";
import { BOUNTY, type OverheatServerState } from "../shared/types.ts";
import { act, ctx, find, ok, stateWith, types } from "./helpers.ts";

const CUT = { powers: "cutthroat" as const };
const CLASSIC = { powers: "classic" as const };
const byId = (s: OverheatServerState, id: string) => s.players.find((p) => p.id === id)!;
const playFirst = (s: OverheatServerState, id = "p0") => ok(act(s, id, { type: "play", cardId: s.hands[id]![0]!.id }));
const stats = (s: OverheatServerState) => oh.partyStats!(s);
const lead = (s: OverheatServerState, id: string | null) => ((s.leaderId = id), s);

describe("bounty and pushedOver", () => {
  it("a Push that makes the leader go too hot: +5, a bounty event and pushedOver 1", () => {
    // ids: p1 R9 R9 R5=0..2; deck R5=3; p0 shove=4
    const s = lead(
      stateWith({ n: 3, deck: ["R5"], settings: CUT, players: [{ score: 10, hand: ["shove"] }, { engine: ["R9", "R9", "R5"], score: 30, flipped: true }, {}] }),
      "p1",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(find(t, "bounty")).toEqual({ type: "bounty", playerId: "p0", targetId: "p1", points: BOUNTY });
    expect(types(t).indexOf("bounty")).toBe(types(t).indexOf("bust") + 1);
    expect(byId(t.state, "p0").score).toBe(15);
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a Push that makes someone else go too hot: pushedOver, no bounty", () => {
    const s = lead(
      stateWith({ n: 3, deck: ["R5"], settings: CUT, players: [{ hand: ["shove"] }, { engine: ["R9", "R9", "R5"], flipped: true }, { score: 30 }] }),
      "p2",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(byId(t.state, "p0").score).toBe(0);
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a Burn tick that makes the leader go too hot gives nobody credit", () => {
    const s = lead(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R2"], flipped: true }, { engine: ["R9", "R9", "R5"], fuses: 2, score: 30, flipped: true }] }),
      "p1",
    );
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(stats(t.state)).toEqual({});
  });

  it("your own flip that makes you go too hot gives nobody credit", () => {
    const s = lead(stateWith({ n: 2, deck: ["R5"], settings: CUT, players: [{ engine: ["R9", "R9", "R5"], score: 30 }, {}] }), "p0");
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(byId(t.state, "p0").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(stats(t.state)).toEqual({});
  });

  it("a Push that turns up Limit down credits the pusher for every player it makes go too hot", () => {
    // Limit down drops the limit to 21. p1 (22) and p2 (23) go too hot; p0 (2) does not.
    const s = lead(
      stateWith({
        n: 3,
        deck: ["heatwave"],
        settings: CUT,
        players: [{ engine: ["R2"], flipped: true, hand: ["shove"] }, { engine: ["R9", "R9", "R4"], flipped: true }, { engine: ["R9", "R9", "R5"], score: 30, flipped: true }],
      }),
      "p2",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(byId(t.state, "p2").status).toBe("busted");
    expect(byId(t.state, "p0").status).toBe("flipping");
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 2 } });
    expect(t.events.filter((e) => e.event.type === "bounty")).toHaveLength(1);
    expect(byId(t.state, "p0").score).toBe(5);
  });

  it("Limit down from your own hand credits you for the others, not for yourself", () => {
    const s = stateWith({
      n: 2,
      settings: CUT,
      players: [{ engine: ["R9", "R9", "R4"], flipped: true, hand: ["heatwave"] }, { engine: ["R9", "R9", "R5"], flipped: true }],
    });
    const t = playFirst(s);
    expect(byId(t.state, "p0").status).toBe("busted");
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a Push that turns up a Swap credits the pusher for what the Swap does", () => {
    // ids: p1 R9=0; p2 R9 R9 R1=1..3; deck wrench=4; p0 shove=5
    const s = lead(
      stateWith({
        n: 3,
        deck: ["wrench"],
        settings: CUT,
        players: [{ hand: ["shove"] }, { engine: ["R9"], flipped: true }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }],
      }),
      "p2",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(t.state.pending).toMatchObject({ kind: "wrench", chooserId: "p1", by: "p0" });
    // p1 gives their R9 (id 0) for p2's R1 (id 3): p2 goes to 27.
    t = ok(act(t.state, "p1", { type: "wrench", targetId: "p2", mine: 0, theirs: 3 }));
    expect(byId(t.state, "p2").status).toBe("busted");
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
    expect(find(t, "bounty")).toMatchObject({ playerId: "p0", targetId: "p2" });
  });

  it("a Push that turns up a Push credits the first pusher", () => {
    // ids: p1 R1=0; p2 R9 R9 R5=1..3; deck shove=4 R5=5; p0 shove=6
    const s = lead(
      stateWith({
        n: 3,
        deck: ["shove", "R5"],
        settings: CUT,
        players: [{ hand: ["shove"] }, { engine: ["R1"], flipped: true }, { engine: ["R9", "R9", "R5"], score: 30, flipped: true }],
      }),
      "p2",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(t.state.pending).toMatchObject({ kind: "shove", chooserId: "p1", by: "p0" });
    t = ok(act(t.state, "p1", { type: "target", targetId: "p2" }));
    // The log still says p1 pushed the card onto p2.
    expect(find(t, "flip")).toMatchObject({ playerId: "p2", by: "p1" });
    expect(byId(t.state, "p2").status).toBe("busted");
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
    expect(find(t, "bounty")).toMatchObject({ playerId: "p0", targetId: "p2" });
  });

  it("in Classic a Swap bust counts pushedOver, with no bounty", () => {
    // ids: p0 R9=0; p1 R9 R9 R1=1..3; deck wrench=4
    const s = lead(
      stateWith({ n: 2, deck: ["wrench"], settings: CLASSIC, players: [{ engine: ["R9"] }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }] }),
      "p1",
    );
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: 0, theirs: 3 }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(byId(t.state, "p0").score).toBe(0);
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("in Cutthroat a Swap that makes the leader go too hot gives the bounty", () => {
    const s = lead(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["wrench"] }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }] }),
      "p1",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: 0, theirs: 3 }));
    expect(find(t, "bounty")).toEqual({ type: "bounty", playerId: "p0", targetId: "p1", points: 5 });
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a Dump that makes the leader go too hot gives the bounty", () => {
    // ids: p0 R9=0; p1 R9 R9 R1=1..3; dump=4
    const s = lead(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["dump"] }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }] }),
      "p1",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }));
    expect(byId(t.state, "p1").status).toBe("busted");
    expect(find(t, "bounty")).toEqual({ type: "bounty", playerId: "p0", targetId: "p1", points: 5 });
    expect(byId(t.state, "p0").score).toBe(5);
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a Dump from a saved player gives the bounty on top of their saved points", () => {
    const s = lead(
      stateWith({ n: 3, settings: CUT, players: [{ engine: ["R2", "B9"], hand: ["dump"] }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }, { flipped: true }] }),
      "p1",
    );
    const p0 = byId(s, "p0");
    p0.status = "banked";
    p0.roundPoints = bankScore(p0.engine, false);
    p0.score = p0.roundPoints;
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 1 }));
    expect(byId(t.state, "p1").status).toBe("busted");
    // Lost the B9's points, got the bounty.
    expect(byId(t.state, "p0").score).toBe(bankScore(byId(t.state, "p0").engine, false) + BOUNTY);
  });

  it("a Steal that makes the thief go too hot credits nobody", () => {
    const s = lead(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9", "R9"], score: 30, flipped: true, hand: ["steal"] }, { engine: ["B9"], flipped: true }] }),
      "p0",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 2 }));
    expect(byId(t.state, "p0").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(stats(t.state)).toEqual({});
  });

  it("a pusher who has left still counts, but gets no bounty", () => {
    const s = lead(
      stateWith({
        n: 3,
        deck: ["wrench"],
        settings: CUT,
        players: [{ hand: ["shove"] }, { engine: ["R9"], flipped: true }, { engine: ["R9", "R9", "R1"], score: 30, flipped: true }],
      }),
      "p2",
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    t = oh.onPlayerRemoved!(t.state, "p0", ctx());
    t = ok(act(t.state, "p1", { type: "wrench", targetId: "p2", mine: 0, theirs: 3 }));
    expect(byId(t.state, "p2").status).toBe("busted");
    expect(types(t)).not.toContain("bounty");
    expect(byId(t.state, "p0").score).toBe(0);
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
  });

  it("a game stored without stats still counts", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["dump"] }, { engine: ["R9", "R9", "R1"], flipped: true }] });
    delete (s as Partial<OverheatServerState>).stats;
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }));
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
    delete (t.state as Partial<OverheatServerState>).stats;
    expect(stats(t.state)).toEqual({});
  });

  it("the stats are not in the public or private state", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["dump"] }, { engine: ["R9", "R9", "R1"], flipped: true }] });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }));
    expect(stats(t.state)).toEqual({ p0: { pushedOver: 1 } });
    const seen = JSON.stringify([oh.getPublicState(t.state), oh.getPrivateState(t.state, "p0"), oh.getPrivateState(t.state, "p1")]);
    expect(seen).not.toContain("pushedOver");
    expect(oh.getPublicState(t.state)).not.toHaveProperty("stats");
  });
});

describe("the leader", () => {
  /** A state between rounds, with these scores. */
  const between = (scores: number[], settings: object = CUT, removed: number[] = []) => {
    const s = stateWith({ n: scores.length, settings, players: scores.map((score, i) => ({ score, removed: removed.includes(i), status: removed.includes(i) ? "out" : "banked" })) });
    s.step = "round-end";
    return s;
  };
  const next = (s: OverheatServerState) => oh.onTimer!(s, "next-round", ctx()).state;

  it("is the only top score at the start of a round", () => {
    const s = next(between([10, 20, 5]));
    expect(s.leaderId).toBe("p1");
    expect(oh.getPublicState(s).leaderId).toBe("p1");
  });

  it("is nobody when the top score is shared", () => {
    expect(next(between([20, 20, 5])).leaderId).toBeNull();
  });

  it("is nobody when the top score is 0", () => {
    expect(next(between([0, 0, 0])).leaderId).toBeNull();
    expect(oh.createGame([{ id: "a" }, { id: "b" }], { ...oh.defaultSettings, ...CUT }, { dealerSeat: 0 } as never, ctx()).state.leaderId).toBeNull();
  });

  it("skips a player who has left", () => {
    expect(next(between([30, 20, 5], CUT, [0])).leaderId).toBe("p1");
  });

  it("is a new one each round", () => {
    const s = between([10, 20, 5]);
    s.leaderId = "p0";
    expect(next(s).leaderId).toBe("p1");
    const tie = between([20, 20, 5]);
    tie.leaderId = "p0";
    expect(next(tie).leaderId).toBeNull();
  });

  it("is never set in Classic or Off", () => {
    expect(next(between([10, 20, 5], CLASSIC)).leaderId).toBeNull();
    expect(next(between([10, 20, 5], { powers: "off" })).leaderId).toBeNull();
  });
});
