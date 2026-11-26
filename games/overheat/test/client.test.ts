// The client's pure helpers: log wording, the hand and its reasons, the row
// tags, the saved turn and the card picks. No page needed.
import type { GameViewProps } from "@games/ui";
import { describe as group, expect, it } from "vitest";
import { describe, emptyPick, handBadge, handModel, rowTags, savedTurn, tapCard, tapPlayer } from "../client/model.ts";
import { overheatGame as oh } from "../server/game.ts";
import type { OverheatEvent, OverheatPrivateState, OverheatPublicState, Pending, PowerCard } from "../shared/types.ts";
import { stateWith } from "./helpers.ts";

const props = {
  playerId: "p0",
  room: { seats: [{ id: "p0", name: "Asha" }, { id: "p1", name: "Ravi" }, { id: "p2", name: "Meera" }] },
} as unknown as GameViewProps;
const say = (e: OverheatEvent) => describe(e, props);
const CUT = { powers: "cutthroat" as const };

type Opts = Parameters<typeof stateWith>[0];
/** The public view and p0's private view of a state. */
function views(opts: Opts, viewer = "p0") {
  const s = stateWith(opts);
  return {
    s,
    pub: oh.getPublicState(s) as OverheatPublicState,
    hand: (oh.getPrivateState!(s, viewer) as OverheatPrivateState).hand,
  };
}
const card = (power: PowerCard["power"], id: number): PowerCard => ({ kind: "power", id, power });

group("row tags", () => {
  it("says the hand size, hidden at 0", () => {
    expect(handBadge(0)).toBeNull();
    expect(handBadge(1)).toBe("1 card");
    expect(handBadge(3)).toBe("3 cards");
  });

  it("shows the hand badge and the leader mark", () => {
    const { pub } = views({ settings: CUT, players: [{ hand: ["vent", "steal"] }, { hand: [] }, {}] });
    pub.leaderId = "p1";
    expect(rowTags(pub, "p0")).toEqual({ hand: "2 cards", leader: false });
    expect(rowTags(pub, "p1")).toEqual({ hand: null, leader: true });
  });

  it("another player's cards are never in what I see", () => {
    const { s, pub, hand } = views({ settings: CUT, players: [{ hand: ["vent"] }, { hand: ["steal", "block"] }, {}] });
    const theirs = s.hands.p1!.map((c) => c.id);
    expect(hand.map((c) => c.id)).toEqual([s.hands.p0![0]!.id]);
    const model = handModel(pub, "p0", hand);
    expect(model.map((c) => c.card.id)).toEqual([s.hands.p0![0]!.id]);
    expect(JSON.stringify({ pub, model, tags: rowTags(pub, "p1") })).not.toMatch(/steal|block/);
    for (const id of theirs) expect(model.some((c) => c.card.id === id)).toBe(false);
  });
});

group("your cards", () => {
  it("shows each card's name and line, and plays it by id", () => {
    const { pub, hand } = views({ settings: CUT, players: [{ engine: ["R2"], hand: ["vent", "steal"] }, { engine: ["R5"] }, {}] });
    const model = handModel(pub, "p0", hand);
    expect(model.map((c) => [c.name, c.line])).toEqual([
      ["Cool", "Your heat goes down by 5."],
      ["Steal", "Take a number card from a player."],
    ]);
    expect(model.every((c) => c.playable && c.reason === null)).toBe(true);
    expect(model[1]!.action).toEqual({ type: "play", cardId: hand[1]!.id });
  });

  it("greys out a card with a reason", () => {
    const { pub, hand } = views({
      settings: CUT,
      players: [{ status: "banked", engine: ["R2"], hand: ["vent", "block", "shove", "audit"] }, { status: "banked" }, { engine: ["R5"] }],
    });
    const model = handModel(pub, "p0", hand);
    expect(model.map((c) => c.reason)).toEqual(["Only while flipping", "Block works by itself", null, "No one to aim at"]);
    expect(model.map((c) => c.playable)).toEqual([false, false, true, false]);
  });

  it("one card a turn", () => {
    const { pub, hand } = views({ settings: CUT, played: true, players: [{ hand: ["vent"] }, {}, {}] });
    expect(handModel(pub, "p0", hand)[0]).toMatchObject({ playable: false, reason: "One card each turn" });
  });

  it("not my turn: shown, not playable, no reason", () => {
    const { pub, hand } = views({ settings: CUT, turn: 1, players: [{ hand: ["vent"] }, {}, {}] });
    expect(handModel(pub, "p0", hand)[0]).toMatchObject({ playable: false, reason: null });
  });
});

group("saved turn", () => {
  it("only a saved or too-hot player on their turn gets Pass", () => {
    const saved = views({ settings: CUT, players: [{ status: "banked", hand: ["block"] }, {}, {}] });
    expect(savedTurn(saved.pub, "p0")).toBe(true);
    const hot = views({ settings: CUT, players: [{ status: "busted", hand: ["shove"] }, {}, {}] });
    expect(savedTurn(hot.pub, "p0")).toBe(true);
    const flipping = views({ settings: CUT, players: [{ hand: ["shove"] }, {}, {}] });
    expect(savedTurn(flipping.pub, "p0")).toBe(false);
    const notMine = views({ settings: CUT, turn: 1, players: [{}, { status: "banked", hand: ["shove"] }, {}] });
    expect(savedTurn(notMine.pub, "p0")).toBe(false);
  });
});

group("card picks", () => {
  const pend = (kind: Pending["kind"]): Pending => ({ kind, chooserId: "p0", card: card(kind, 99), fromHand: true });

  it("Steal: one card in their row sends steal with theirs", () => {
    const p = pend("steal");
    const r = tapCard(p, emptyPick(p), "p0", "p1", 7);
    expect(r.action).toEqual({ type: "steal", targetId: "p1", theirs: 7 });
    // My own row is not a pick for Steal.
    expect(tapCard(p, emptyPick(p), "p0", "p0", 3).action).toBeNull();
  });

  it("Dump: one card in my row and a player", () => {
    const p = pend("dump");
    let r = tapCard(p, emptyPick(p), "p0", "p0", 3);
    expect(r.action).toBeNull();
    expect(r.pick.mine).toBe(3);
    r = tapPlayer(p, r.pick, "p0", "p2");
    expect(r.action).toEqual({ type: "dump", targetId: "p2", mine: 3 });
    // The other way round works too.
    r = tapPlayer(p, emptyPick(p), "p0", "p1");
    expect(r.action).toBeNull();
    expect(tapCard(p, r.pick, "p0", "p0", 4).action).toEqual({ type: "dump", targetId: "p1", mine: 4 });
  });

  it("Swap: one of mine and one of theirs", () => {
    const p = pend("wrench");
    const r = tapCard(p, emptyPick(p), "p0", "p1", 7);
    expect(r.action).toBeNull();
    expect(tapCard(p, r.pick, "p0", "p0", 3).action).toEqual({ type: "wrench", targetId: "p1", mine: 3, theirs: 7 });
  });

  it("Audit, Push and Burn: only a player", () => {
    for (const kind of ["audit", "shove", "fuse"] as const) {
      const p = pend(kind);
      expect(tapPlayer(p, emptyPick(p), "p0", "p1").action).toEqual({ type: "target", targetId: "p1" });
      expect(tapCard(p, emptyPick(p), "p0", "p1", 7).action).toBeNull();
    }
  });
});

group("log lines", () => {
  const e = { kind: "power" as const, id: 50 };
  const red9 = { card: { kind: "number" as const, id: 1, colour: "red" as const, value: 9 }, mult: 1 as const };
  it("says the new events plainly", () => {
    expect(say({ type: "keep", playerId: "p1", count: 2 })).toBe("Ravi kept a power card. Ravi has 2 cards.");
    expect(say({ type: "keep", playerId: "p0", count: 1 })).toBeNull();
    expect(say({ type: "keep-card", playerId: "p0", card: { ...e, power: "steal" } })).toBe("You kept a Steal.");
    expect(say({ type: "play", playerId: "p1", card: { ...e, power: "audit" } })).toBe("Ravi played an Audit.");
    expect(say({ type: "pass", playerId: "p2" })).toBe("Meera passed.");
    expect(say({ type: "steal", playerId: "p0", targetId: "p1", card: red9, kept: true })).toBe("You took a Red 9 from Ravi.");
    expect(say({ type: "steal", playerId: "p1", targetId: "p0", card: red9, kept: false })).toBe(
      "Ravi took a Red 9 from you and threw it away.",
    );
    expect(say({ type: "dump", playerId: "p2", targetId: "p1", card: red9 })).toBe("Meera gave a Red 9 to Ravi.");
    expect(say({ type: "audit", playerId: "p2", targetId: "p1", card: red9, score: 30 })).toBe("Meera played an Audit on Ravi. Ravi lost a Red 9.");
    expect(say({ type: "rescore", playerId: "p1", roundPoints: 4, score: 30 })).toBe("Ravi has 30 points now.");
    expect(say({ type: "rescore", playerId: "p0", roundPoints: 4, score: 30 })).toBe("You have 30 points now.");
  });

  it("names the blocker and the bounty", () => {
    expect(say({ type: "block", playerId: "p1", byId: "p0", card: { ...e, power: "steal" } })).toBe("Ravi's Block stopped it.");
    expect(say({ type: "block", playerId: "p0", byId: "p1", card: { ...e, power: "steal" } })).toBe("Your Block stopped it.");
    expect(say({ type: "bounty", playerId: "p2", targetId: "p1", points: 5 })).toBe("Meera made the leader go too hot: +5 points.");
    expect(say({ type: "bounty", playerId: "p0", targetId: "p1", points: 5 })).toBe("You made the leader go too hot: +5 points.");
    expect(say({ type: "bounty", playerId: "p2", targetId: "p0", points: 5 })).toBe("Meera made you go too hot. You were the leader, so Meera gets +5 points.");
  });

  it("has no emoji and none of the banned words", () => {
    const banned = /\b(nuke|screw|stab|backstab|piece of cake|hit the road|dodge|rip|trick|sneak|rob|nick|swipe|cheat)\b/i;
    const lines = [
      say({ type: "block", playerId: "p1", byId: "p0", card: { ...e, power: "steal" } }),
      say({ type: "bounty", playerId: "p2", targetId: "p0", points: 5 }),
    ];
    for (const l of lines) {
      expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(l).not.toMatch(banned);
    }
  });
});
