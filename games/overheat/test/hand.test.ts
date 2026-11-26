import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { overheatGame as oh } from "../server/game.ts";
import type { OverheatServerState } from "../shared/types.ts";
import { act, ctx, err, find, ok, stateWith, types } from "./helpers.ts";

const CUT = { powers: "cutthroat" as const };
const hand = (s: OverheatServerState, id: string) => s.hands[id] ?? [];
const names = (s: OverheatServerState, id: string) => hand(s, id).map((c) => c.power);
const byId = (s: OverheatServerState, id: string) => s.players.find((p) => p.id === id)!;
const cardIn = (s: OverheatServerState, id: string, k = 0) => hand(s, id)[k]!.id;

describe("Cutthroat hands", () => {
  it("a flipped power goes to the hand when there is room, shown only to its owner", () => {
    const s = stateWith({ n: 2, deck: ["vent", "R2"], settings: CUT });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(names(t.state, "p0")).toEqual(["vent"]);
    expect(byId(t.state, "p0").heat).toBe(0);
    expect(t.state.turnIndex).toBe(1);
    expect(types(t)).not.toContain("vent");
    const keep = t.events.find((e) => e.event.type === "keep")!;
    expect(keep).toEqual({ visibility: { kind: "public" }, event: { type: "keep", playerId: "p0", count: 1 } });
    const card = t.events.find((e) => e.event.type === "keep-card")!;
    expect(card.visibility).toEqual({ kind: "private", playerId: "p0" });
    expect(card.event).toMatchObject({ playerId: "p0", card: { power: "vent" } });
  });

  it("the 4th power fires", () => {
    const s = stateWith({
      n: 2,
      deck: ["vent"],
      settings: CUT,
      players: [{ engine: ["R9"], flipped: true, hand: ["turbo", "turbo", "shove"] }],
    });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(names(t.state, "p0")).toEqual(["turbo", "turbo", "shove"]);
    expect(find(t, "vent")).toMatchObject({ playerId: "p0", heat: 4 });
    expect(types(t)).not.toContain("keep");
  });

  it("a Block that fires from a full hand fizzles", () => {
    const s = stateWith({ n: 3, deck: ["block", "R1"], settings: CUT, players: [{ hand: ["vent", "vent", "vent"] }] });
    const r = ok(act(s, "p0", { type: "flip" }));
    expect(find(r, "fizzle")).toMatchObject({ playerId: "p0" });
    expect(r.state.discard.some((c) => c.kind === "power" && c.power === "block")).toBe(true);
  });

  it("hands carry over to the next round", () => {
    const s = stateWith({
      n: 2,
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true, hand: ["vent"] }, { status: "banked" }],
    });
    let t = ok(act(s, "p0", { type: "bank" }));
    expect(t.state.step).toBe("round-end");
    t = oh.onTimer!(t.state, "next-round", ctx());
    expect(t.state.round).toBe(2);
    expect(names(t.state, "p0")).toEqual(["vent"]);
    expect(t.state.played).toBe(false);
  });

  it("only one card per turn", () => {
    const s = stateWith({ n: 2, deck: ["R2", "R3"], settings: CUT, players: [{ hand: ["turbo", "turbo"] }] });
    let t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }));
    expect(t.state.played).toBe(true);
    expect(find(t, "play")).toMatchObject({ playerId: "p0", card: { power: "turbo" } });
    expect(oh.getPublicState(t.state).handCounts).toEqual({ p0: 1, p1: 0 });
    expect(err(act(t.state, "p0", { type: "play", cardId: cardIn(t.state, "p0") }))).toBe("played");
    t = ok(act(t.state, "p0", { type: "flip" }));
    expect(t.state.turnIndex).toBe(1);
    expect(t.state.played).toBe(false);
  });

  it("playing Cool keeps the turn, then you must flip or save", () => {
    const s = stateWith({ n: 2, deck: ["R2"], settings: CUT, players: [{ engine: ["R9"], flipped: true, hand: ["vent"] }] });
    const t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }));
    expect(find(t, "vent")).toMatchObject({ playerId: "p0", heat: 4 });
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(0);
    expect(err(act(t.state, "p0", { type: "pass" }))).toBe("must-act");
    expect(ok(act(t.state, "p0", { type: "bank" })).state.turnIndex).toBe(1);
    expect(ok(act(t.state, "p0", { type: "flip" })).state.turnIndex).toBe(1);
  });

  it("a hand card that makes you go too hot, or saves you, ends your turn", () => {
    const at = (engine: string[]) =>
      stateWith({ n: 2, settings: CUT, players: [{ engine, flipped: true, hand: ["heatwave"] }, { engine: ["R2"], flipped: true }] });
    // Heat 23, limit 24 -> 21: too hot.
    const hot = at(["R9", "R9", "R5"]);
    let t = ok(act(hot, "p0", { type: "play", cardId: cardIn(hot, "p0") }));
    expect(byId(t.state, "p0").status).toBe("busted");
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(1);
    expect(t.state.played).toBe(false);
    // Heat 21, limit 24 -> 21: right at the limit, so saved.
    const exact = at(["R9", "R9", "R3"]);
    t = ok(act(exact, "p0", { type: "play", cardId: cardIn(exact, "p0") }));
    expect(byId(t.state, "p0").status).toBe("banked");
    expect(t.state.turnIndex).toBe(1);
  });

  it("before the first flip of a round, a played card still leaves you to flip", () => {
    const s = stateWith({ n: 2, deck: ["R2"], settings: CUT, players: [{ hand: ["turbo"] }] });
    const t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }));
    expect(err(act(t.state, "p0", { type: "bank" }))).toBe("must-flip");
    expect(byId(ok(act(t.state, "p0", { type: "flip" })).state, "p0").heat).toBe(4);
  });

  it("Block can't be played", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ hand: ["block"] }] });
    expect(err(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }))).toBe("block-auto");
  });

  it("Steal, Dump and Audit can't be played yet", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ engine: ["R2"], flipped: true, hand: ["steal", "dump", "audit"] }, { engine: ["R3"] }] });
    for (let k = 0; k < 3; k++) expect(err(act(s, "p0", { type: "play", cardId: cardIn(s, "p0", k) }))).toBe("no-target");
  });

  it("a card not in your hand, or off your turn, is refused", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ hand: ["vent"] }, { hand: ["vent"] }] });
    expect(err(act(s, "p0", { type: "play", cardId: cardIn(s, "p1") }))).toBe("no-card");
    expect(err(act(s, "p1", { type: "play", cardId: cardIn(s, "p1") }))).toBe("not-your-turn");
  });

  it("an aimed card with no target is refused", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ hand: ["shove"] }, { status: "banked" }] });
    expect(err(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }))).toBe("no-target");
  });

  it("a Push from the hand keeps the turn, and the pushed power fires for the target", () => {
    const s = stateWith({ n: 2, deck: ["vent"], settings: CUT, players: [{ hand: ["shove"] }, { engine: ["R9"], flipped: true }] });
    let t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }));
    expect(t.state.step).toBe("choosing");
    expect(t.state.pending).toMatchObject({ kind: "shove", chooserId: "p0", fromHand: true });
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(find(t, "vent")).toMatchObject({ playerId: "p1", heat: 4 });
    expect(names(t.state, "p1")).toEqual([]);
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(0);
  });

  it("a Push from the hand that turns up an aimed card returns the turn to the pusher", () => {
    const s = stateWith({
      n: 3,
      deck: ["fuse"],
      settings: CUT,
      players: [{ hand: ["shove"] }, { engine: ["R2"], flipped: true }, { engine: ["R3"], flipped: true }],
    });
    let t = ok(act(s, "p0", { type: "play", cardId: cardIn(s, "p0") }));
    t = ok(act(t.state, "p0", { type: "target", targetId: "p1" }));
    expect(t.state.pending).toMatchObject({ kind: "fuse", chooserId: "p1", fromHand: true });
    t = ok(act(t.state, "p1", { type: "target", targetId: "p2" }));
    expect(t.state.step).toBe("turn");
    expect(t.state.turnIndex).toBe(0);
  });
});

describe("Cutthroat saved-player turns", () => {
  it("a saved player with cards gets a turn and can pass; flip and bank are refused", () => {
    const s = stateWith({
      n: 3,
      deck: ["R2"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { engine: ["R5"], status: "banked", hand: ["vent"] }, { engine: ["R3"], flipped: true }],
    });
    let t = ok(act(s, "p0", { type: "flip" }));
    expect(t.state.turnIndex).toBe(1);
    expect(oh.getAwaitedPlayerIds!(t.state)).toEqual(["p1"]);
    expect(err(act(t.state, "p1", { type: "flip" }))).toBe("saved");
    expect(err(act(t.state, "p1", { type: "bank" }))).toBe("saved");
    t = ok(act(t.state, "p1", { type: "pass" }));
    expect(find(t, "pass")).toEqual({ type: "pass", playerId: "p1" });
    expect(t.state.turnIndex).toBe(2);
  });

  it("a saved player with no cards is skipped", () => {
    const s = stateWith({
      n: 3,
      deck: ["R2"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { engine: ["R5"], status: "banked" }, { engine: ["R3"], flipped: true }],
    });
    expect(ok(act(s, "p0", { type: "flip" })).state.turnIndex).toBe(2);
  });

  it("a too-hot player with cards gets a turn too", () => {
    const s = stateWith({
      n: 3,
      deck: ["R2"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { engine: ["R9"], heat: 30, status: "busted", hand: ["shove"] }, { engine: ["R3"], flipped: true }],
    });
    expect(ok(act(s, "p0", { type: "flip" })).state.turnIndex).toBe(1);
  });

  it("a saved player can't play Cool or Double", () => {
    const s = stateWith({ n: 2, turn: 1, settings: CUT, players: [{ engine: ["R2"], flipped: true }, { status: "banked", hand: ["vent", "turbo"] }] });
    expect(err(act(s, "p1", { type: "play", cardId: cardIn(s, "p1", 0) }))).toBe("not-now");
    expect(err(act(s, "p1", { type: "play", cardId: cardIn(s, "p1", 1) }))).toBe("not-now");
  });

  it("a saved player's Push or Limit down moves the turn on", () => {
    const s = stateWith({
      n: 3,
      turn: 1,
      deck: ["R2"],
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { status: "banked", hand: ["shove", "heatwave"] }, { engine: ["R3"], flipped: true }],
    });
    let t = ok(act(s, "p1", { type: "play", cardId: cardIn(s, "p1", 0) }));
    t = ok(act(t.state, "p1", { type: "target", targetId: "p0" }));
    expect(byId(t.state, "p0").heat).toBe(4);
    expect(t.state.turnIndex).toBe(2);
    const h = ok(act(s, "p1", { type: "play", cardId: cardIn(s, "p1", 1) }));
    expect(find(h, "heatwave")).toMatchObject({ playerId: "p1", hit: ["p2", "p0"] });
    expect(h.state.turnIndex).toBe(2);
  });

  it("a flipper can't pass", () => {
    const s = stateWith({ n: 2, settings: CUT, players: [{ hand: ["vent"] }] });
    expect(err(act(s, "p0", { type: "pass" }))).toBe("must-act");
  });

  it("the round ends when the last flipper saves, even while saved players hold cards", () => {
    const s = stateWith({
      n: 3,
      settings: CUT,
      players: [
        { engine: ["R2"], flipped: true },
        { engine: ["R5"], status: "banked", hand: ["shove", "vent"] },
        { engine: ["R5"], status: "busted", hand: ["fuse"] },
      ],
    });
    const t = ok(act(s, "p0", { type: "bank" }));
    expect(t.state.step).toBe("round-end");
    expect(names(t.state, "p1")).toEqual(["shove", "vent"]);
  });

  it("a Burn tick that takes out the last flipper ends the round, even with saved players holding cards", () => {
    const s = stateWith({
      n: 3,
      turn: 1,
      settings: CUT,
      players: [
        { engine: ["R9"], status: "banked", hand: ["vent"] },
        { engine: ["R2"], flipped: true },
        { engine: ["R9", "R9", "R5"], flipped: true, fuses: 3 },
      ],
    });
    // p1 saves; p2's Burn takes them to 26 of 24.
    const t = ok(act(s, "p1", { type: "bank" }));
    expect(byId(t.state, "p2").status).toBe("busted");
    expect(t.state.step).toBe("round-end");
  });

  it("removing a player puts their hand in the discard", () => {
    const s = stateWith({ n: 3, settings: CUT, players: [{}, { hand: ["vent", "block"] }] });
    const ids = hand(s, "p1").map((c) => c.id);
    const t = oh.onPlayerRemoved!(s, "p1", ctx());
    expect(hand(t.state, "p1")).toEqual([]);
    expect(t.state.discard.map((c) => c.id)).toEqual(expect.arrayContaining(ids));
  });

  it("removing the last flipper ends the round instead of handing the turn to a saved player", () => {
    const s = stateWith({
      n: 3,
      turn: 1,
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { status: "banked", hand: ["shove"] }, { status: "banked" }],
    });
    const t = oh.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state.step).toBe("round-end");
  });

  it("skip on a saved player's turn passes", () => {
    const s = stateWith({
      n: 3,
      turn: 1,
      settings: CUT,
      players: [{ engine: ["R2"], flipped: true }, { status: "banked", hand: ["shove"] }, { engine: ["R3"], flipped: true }],
    });
    const t = oh.skipTurn!(s, "p1", ctx());
    expect(types(t)).toEqual(["turn-skipped"]);
    expect(t.state.turnIndex).toBe(2);
    expect(names(t.state, "p1")).toEqual(["shove"]);
  });
});

describe("Classic and Off have no hand", () => {
  it.each(["classic", "off"] as const)("%s: a flipped power fires", (powers) => {
    const s = stateWith({ n: 2, deck: ["vent"], settings: { powers }, players: [{ engine: ["R9"], flipped: true }] });
    const t = ok(act(s, "p0", { type: "flip" }));
    expect(find(t, "vent")).toMatchObject({ heat: 4 });
    expect(hand(t.state, "p0")).toEqual([]);
    expect(types(t)).not.toContain("keep");
    expect(oh.getPrivateState(t.state, "p0")).toEqual({ hand: [] });
    expect(err(act(s, "p0", { type: "pass" }))).toBe("must-act");
  });
});

describe("hand privacy", () => {
  it("a hand card is never in public state, others' private state or others' events", () => {
    let s = stateWith({ n: 3, deck: ["audit", "R2", "R3"], settings: CUT, players: [{ hand: ["vent"] }] });
    const all = ["p0", "p1", "p2"];
    const t = ok(act(s, "p0", { type: "flip" }));
    s = t.state;
    for (const card of hand(s, "p0")) {
      const secret = JSON.stringify(card);
      expect(findLeaks({ def: oh, state: s, events: t.events, players: all, secret, allowed: ["p0"] })).toEqual([]);
    }
    expect(oh.getPrivateState(s, "p0").hand.map((c) => c.power)).toEqual(["vent", "audit"]);
    expect(oh.getPrivateState(s, "p1").hand).toEqual([]);
    const pub = oh.getPublicState(s);
    expect(pub.handCounts).toEqual({ p0: 2, p1: 0, p2: 0 });
    expect(pub.leaderId).toBeNull();
    expect(pub.played).toBe(false);
    expect(JSON.stringify(pub)).not.toMatch(/audit|"hands"/);
  });
});

describe("stored games", () => {
  it("a game stored before hands existed still plays", () => {
    const s = stateWith({ n: 2, deck: ["vent"], settings: CUT }) as Partial<OverheatServerState>;
    delete s.hands;
    delete s.played;
    delete s.leaderId;
    delete s.stats;
    const old = s as OverheatServerState;
    expect(oh.getPublicState(old).handCounts).toEqual({ p0: 0, p1: 0 });
    expect(oh.getPrivateState(old, "p0")).toEqual({ hand: [] });
    const t = ok(act(old, "p0", { type: "flip" }));
    expect(names(t.state, "p0")).toEqual(["vent"]);
  });
});
