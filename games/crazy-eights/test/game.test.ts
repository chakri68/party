import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { crazyEightsGame as ce } from "../server/game.ts";
import { makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type CrazyEightsAction,
  type CrazyEightsServerState,
  type CrazyEightsSettings,
  type Suit,
} from "../shared/types.ts";

const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

/** Builds a mid-game state directly, bypassing the deal. `stock` is listed top first. */
function stateWith(
  hands: string[][],
  opts: {
    discard?: string[];
    stock?: string[];
    calledSuit?: Suit | null;
    turn?: number;
    settings?: Partial<CrazyEightsSettings>;
  } = {},
): CrazyEightsServerState {
  return {
    phase: "playing",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: hands.map((ids, i) => ({ id: `p${i}`, hand: cards(ids), removed: false })),
    decks: 1,
    stock: cards([...(opts.stock ?? ["clubs-2", "clubs-3", "clubs-4"])].reverse()),
    discard: cards(opts.discard ?? ["hearts-5"]),
    calledSuit: opts.calledSuit ?? null,
    dealerIndex: 0,
    turnIndex: opts.turn ?? 0,
    turnNumber: 0,
    winnerIds: [],
    endReason: null,
  };
}

function act(state: CrazyEightsServerState, playerId: string, action: CrazyEightsAction) {
  return ce.handleAction(state, playerId, action, ctx());
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

describe("createGame", () => {
  it("deals 5 each from the dealer's left, turns a starter, and keeps hands private", () => {
    const t = ce.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 1 }, ctx());
    expect(t.state.players.map((p) => p.hand.length)).toEqual([5, 5, 5, 5]);
    expect(t.state.discard).toHaveLength(1);
    expect(t.state.stock).toHaveLength(52 - 20 - 1);
    expect(t.state.turnIndex).toBe(2);

    const pub = JSON.stringify(ce.getPublicState(t.state));
    for (const p of t.state.players) for (const card of p.hand) expect(pub).not.toContain(`"${card.id}"`);
  });

  it("deals in order from an injected deck and buries a starter eight", () => {
    const deck = makeDeck(1).map((c) => c.id);
    // Hands take the first 10; put an eight at position 10 so it comes up as the starter.
    const eight = deck.indexOf("hearts-8");
    [deck[10], deck[eight]] = [deck[eight]!, deck[10]!];
    const t = ce.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck });

    expect(t.state.players[1]!.hand.map((c) => c.id)).toContain(deck[0]);
    expect(t.state.players[0]!.hand.map((c) => c.id)).toContain(deck[1]);
    expect(t.state.discard[0]!.id).toBe(deck[11]);
    expect(t.state.stock.map((c) => c.id)).toContain("hearts-8");
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", buried: [{ id: "hearts-8" }] });
  });

  it("uses two decks above five players, and upgrades a forced single deck that can't cover the deal", () => {
    const six = ce.createGame(players(6), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(six.state.decks).toBe(2);
    const ten = ce.createGame(players(10), { ...DEFAULT_SETTINGS, decks: 1 }, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(ten.state.decks).toBe(1);
    expect(ten.state.stock).toHaveLength(1);
  });
});

describe("playing", () => {
  it("accepts a suit or rank match and passes the turn", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"]]);
    const t = ok(act(s, "p0", { type: "play-card", cardId: "hearts-K" }));
    expect(t.state.discard.at(-1)!.id).toBe("hearts-K");
    expect(t.state.turnIndex).toBe(1);
    expect(ok(act(stateWith([["spades-5", "spades-2"], ["clubs-9"]]), "p0", { type: "play-card", cardId: "spades-5" }))).toBeTruthy();
  });

  it("rejects cards that don't follow, and out-of-turn plays", () => {
    const s = stateWith([["spades-K", "spades-2"], ["hearts-9"]]);
    expect(err(act(s, "p0", { type: "play-card", cardId: "spades-K" }))).toBe("illegal-play");
    expect(err(act(s, "p1", { type: "play-card", cardId: "hearts-9" }))).toBe("not-your-turn");
    expect(err(act(s, "p0", { type: "play-card", cardId: "hearts-9" }))).toBe("card-not-owned");
  });

  it("needs a called suit with an eight, then enforces it", () => {
    const s = stateWith([["clubs-8", "spades-2"], ["hearts-9", "diamonds-4", "spades-8"]]);
    expect(err(act(s, "p0", { type: "play-card", cardId: "clubs-8" }))).toBe("call-a-suit");

    const t = ok(act(s, "p0", { type: "play-card", cardId: "clubs-8", suit: "diamonds" }));
    expect(ce.getPublicState(t.state)).toMatchObject({ calledSuit: "diamonds", activeSuit: "diamonds" });
    expect(ce.getPrivateState(t.state, "p1").playableCardIds.sort()).toEqual(["diamonds-4", "spades-8"]);
    expect(err(act(t.state, "p1", { type: "play-card", cardId: "hearts-9" }))).toBe("illegal-play");

    // A plain card clears the call.
    const next = ok(act(t.state, "p1", { type: "play-card", cardId: "diamonds-4" }));
    expect(next.state.calledSuit).toBeNull();
  });

  it("ends the game when a hand empties, and the winner collects the rest", () => {
    const s = stateWith([["hearts-K"], ["spades-8", "clubs-Q", "hearts-A"], ["clubs-3"]]);
    const t = ok(act(s, "p0", { type: "play-card", cardId: "hearts-K" }));
    expect(t.state.phase).toBe("finished");
    expect(eventTypes(t)).toContain("game-over");
    const result = ce.getResult(t.state)!;
    expect(result.winnerIds).toEqual(["p0"]);
    expect(result.standings.map((s) => s.playerId)).toEqual(["p0", "p2", "p1"]);
    expect(result.standings[0]).toMatchObject({ value: 0, label: "+64 pts" });
    expect(result.standings[2]).toMatchObject({ value: 3, label: "61 pts in hand" });
  });
});

describe("drawing", () => {
  it("draws the top of the stock, privately, and keeps the turn", () => {
    const s = stateWith([["spades-K", "spades-2"], ["clubs-9"]], { stock: ["hearts-J", "clubs-3"] });
    const t = ok(act(s, "p0", { type: "draw" }));
    expect(t.state.turnIndex).toBe(0);
    expect(t.state.players[0]!.hand.map((c) => c.id)).toContain("hearts-J");
    const drew = t.events.find((e) => e.event.type === "you-drew")!;
    expect(drew.visibility).toEqual({ kind: "private", playerId: "p0" });
    const pub = t.events.find((e) => e.event.type === "drew")!;
    expect(JSON.stringify(pub)).not.toContain("hearts-J");
    expect(ce.getPrivateState(t.state, "p0").playableCardIds).toEqual(["hearts-J"]);
  });

  it("allows drawing even with a playable card", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"]]);
    expect(ok(act(s, "p0", { type: "draw" })).state.players[0]!.hand).toHaveLength(3);
  });

  it("passes automatically once the stock is empty and nothing fits", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9", "clubs-2"], ["hearts-2", "hearts-3"]], { stock: [] });
    const t = ok(act(s, "p0", { type: "play-card", cardId: "hearts-K" }));
    expect(eventTypes(t)).toEqual(["card-played", "passed"]);
    expect(t.state.turnIndex).toBe(2);
  });

  it("hands the turn on when the last draw leaves nothing to play", () => {
    const s = stateWith([["spades-K", "spades-2"], ["hearts-9", "clubs-2"]], { stock: ["clubs-3"] });
    const t = ok(act(s, "p0", { type: "draw" }));
    expect(eventTypes(t)).toEqual(["drew", "you-drew", "passed"]);
    expect(t.state.turnIndex).toBe(1);
  });

  it("reshuffles the pile under the top card when that rule is on", () => {
    const s = stateWith([["spades-K", "spades-2"], ["clubs-9"]], {
      stock: [],
      discard: ["clubs-4", "diamonds-5", "hearts-5"],
      settings: { emptyStock: "reshuffle" },
    });
    expect(ce.getPrivateState(s, "p0").canDraw).toBe(true);
    const t = ok(act(s, "p0", { type: "draw" }));
    expect(eventTypes(t).slice(0, 2)).toEqual(["reshuffled", "drew"]);
    expect(t.state.discard.map((c) => c.id)).toEqual(["hearts-5"]);
    expect(t.state.stock).toHaveLength(1);
  });

  it("rejects a draw from an empty stock under Bicycle rules", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"]], { stock: [] });
    expect(ce.getPrivateState(s, "p0").canDraw).toBe(false);
    expect(err(act(s, "p0", { type: "draw" }))).toBe("stock-empty");
  });

  it("ends a blocked game with the lowest hand winning", () => {
    // p0 plays their last heart; nobody else can follow and there's nothing to draw.
    const s = stateWith([["hearts-K", "spades-Q"], ["clubs-9", "clubs-2"], ["spades-3", "diamonds-A"]], { stock: [] });
    const t = ok(act(s, "p0", { type: "play-card", cardId: "hearts-K" }));
    expect(t.state.endReason).toBe("blocked");
    expect(t.state.winnerIds).toEqual(["p2"]); // 4 pts, vs 10 and 11
    const result = ce.getResult(t.state)!;
    expect(result.standings[0]).toMatchObject({ playerId: "p2", label: "+13 pts" }); // (10-4) + (11-4)
  });
});

describe("seating", () => {
  it("returns a leaver's cards to the stock and moves the turn on", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"], ["hearts-3"]], { stock: [] });
    const t = ce.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state.players[0]).toMatchObject({ removed: true, hand: [] });
    expect(t.state.stock).toHaveLength(2);
    expect(t.state.turnIndex).toBe(1); // p1 can't play but can now draw
  });

  it("ends the game when only one player is left", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"]]);
    const t = ce.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state).toMatchObject({ phase: "finished", winnerIds: ["p0"], endReason: "abandoned" });
    expect(ce.getResult(t.state)!.standings[0]).toMatchObject({ playerId: "p0", label: "last one standing" });
  });

  it("lets the host skip the current player", () => {
    const s = stateWith([["hearts-K", "spades-2"], ["clubs-9"]]);
    expect(ce.skipTurn!(s, "p0", ctx()).state.turnIndex).toBe(1);
  });
});

describe("full games", () => {
  it("always finishes, for any table size and either stock rule", () => {
    for (const emptyStock of ["pass", "reshuffle"] as const) {
      for (let n = 2; n <= 10; n++) {
        const random = seededRandomInt(n * 7 + (emptyStock === "pass" ? 0 : 1));
        let state = ce.createGame(players(n), { ...DEFAULT_SETTINGS, emptyStock }, { roundNumber: 1, dealerSeat: 0 }, ctx(n)).state;
        for (let moves = 0; state.phase === "playing"; moves++) {
          expect(moves).toBeLessThan(5000);
          const id = ce.getAwaitedPlayerIds(state)[0]!;
          const priv = ce.getPrivateState(state, id);
          // Mostly play, sometimes draw anyway, to exercise both paths.
          const choice = priv.playableCardIds[random(priv.playableCardIds.length + 1)];
          const action: CrazyEightsAction = choice
            ? { type: "play-card", cardId: choice, suit: "hearts" }
            : priv.canDraw
              ? { type: "draw" }
              : { type: "play-card", cardId: priv.playableCardIds[0]!, suit: "spades" };
          state = ok(ce.handleAction(state, id, action, ctx(moves))).state;
        }
        const total = state.players.reduce((sum, p) => sum + p.hand.length, 0) + state.stock.length + state.discard.length;
        expect(total).toBe(52 * state.decks);
        expect(ce.getResult(state)!.winnerIds.length).toBeGreaterThan(0);
      }
    }
  });
});
