import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import { bankScore } from "../shared/rules.ts";
import type { OverheatServerState, PowerKind } from "../shared/types.ts";
import { act, ctx, err, find, ok, stateWith, types } from "./helpers.ts";

const CUT = { powers: "cutthroat" as const };
const hand = (s: OverheatServerState, id: string) => s.hands[id] ?? [];
const names = (s: OverheatServerState, id: string) => hand(s, id).map((c) => c.power);
const byId = (s: OverheatServerState, id: string) => s.players.find((p) => p.id === id)!;
const cardIn = (s: OverheatServerState, id: string, k = 0) => hand(s, id)[k]!.id;
const rowIds = (s: OverheatServerState, id: string) => byId(s, id).engine.map((e) => e.card.id);
const inDiscard = (s: OverheatServerState, id: number) => s.discard.some((c) => c.id === id);

/** Marks player `id` as saved with the points their row is worth, on top of `before`. */
function saved(s: OverheatServerState, id: string, before: number, redline = false): OverheatServerState {
  const p = byId(s, id);
  p.status = "banked";
  p.redline = redline;
  p.roundPoints = bankScore(p.engine, redline);
  p.score = before + p.roundPoints;
  return s;
}

/** Plays the first hand card of `p0` (the turn owner). */
const playFirst = (s: OverheatServerState, id = "p0") => ok(act(s, id, { type: "play", cardId: cardIn(s, id) }));

describe("Steal", () => {
  it("from a flipper: the card and its heat move to the thief, who keeps the turn", () => {
    // ids: p0 R9=0; p1 R2=1 B7=2; steal=3
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["steal"] }, { engine: ["R2", "B7"], flipped: true }] });
    let t = playFirst(s);
    expect(t.state.pending).toMatchObject({ kind: "steal", chooserId: "p0", fromHand: true });
    t = ok(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 2 }));
    expect(find(t, "steal")).toMatchObject({ playerId: "p0", targetId: "p1", card: { card: { id: 2 }, mult: 1 }, kept: true });
    expect(rowIds(t.state, "p0")).toEqual([0, 2]);
    expect(rowIds(t.state, "p1")).toEqual([1]);
    expect(byId(t.state, "p0").heat).toBe(16);
    expect(byId(t.state, "p1").heat).toBe(2);
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(0);
  });

  it("the thief can go too hot, and then the turn moves on", () => {
    const s = stateWith({
      n: 2,
      settings: CUT,
      players: [{ engine: ["R9", "R9"], flipped: true, hand: ["steal"] }, { engine: ["R2", "B7"], mult2: [1], flipped: true }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 3 }));
    // 18 + 14 = 32 of 24.
    expect(byId(t.state, "p0")).toMatchObject({ status: "busted", heat: 32 });
    expect(byId(t.state, "p1").heat).toBe(2);
    expect(byId(t.state, "p0").engine.at(-1)!.mult).toBe(2);
    expect(t.state.turnIndex).toBe(1);
  });

  it("from a saved player: their score drops, colour bonus included", () => {
    // p1's row: three reds (+5) and a blue. ids: p0 G1=0; p1 R3=1 R4=2 R5=3 B1=4; steal=5
    const s = saved(
      stateWith({ n: 3, settings: CUT, players: [{ engine: ["G1"], flipped: true, hand: ["steal"] }, { engine: ["R3", "R4", "R5", "B1"] }, { engine: ["A2"] }] }),
      "p1",
      40,
    );
    expect(byId(s, "p1")).toMatchObject({ roundPoints: 18, score: 58 });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 3 }));
    expect(byId(t.state, "p1")).toMatchObject({ status: "banked", roundPoints: 8, score: 48 });
    expect(find(t, "rescore")).toEqual({ type: "rescore", playerId: "p1", roundPoints: 8, score: 48 });
    expect(byId(t.state, "p0").heat).toBe(6);
  });

  it("played by a saved player: the card is taken and thrown away", () => {
    const s = saved(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["G1"], hand: ["steal"] }, { engine: ["R5", "B2"], flipped: true }] }),
      "p0",
      10,
    );
    // ids: p0 G1=0; p1 R5=1 B2=2; steal=3
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 1 }));
    expect(find(t, "steal")).toMatchObject({ playerId: "p0", kept: false });
    expect(rowIds(t.state, "p0")).toEqual([0]);
    expect(rowIds(t.state, "p1")).toEqual([2]);
    expect(byId(t.state, "p1").heat).toBe(2);
    expect(inDiscard(t.state, 1)).toBe(true);
    expect(byId(t.state, "p0")).toMatchObject({ score: 11, roundPoints: 1 });
    expect(t.state.turnIndex).toBe(1);
  });
});

describe("Dump", () => {
  it("the target gets the card and its heat, and can go too hot", () => {
    // ids: p0 R9=0 B2=1; p1 R9=2 A9=3; dump=4
    const s = stateWith({
      n: 2,
      settings: CUT,
      players: [{ engine: ["R9", "B2"], flipped: true, hand: ["dump"] }, { engine: ["R9", "A9"], flipped: true }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }));
    expect(find(t, "dump")).toMatchObject({ playerId: "p0", targetId: "p1", card: { card: { id: 0 }, mult: 1 } });
    expect(byId(t.state, "p1")).toMatchObject({ status: "busted", heat: 27 });
    expect(byId(t.state, "p0").heat).toBe(2);
    expect(rowIds(t.state, "p0")).toEqual([1]);
    expect(t.state.turnIndex).toBe(0);
    expect(t.state.step).toBe("turn");
  });

  it("by a saved player: they lose that card's points", () => {
    const s = saved(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9", "B2"], hand: ["dump"] }, { engine: ["R2"], flipped: true }] }),
      "p0",
      30,
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }));
    expect(byId(t.state, "p0")).toMatchObject({ roundPoints: 2, score: 32 });
    expect(byId(t.state, "p1").heat).toBe(11);
    expect(find(t, "rescore")).toMatchObject({ playerId: "p0", roundPoints: 2, score: 32 });
  });

  it("only at a player still flipping", () => {
    const s = saved(
      stateWith({ n: 3, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["dump"] }, { engine: ["R2"] }, { engine: ["R3"], flipped: true }] }),
      "p1",
      0,
    );
    const t = playFirst(s);
    expect(err(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }))).toBe("bad-target");
  });
});

describe("Audit", () => {
  it("takes the highest card, counting double; points and score are recomputed, Perfect kept", () => {
    // p1's row: R5 A9 G5(x2) B9: 33 + rainbow 5 + Perfect 10 = 48.
    // ids: p0 R1=0; p1 R5=1 A9=2 G5=3 B9=4; audit=5
    const s = saved(
      stateWith({
        n: 3,
        settings: CUT,
        players: [{ engine: ["R1"], flipped: true, hand: ["audit"] }, { engine: ["R5", "A9", "G5", "B9"], mult2: [2] }, { engine: ["A1"] }],
      }),
      "p1",
      100,
      true,
    );
    expect(byId(s, "p1").roundPoints).toBe(48);
    let t = playFirst(s);
    expect(t.state.pending).toMatchObject({ kind: "audit" });
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    // Left: R5 A9 B9 = 23, no rainbow, Perfect 10 = 33.
    expect(rowIds(t.state, "p1")).toEqual([1, 2, 4]);
    expect(inDiscard(t.state, 3)).toBe(true);
    expect(byId(t.state, "p1")).toMatchObject({ roundPoints: 33, score: 133, redline: true });
    expect(find(t, "audit")).toMatchObject({ playerId: "p0", targetId: "p1", card: { card: { id: 3 }, mult: 2 }, score: 133 });
    expect(t.state.turnIndex).toBe(0);
  });

  it("a tie goes to the first card in the row", () => {
    // ids: p0 R1=0; p1 R2=1 A9=2 B9=3; audit=4
    const s = saved(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R1"], flipped: true, hand: ["audit"] }, { engine: ["R2", "A9", "B9"] }] }),
      "p1",
      0,
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(rowIds(t.state, "p1")).toEqual([1, 3]);
  });

  it("only saved players, never yourself", () => {
    const flippers = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R1"], flipped: true, hand: ["audit"] }, { engine: ["R2"], flipped: true }] });
    expect(err(act(flippers, "p0", { type: "play", cardId: cardIn(flippers, "p0") }))).toBe("no-target");
    // p0 saved and plays Audit: p1 still flips, p2 saved. Only p2 can be aimed at.
    let s = stateWith({
      n: 3,
      settings: CUT,
      players: [{ engine: ["R9"], hand: ["audit"] }, { engine: ["R2"], flipped: true }, { engine: ["B3"] }],
    });
    s = saved(saved(s, "p0", 0), "p2", 0);
    const t = playFirst(s);
    expect(err(act(t.state, "p0", { type: "target", targetId: "p0" }))).toBe("bad-target");
    expect(err(act(t.state, "p0", { type: "target", targetId: "p1" }))).toBe("bad-target");
    expect(byId(ok(act(t.state, "p0", { type: "target", targetId: "p2" })).state, "p2").engine).toEqual([]);
  });

  it("an Audit that takes the leader below the target before the round ends means no win", () => {
    const base = () =>
      saved(
        stateWith({
          n: 2,
          settings: { ...CUT, target: 150 },
          players: [{ engine: ["R1"], flipped: true, hand: ["audit"] }, { engine: ["R9", "R9", "R2"] }],
        }),
        "p1",
        130,
      );
    // Without the Audit: p1 has 155 and wins when the round ends.
    const plain = base();
    expect(byId(plain, "p1").score).toBe(155);
    expect(ok(act(plain, "p0", { type: "bank" })).state.phase).toBe("finished");
    // With it: one R9 goes, leaving 11 points with no bonus: score 141.
    let t = playFirst(base());
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(byId(t.state, "p1").score).toBe(141);
    t = ok(act(t.state, "p0", { type: "bank" }));
    expect(t.state.phase).toBe("playing");
    expect(t.state.step).toBe("round-end");
    expect(types(t)).not.toContain("game-over");
  });
});

describe("Swap with a saved player", () => {
  it("is allowed in Cutthroat and rescores them", () => {
    // ids: p0 R9=0; p1 R2=1 B3=2; p2 G1=3; wrench=4
    const s = saved(
      stateWith({ n: 3, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["wrench"] }, { engine: ["R2", "B3"] }, { engine: ["G1"] }] }),
      "p1",
      10,
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: 0, theirs: 1 }));
    expect(byId(t.state, "p1")).toMatchObject({ roundPoints: 12, score: 22, status: "banked" });
    expect(byId(t.state, "p0").heat).toBe(2);
    expect(find(t, "rescore")).toMatchObject({ playerId: "p1", roundPoints: 12, score: 22 });
  });

  it("a saved player who swaps is rescored too", () => {
    const s = saved(
      stateWith({ n: 2, settings: CUT, players: [{ engine: ["R2"], hand: ["wrench"] }, { engine: ["B9"], flipped: true }] }),
      "p0",
      0,
    );
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: 0, theirs: 1 }));
    expect(byId(t.state, "p0")).toMatchObject({ roundPoints: 9, score: 9 });
    expect(byId(t.state, "p1").heat).toBe(2);
  });

  it("is not allowed in Classic", () => {
    // p0 flips a Swap; the only other player with cards has saved.
    const s = saved(
      stateWith({ n: 2, deck: ["wrench"], settings: { powers: "classic" }, players: [{ engine: ["R9"], flipped: true }, { engine: ["R2"] }] }),
      "p1",
      0,
    );
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(find(t, "fizzle")).toMatchObject({ playerId: "p0", card: { power: "wrench" } });
    expect(t.state.step).toBe("turn");
  });
});

describe("Block", () => {
  type Case = { power: PowerKind; target: "flipping" | "banked"; choose: () => Record<string, unknown> };
  // ids: p0 R9=0; p1 R5=1; deck R1=2; then the hands: p0's card=3, p1 block=4 block=5 vent=6.
  const cases: Case[] = [
    { power: "shove", target: "flipping", choose: () => ({ type: "target", targetId: "p1" }) },
    { power: "wrench", target: "flipping", choose: () => ({ type: "wrench", targetId: "p1", mine: 0, theirs: 1 }) },
    { power: "fuse", target: "flipping", choose: () => ({ type: "target", targetId: "p1" }) },
    { power: "steal", target: "flipping", choose: () => ({ type: "steal", targetId: "p1", theirs: 1 }) },
    { power: "dump", target: "flipping", choose: () => ({ type: "dump", targetId: "p1", mine: 0 }) },
    { power: "audit", target: "banked", choose: () => ({ type: "target", targetId: "p1" }) },
  ];
  it.each(cases)("cancels $power, and one Block is spent", ({ power, target, choose }) => {
    let s = stateWith({
      n: 2,
      deck: ["R1"],
      settings: CUT,
      players: [{ engine: ["R9"], flipped: true, hand: [power] }, { engine: ["R5"], flipped: true, hand: ["block", "block", "vent"] }],
    });
    if (target === "banked") s = saved(s, "p1", 20);
    let t = playFirst(s);
    const before = structuredClone(t.state.players);
    t = ok(act(t.state, "p0", choose() as never));
    expect(find(t, "block")).toEqual({ type: "block", playerId: "p1", byId: "p0", card: { kind: "power", id: 3, power } });
    expect(types(t)).toEqual(["block"]);
    expect(t.state.players).toEqual(before);
    expect(names(t.state, "p1")).toEqual(["block", "vent"]);
    expect(inDiscard(t.state, 3)).toBe(true);
    expect(inDiscard(t.state, 4)).toBe(true);
    expect(t.state.deck.map((c) => c.id)).toEqual(s.deck.map((c) => c.id));
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(0);
  });

  it("does not stop Limit down", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["heatwave"] }, { engine: ["R5"], flipped: true, hand: ["block"] }] });
    const t = playFirst(s);
    expect(byId(t.state, "p1").gauge).toBe(21);
    expect(names(t.state, "p1")).toEqual(["block"]);
    expect(types(t)).not.toContain("block");
  });

  it("stops an aimed card fired from a flip", () => {
    const s = stateWith({
      n: 2,
      deck: ["shove", "R1"],
      settings: CUT,
      players: [{ engine: ["R9"], flipped: true, hand: ["vent", "vent", "vent"] }, { engine: ["R5"], flipped: true, hand: ["block"] }],
    });
    let t = ok(act(s, "p0", { type: "flip" }));
    expect(t.state.pending).toMatchObject({ kind: "shove", fromHand: false });
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(find(t, "block")).toMatchObject({ playerId: "p1", byId: "p0" });
    expect(byId(t.state, "p1").heat).toBe(5);
    expect(t.state.turnIndex).toBe(1);
  });

  it("stops a card a Push turned up", () => {
    const s = stateWith({
      n: 3,
      deck: ["fuse"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true, hand: ["shove"] }, { engine: ["R3"], flipped: true }, { engine: ["R4"], flipped: true, hand: ["block"] }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    t = ok(act(t.state, "p1", { type: "target", targetId: "p2" }));
    expect(find(t, "block")).toMatchObject({ playerId: "p2", byId: "p1", card: { power: "fuse" } });
    expect(byId(t.state, "p2").fuses).toBe(0);
    expect(t.state.turnIndex).toBe(0);
  });

  it("is not in Classic: a Push hits a player even if they somehow hold a Block", () => {
    const s = stateWith({ n: 2, deck: ["shove", "R1"], settings: { powers: "classic" }, players: [{ engine: ["R9"], flipped: true }, { engine: ["R5"], flipped: true }] });
    let t = ok(act(s, "p0", { type: "flip" }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(types(t)).not.toContain("block");
    expect(byId(t.state, "p1").heat).toBe(6);
  });

  it("the block event shows no other hand cards", () => {
    const s = stateWith({
      n: 3,
      deck: ["R1"],
      settings: CUT,
      players: [{ engine: ["R9"], flipped: true, hand: ["shove", "steal"] }, { engine: ["R5"], flipped: true, hand: ["vent", "block", "audit"] }, {}],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(find(t, "block")).toBeDefined();
    expect(oh.getPublicState(t.state).handCounts).toEqual({ p0: 1, p1: 2, p2: 0 });
    const all = ["p0", "p1", "p2"];
    for (const owner of ["p0", "p1"]) {
      for (const card of hand(t.state, owner)) {
        const leaks = findLeaks({ def: oh, state: t.state, events: t.events, players: all, secret: JSON.stringify(card), allowed: [owner] });
        expect(leaks, `${owner} ${card.power}`).toEqual([]);
      }
    }
    // The spent Block is not named by id either: only the blocker and the played card.
    expect(Object.keys(find(t, "block")!).sort()).toEqual(["byId", "card", "playerId", "type"]);
  });
});

describe("Push in Cutthroat", () => {
  it("a power it turns up fires for the target, never into their hand", () => {
    // ids: p1 R2=0; p2 R5=1; deck steal=2; p0 shove=3
    const s = stateWith({
      n: 3,
      deck: ["steal"],
      settings: CUT,
      players: [{ hand: ["shove"] }, { engine: ["R2"], flipped: true }, { engine: ["R5"], flipped: true }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(t.state.pending).toMatchObject({ kind: "steal", chooserId: "p1", fromHand: true });
    expect(names(t.state, "p1")).toEqual([]);
    t = ok(act(t.state, "p1", { type: "steal", targetId: "p2", theirs: 1 }));
    expect(byId(t.state, "p1").heat).toBe(7);
    expect(byId(t.state, "p2").heat).toBe(0);
    expect(t.state.turnIndex).toBe(0);
  });

  it("a Block it turns up does nothing", () => {
    const s = stateWith({ n: 2, deck: ["block"], settings: CUT, players: [{ hand: ["shove"] }, { engine: ["R2"], flipped: true }] });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(find(t, "fizzle")).toMatchObject({ card: { power: "block" } });
    expect(names(t.state, "p1")).toEqual([]);
  });
});

describe("bad choices", () => {
  const stealing = () => {
    // ids: p0 R1=0; p1 R2=1; steal=2 dump=3
    const s = stateWith({
      n: 3,
      settings: CUT,
      players: [{ engine: ["R1"], flipped: true, hand: ["steal", "dump"] }, { engine: ["R2"], flipped: true }, { flipped: true }],
    });
    return s;
  };

  it("Steal: a card not in their row, an invalid target, the wrong shape", () => {
    const t = playFirst(stealing());
    expect(err(act(t.state, "p0", { type: "steal", targetId: "p1", theirs: 0 }))).toBe("bad-card");
    expect(err(act(t.state, "p0", { type: "steal", targetId: "p0", theirs: 0 }))).toBe("bad-target");
    expect(err(act(t.state, "p0", { type: "steal", targetId: "p2", theirs: 1 }))).toBe("bad-target");
    expect(err(act(t.state, "p0", { type: "target", targetId: "p1" }))).toBe("not-choosing");
    expect(err(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 0 }))).toBe("not-choosing");
    expect(err(act(t.state, "p1", { type: "steal", targetId: "p0", theirs: 0 }))).toBe("not-choosing");
  });

  it("Dump: a card not in your row", () => {
    const s = stealing();
    const t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0", 1) }));
    expect(err(act(t.state, "p0", { type: "dump", targetId: "p1", mine: 1 }))).toBe("bad-card");
    expect(err(act(t.state, "p0", { type: "wrench", targetId: "p1", mine: 0, theirs: 1 }))).toBe("not-choosing");
  });

  it("parseAction reads Steal and Dump and refuses bad ids", () => {
    expect(oh.parseAction({ type: "steal", targetId: "p1", theirs: 4 })).toEqual({ type: "steal", targetId: "p1", theirs: 4 });
    expect(oh.parseAction({ type: "dump", targetId: "p1", mine: 2 })).toEqual({ type: "dump", targetId: "p1", mine: 2 });
    expect(oh.parseAction({ type: "steal", targetId: "p1" })).toBeNull();
    expect(oh.parseAction({ type: "dump", targetId: "p1", mine: "2" })).toBeNull();
  });
});

describe("skip and removal mid-choice", () => {
  it("skip picks a legal Steal or Dump", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R1"], flipped: true, hand: ["steal", "dump"] }, { engine: ["R2"], flipped: true }] });
    for (let k = 0; k < 2; k++) {
      const t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0", k) }));
      const skipped = oh.skipTurn!(t.state, "p0", ctx());
      expect(types(skipped)).toContain(k === 0 ? "steal" : "dump");
      expect(skipped.state.pending).toBeNull();
    }
  });

  it("the Push target leaves while choosing: the turn goes back to the pusher, who still flips", () => {
    const s = stateWith({
      n: 3,
      deck: ["fuse", "R1"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true, hand: ["shove"] }, { engine: ["R3"], flipped: true }, { engine: ["R4"], flipped: true }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(t.state.pending).toMatchObject({ chooserId: "p1" });
    t = oh.onPlayerRemoved!(t.state, "p1", ctx());
    expect(t.state.step).toBe("turn");
    expect(t.state.pending).toBeNull();
    expect(t.state.turnIndex).toBe(0);
    expect(err(act(t.state, "p0", { type: "play", cardId: 0 }))).toBe("played");
    expect(ok(act(t.state, "p0", { type: "flip" })).state.turnIndex).toBe(2);
  });

  it("the pusher leaves while the target chooses: the turn moves on after the choice", () => {
    const s = stateWith({
      n: 3,
      deck: ["fuse"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true, hand: ["shove"] }, { engine: ["R3"], flipped: true }, { engine: ["R4"], flipped: true }],
    });
    let t = playFirst(s);
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    t = oh.onPlayerRemoved!(t.state, "p0", ctx());
    expect(t.state.pending).toMatchObject({ chooserId: "p1" });
    t = ok(act(t.state, "p1", { type: "target", targetId: "p2" }));
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(1);
    expect(byId(t.state, "p2").fuses).toBe(1);
  });
});
