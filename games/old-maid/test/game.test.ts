import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { oldMaidGame as om } from "../server/game.ts";
import { makeDeck, pairOff, parseCardId } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type OldMaidAction, type OldMaidServerState, type OldMaidSettings } from "../shared/types.ts";

const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

/** A mid-game state, bypassing the deal. Hand order is the fan order. */
function stateWith(
  hands: string[][],
  opts: { turn?: number; dealer?: number; outOrder?: string[]; removed?: number[]; settings?: Partial<OldMaidSettings> } = {},
): OldMaidServerState {
  return {
    phase: "playing",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: hands.map((ids, i) => ({ id: `p${i}`, hand: cards(ids), removed: opts.removed?.includes(i) ?? false })),
    dealerIndex: opts.dealer ?? 0,
    turnIndex: opts.turn ?? 1,
    turnNumber: 0,
    discard: [],
    outOrder: opts.outOrder ?? [],
    loserId: null,
    endReason: null,
  };
}

function act(state: OldMaidServerState, playerId: string, action: OldMaidAction, seed = 1) {
  return om.handleAction(state, playerId, action, ctx(seed));
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const ids = (hand: { id: string }[]) => hand.map((c) => c.id).sort();
const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

describe("createGame", () => {
  it("deals the whole deck, pairs everyone off, and starts left of the dealer", () => {
    const t = om.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx());
    const held = t.state.players.flatMap((p) => p.hand);
    expect(held.length + t.state.discard.length).toBe(51);
    expect(t.state.discard.length % 2).toBe(0);
    for (const p of t.state.players) expect(pairOff(p.hand).pairs).toEqual([]);
    expect(t.state.turnIndex).toBe(3);
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", dealerId: "p2", handSizes: { p3: 13, p0: 13, p1: 13, p2: 12 } });

    const pub = JSON.stringify(om.getPublicState(t.state));
    for (const card of held) expect(pub).not.toContain(`"${card.id}"`);
  });

  it("deals an injected deck in order, and adds the joker in joker mode", () => {
    const deck = makeDeck("joker").map((c) => c.id);
    const t = om.createGame(players(3), { oldMaid: "joker" }, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck });
    const all = [...t.state.players.flatMap((p) => p.hand), ...t.state.discard].map((c) => c.id);
    expect(all).toHaveLength(53);
    expect(all).toContain("joker");
    // 53 cards from the dealer's left: p1 and p2 get the extra ones.
    expect(t.events[0]!.event).toMatchObject({ handSizes: { p1: 18, p2: 18, p0: 17 } });

    expect(() => om.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck })).toThrow(/queen of clubs/);
  });

  it("can be over at the deal, if everyone else pairs out", () => {
    // Two players, dealer p0: p1 gets every spade and heart (13 pairs), p0 the
    // clubs and diamonds, which pair off to leave the queen of diamonds.
    const deck = makeDeck("queen").map((c) => c.id);
    const mine = deck.filter((id) => id.startsWith("spades") || id.startsWith("hearts"));
    const theirs = deck.filter((id) => !mine.includes(id));
    const t = om.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), {
      deck: mine.flatMap((id, i) => (theirs[i] ? [id, theirs[i]] : [id])),
    });
    expect(t.state).toMatchObject({ phase: "finished", loserId: "p0", outOrder: ["p1"] });
    expect(ids(t.state.players[0]!.hand)).toEqual(["diamonds-Q"]);
  });
});

describe("taking", () => {
  it("takes the chosen slot from the player on your right, and keeps the card private", () => {
    // p1's turn: takes from p0.
    const s = stateWith([["spades-5", "hearts-9"], ["clubs-9", "diamonds-K"], ["spades-3"]]);
    const t = ok(act(s, "p1", { type: "take", slot: 1 }));
    expect(ids(t.state.players[0]!.hand)).toEqual(["spades-5"]);
    // The nine paired off.
    expect(ids(t.state.players[1]!.hand)).toEqual(["diamonds-K"]);
    expect(ids(t.state.discard)).toEqual(["clubs-9", "hearts-9"]);
    expect(t.state.turnIndex).toBe(2);

    const took = t.events.find((e) => e.event.type === "took")!;
    expect(took.visibility).toEqual({ kind: "public" });
    expect(JSON.stringify(took.event)).not.toContain("hearts-9");
    expect(t.events.find((e) => e.event.type === "you-took")!.visibility).toEqual({ kind: "private", playerId: "p1" });
    expect(t.events.find((e) => e.event.type === "taken-from-you")!.visibility).toEqual({ kind: "private", playerId: "p0" });
    expect(eventTypes(t)).toEqual(["took", "you-took", "taken-from-you", "discarded"]);
  });

  it("rejects out-of-turn takes and slots past the end of the fan", () => {
    const s = stateWith([["spades-5"], ["clubs-9"], ["spades-3"]]);
    expect(err(act(s, "p2", { type: "take", slot: 0 }))).toBe("not-your-turn");
    expect(err(act(s, "p1", { type: "take", slot: 1 }))).toBe("bad-slot");
    expect(om.parseAction({ type: "take", slot: -1 })).toBeNull();
    expect(om.parseAction({ type: "take", slot: 1.5 })).toBeNull();
    expect(om.parseAction({ type: "take", slot: 2 })).toEqual({ type: "take", slot: 2 });
  });

  it("puts a player out when their last card is taken, and skips them after", () => {
    const s = stateWith([["spades-5"], ["clubs-9", "hearts-J"], ["spades-3", "diamonds-5"]]);
    const t = ok(act(s, "p1", { type: "take", slot: 0 }));
    expect(t.state.outOrder).toEqual(["p0"]);
    expect(eventTypes(t)).toContain("went-out");
    // p2 now takes from p1, not the empty p0.
    expect(om.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p2", sourceId: "p1" });
    // And after p2, the turn wraps past p0 to p1.
    const t2 = ok(act(t.state, "p2", { type: "take", slot: 0 }));
    expect(om.getPublicState(t2.state).currentPlayerId).toBe("p1");
  });

  it("ends when one player is left holding, and names them the loser", () => {
    // p1 takes p0's last card and pairs it: both out, p2 is stuck.
    const s = stateWith([["spades-5"], ["clubs-5"], ["hearts-Q"]], { outOrder: [] });
    const t = ok(act(s, "p1", { type: "take", slot: 0 }));
    expect(t.state.phase).toBe("finished");
    expect(t.state.outOrder).toEqual(["p0", "p1"]);
    expect(t.state.loserId).toBe("p2");
    expect(eventTypes(t).at(-1)).toBe("game-over");

    const r = om.getResult(t.state)!;
    expect(r.loserIds).toEqual(["p2"]);
    expect(r.winnerIds.sort()).toEqual(["p0", "p1"]);
    expect(r.standings.map((s) => [s.playerId, s.label])).toEqual([
      ["p0", "out 1st"],
      ["p1", "out 2nd"],
      ["p2", "stuck with the Queen of Hearts"],
    ]);
    expect(om.getPublicState(t.state).loserCard?.id).toBe("hearts-Q");
    expect(err(act(t.state, "p2", { type: "take", slot: 0 }))).toBe("game-finished");
  });
});

describe("host and leavers", () => {
  it("a skipped turn takes a random card for the player", () => {
    const s = stateWith([["spades-5", "hearts-9"], ["clubs-9"], ["spades-3", "hearts-4"]]);
    const t = om.skipTurn!(s, "p1", ctx(3));
    expect(eventTypes(t)[0]).toBe("turn-skipped");
    expect(eventTypes(t)).toContain("took");
    expect(t.state.players[0]!.hand).toHaveLength(1);
    expect(om.skipTurn!(s, "p0", ctx()).events).toEqual([]);
  });

  it("hands a leaver's cards to the next holder, who pairs them off", () => {
    const s = stateWith([["spades-5", "hearts-K"], ["clubs-9", "diamonds-5"], ["spades-3"], ["hearts-7"]], { turn: 2 });
    const t = om.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state.players[0]!).toMatchObject({ removed: true, hand: [] });
    expect(ids(t.state.players[1]!.hand)).toEqual(["clubs-9", "hearts-K"]);
    expect(t.events[0]!.event).toEqual({ type: "player-removed", playerId: "p0", toId: "p1" });
    // Wasn't their turn, so it stays with p2, who now takes from p1.
    expect(om.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p2", sourceId: "p1" });
  });

  it("moves the turn on when the current player leaves", () => {
    const s = stateWith([["spades-5"], ["clubs-9"], ["spades-3"]], { turn: 1 });
    const t = om.onPlayerRemoved!(s, "p1", ctx());
    expect(om.getPublicState(t.state).currentPlayerId).toBe("p2");
  });

  it("calls it off without a loser when a leaver leaves one holder", () => {
    const s = stateWith([["spades-5", "hearts-Q"], ["clubs-5"], []], { outOrder: ["p2"] });
    const t = om.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state).toMatchObject({ phase: "finished", endReason: "abandoned", loserId: null });
    const r = om.getResult(t.state)!;
    expect(r.loserIds).toEqual([]);
    expect(r.winnerIds).toEqual([]);
  });
});

describe("whole games", () => {
  it("always ends with exactly one player holding exactly the odd card", () => {
    for (const oldMaid of ["queen", "joker"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const n = 2 + (seed % 9);
        const rng = seededRandomInt(seed * 7);
        let state = om.createGame(players(n), { oldMaid }, { roundNumber: 1, dealerSeat: seed }, ctx(seed)).state;
        for (let turns = 0; state.phase === "playing"; turns++) {
          expect(turns).toBeLessThan(2000);
          const pub = om.getPublicState(state);
          const fan = pub.players.find((p) => p.id === pub.sourceId)!.cardCount;
          state = ok(act(state, pub.currentPlayerId!, { type: "take", slot: rng(fan) }, seed + turns)).state;
          for (const p of state.players) expect(pairOff(p.hand).pairs).toEqual([]);
        }
        const held = state.players.flatMap((p) => p.hand);
        expect(held).toHaveLength(1);
        expect(held.length + state.discard.length).toBe(oldMaid === "joker" ? 53 : 51);
        if (oldMaid === "joker") expect(held[0]!.id).toBe("joker");
        else expect(held[0]!.rank).toBe(12);
        expect(state.outOrder).toHaveLength(n - 1);
        expect(om.getResult(state)!.loserIds).toEqual([state.loserId]);
      }
    }
  });
});
