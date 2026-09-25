import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { goFishGame as gf } from "../server/game.ts";
import { makeDeck, parseCardId, ranksHeld, takeBooks } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type GoFishAction, type GoFishServerState, type Rank } from "../shared/types.ts";

const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

/** A mid-game state, bypassing the deal. The pond's top card is its last. */
function stateWith(
  hands: string[][],
  opts: { pond?: string[]; turn?: number; books?: Rank[][]; removed?: number[] } = {},
): GoFishServerState {
  return {
    phase: "playing",
    settings: DEFAULT_SETTINGS,
    players: hands.map((ids, i) => ({
      id: `p${i}`,
      hand: cards(ids),
      books: opts.books?.[i] ?? [],
      removed: opts.removed?.includes(i) ?? false,
    })),
    pond: cards(opts.pond ?? []),
    dealerIndex: 0,
    turnIndex: opts.turn ?? 0,
    turnNumber: 0,
    asks: [],
    lastBook: null,
    winnerIds: [],
    endReason: null,
  };
}

function act(state: GoFishServerState, playerId: string, action: GoFishAction) {
  return gf.handleAction(state, playerId, action, ctx());
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const ask = (targetId: string, rank: Rank): GoFishAction => ({ type: "ask", targetId, rank });
const ids = (hand: { id: string }[]) => hand.map((c) => c.id).sort();
const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const allCards = (s: GoFishServerState) => [
  ...s.players.flatMap((p) => p.hand.map((c) => c.id)),
  ...s.pond.map((c) => c.id),
  ...s.players.flatMap((p) => p.books.flatMap((r) => makeDeck().filter((c) => c.rank === r).map((c) => c.id))),
];

describe("createGame", () => {
  it("deals seven each to three, leaves the rest in the pond, and starts left of the dealer", () => {
    const t = gf.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx());
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", dealerId: "p2", handSizes: { p0: 7, p1: 7, p2: 7 }, pondCount: 31 });
    expect(new Set(allCards(t.state)).size).toBe(52);
    expect(allCards(t.state)).toHaveLength(52);
    expect(t.state.turnIndex).toBe(0);

    const pub = JSON.stringify(gf.getPublicState(t.state));
    for (const card of t.state.players.flatMap((p) => p.hand)) expect(pub).not.toContain(`"${card.id}"`);
  });

  it("deals five each to four or more", () => {
    const t = gf.createGame(players(5), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(t.events[0]!.event).toMatchObject({ handSizes: { p0: 5, p1: 5, p2: 5, p3: 5, p4: 5 }, pondCount: 27 });
    expect(() => gf.createGame(players(7), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/2–6/);
  });

  it("puts a book dealt to you straight down", () => {
    // Two players, dealer p0: dealing starts with p1, so the even slots are theirs.
    const sevens = ["spades-7", "hearts-7", "clubs-7", "diamonds-7"];
    const rest = makeDeck().map((c) => c.id).filter((id) => !sevens.includes(id));
    const deck = Array.from({ length: 52 }, (_, i) => (i < 8 && i % 2 === 0 ? sevens[i / 2]! : rest.shift()!));
    const t = gf.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck });
    expect(t.state.players[1]!.books).toEqual([7]);
    expect(t.state.players[1]!.hand).toHaveLength(3);
    expect(eventTypes(t)).toEqual(["dealt", "booked"]);
    expect(gf.getPublicState(t.state)).toMatchObject({ lastBook: 7, booksDown: 1 });
    expect(() => gf.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: deck.slice(1) })).toThrow(/52/);
  });
});

describe("asking", () => {
  it("takes every card of the rank, in the open, and goes again", () => {
    const s = stateWith([["spades-7", "hearts-2"], ["hearts-7", "clubs-7", "spades-9"], ["spades-3"]], { pond: ["clubs-2"] });
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(ids(t.state.players[0]!.hand)).toEqual(["clubs-7", "hearts-2", "hearts-7", "spades-7"]);
    expect(ids(t.state.players[1]!.hand)).toEqual(["spades-9"]);
    expect(t.state.turnIndex).toBe(0);
    expect(eventTypes(t)).toEqual(["asked", "handed"]);
    expect(t.events.every((e) => e.visibility.kind === "public")).toBe(true);
    expect(gf.getPublicState(t.state).asks).toEqual([{ playerId: "p0", targetId: "p1", rank: 7, got: 2, outcome: "given" }]);
  });

  it("goes fishing on a miss, keeps the draw private, and passes the turn", () => {
    const s = stateWith([["spades-7"], ["hearts-9"], ["spades-3"]], { pond: ["clubs-4", "clubs-2"] });
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(eventTypes(t)).toEqual(["asked", "go-fish", "drew", "you-drew"]);
    expect(t.events[1]!.event).toEqual({ type: "go-fish", playerId: "p1", askerId: "p0" });
    const drew = t.events.find((e) => e.event.type === "drew")!;
    expect(drew.event).toEqual({ type: "drew", playerId: "p0", count: 1, shown: null, refill: false });
    expect(t.events.find((e) => e.event.type === "you-drew")!).toEqual({
      visibility: { kind: "private", playerId: "p0" },
      event: { type: "you-drew", cards: [parseCardId("clubs-2")] },
    });
    expect(ids(t.state.players[0]!.hand)).toEqual(["clubs-2", "spades-7"]);
    expect(t.state.turnIndex).toBe(1);
    expect(gf.getPublicState(t.state).asks.at(-1)).toMatchObject({ got: 0, outcome: "fished" });
  });

  it("shows a catch of the rank asked for, and goes again", () => {
    const s = stateWith([["spades-7"], ["hearts-9"]], { pond: ["clubs-4", "clubs-7"] });
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(t.events.find((e) => e.event.type === "drew")!.event).toMatchObject({ shown: { id: "clubs-7" } });
    expect(t.state.turnIndex).toBe(0);
    expect(gf.getPublicState(t.state).asks.at(-1)).toMatchObject({ outcome: "caught" });
  });

  it("passes the turn when there's nothing to fish from", () => {
    const s = stateWith([["spades-7", "spades-8"], ["hearts-9", "hearts-8"]]);
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(eventTypes(t)).toEqual(["asked", "go-fish"]);
    expect(t.state.turnIndex).toBe(1);
    expect(gf.getPublicState(t.state).asks.at(-1)).toMatchObject({ outcome: "dry" });
  });

  it("rejects asks out of turn, for ranks you don't hold, and of nobody useful", () => {
    const s = stateWith([["spades-7"], ["hearts-9"], [], ["clubs-9"]], { pond: [], removed: [3], books: [[], [], [1]] });
    expect(err(act(s, "p1", ask("p0", 9)))).toBe("not-your-turn");
    expect(err(act(s, "p0", ask("p1", 9)))).toBe("rank-not-held");
    expect(err(act(s, "p0", ask("p0", 7)))).toBe("ask-yourself");
    expect(err(act(s, "p0", ask("p2", 7)))).toBe("nothing-to-ask");
    expect(err(act(s, "p0", ask("p3", 7)))).toBe("player-left");
    expect(err(act(s, "p0", ask("p9", 7)))).toBe("no-such-player");
    expect(err(act(s, "p3", ask("p0", 9)))).toBe("not-in-game");
    expect(gf.parseAction({ type: "ask", targetId: "p1", rank: 0 })).toBeNull();
    expect(gf.parseAction({ type: "ask", targetId: "p1", rank: 14 })).toBeNull();
    expect(gf.parseAction({ type: "ask", targetId: 3, rank: 7 })).toBeNull();
    expect(gf.parseAction({ type: "ask", targetId: "p1", rank: 7 })).toEqual(ask("p1", 7));
  });
});

describe("books and empty hands", () => {
  it("books the fourth, refills an emptied hand from the pond, and refills the one who gave", () => {
    const pond = ["spades-2", "hearts-2", "clubs-2", "diamonds-3", "spades-4", "hearts-4", "clubs-4", "diamonds-4", "spades-5", "hearts-5"];
    const s = stateWith([["spades-7", "hearts-7", "clubs-7"], ["diamonds-7"], ["spades-K"]], { pond });
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(eventTypes(t)).toEqual(["asked", "handed", "booked", "drew", "you-drew", "drew", "you-drew"]);
    expect(t.state.players[0]!.books).toEqual([7]);
    // Both drew five off the top (the end of the array).
    expect(ids(t.state.players[0]!.hand)).toEqual(ids(cards(pond.slice(5))));
    expect(ids(t.state.players[1]!.hand)).toEqual(ids(cards(pond.slice(0, 5))));
    expect(t.events[3]!.event).toMatchObject({ playerId: "p0", count: 5, refill: true });
    // Still p0's go.
    expect(t.state.turnIndex).toBe(0);
  });

  it("takes whatever's left of the pond when there's less than five", () => {
    const s = stateWith([["spades-7"], ["hearts-7", "clubs-9"], ["spades-K"]], { turn: 1, pond: ["clubs-2", "diamonds-2"] });
    const t = ok(act(s, "p1", ask("p0", 7)));
    expect(ids(t.state.players[0]!.hand)).toEqual(["clubs-2", "diamonds-2"]);
    expect(t.state.pond).toEqual([]);
  });

  it("sits out a player whose hand empties with the pond gone, and skips them", () => {
    const s = stateWith([["spades-7", "spades-8"], ["hearts-7"], ["spades-K", "hearts-8"]], { turn: 0 });
    const t = ok(act(s, "p0", ask("p1", 7)));
    expect(eventTypes(t)).toContain("went-out");
    expect(gf.getPublicState(t.state).players[1]).toMatchObject({ cardCount: 0, out: true });
    // p0 goes again; a miss on p2 then passes over p1 to p2.
    const t2 = ok(act(t.state, "p0", ask("p2", 7)));
    expect(gf.getPublicState(t2.state).currentPlayerId).toBe("p2");
    const t3 = ok(act(t2.state, "p2", ask("p0", 13)));
    expect(gf.getPublicState(t3.state).currentPlayerId).toBe("p0");
  });

  it("ends when the 13th book goes down, and ties share the win", () => {
    // p0 has 6 books, p1 has 5, p2 has 1; p1 books the last one to tie p0.
    const s = stateWith([["spades-Q"], ["hearts-Q", "clubs-Q", "diamonds-Q"], []], {
      turn: 1,
      books: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11], [13]],
    });
    const t = ok(act(s, "p1", ask("p0", 12)));
    expect(t.state.phase).toBe("finished");
    expect(eventTypes(t)).toEqual(["asked", "handed", "booked", "game-over"]);
    expect(t.state.winnerIds).toEqual(["p0", "p1"]);
    const r = gf.getResult(t.state)!;
    expect(r.winnerIds).toEqual(["p0", "p1"]);
    expect(r.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "6 books"],
      ["p1", "6 books"],
      ["p2", "1 book"],
    ]);
    expect(err(act(t.state, "p0", ask("p1", 1)))).toBe("game-finished");
  });
});

describe("host and leavers", () => {
  it("a skipped turn just passes", () => {
    const s = stateWith([["spades-7"], ["hearts-9"], ["spades-3"]], { turn: 1, pond: ["clubs-2"] });
    const t = gf.skipTurn!(s, "p1", ctx());
    expect(eventTypes(t)).toEqual(["turn-skipped"]);
    expect(t.state.turnIndex).toBe(2);
    expect(t.state.players[1]!.hand).toHaveLength(1);
    expect(gf.skipTurn!(s, "p0", ctx()).events).toEqual([]);
  });

  it("shuffles a leaver's cards into the pond and keeps their books down", () => {
    const s = stateWith([["spades-7"], ["hearts-9", "clubs-9"], ["spades-3"]], { turn: 2, pond: ["clubs-2"], books: [[], [5], []] });
    const t = gf.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state.players[1]).toMatchObject({ removed: true, hand: [], books: [5] });
    expect(ids(t.state.pond)).toEqual(["clubs-2", "clubs-9", "hearts-9"]);
    expect(t.events[0]!.event).toEqual({ type: "player-removed", playerId: "p1", returned: 2 });
    expect(t.state.turnIndex).toBe(2);
  });

  it("deals whoever was sitting out back in when a leaver refills the pond", () => {
    const s = stateWith([["spades-7"], [], ["spades-3", "hearts-3"], ["hearts-7"]], { turn: 0 });
    const t = gf.onPlayerRemoved!(s, "p2", ctx());
    expect(ids(t.state.players[1]!.hand)).toEqual(["hearts-3", "spades-3"]);
    expect(eventTypes(t)).toEqual(["player-removed", "drew", "you-drew"]);
  });

  it("moves the turn on when the current player leaves", () => {
    const s = stateWith([["spades-7"], ["hearts-9"], ["spades-3"]], { turn: 1 });
    const t = gf.onPlayerRemoved!(s, "p1", ctx());
    expect(gf.getPublicState(t.state).currentPlayerId).toBe("p2");
  });

  it("ends it when one player's left; they win if they've a book", () => {
    const s = stateWith([["spades-7"], ["hearts-7"]], { books: [[1], [2, 3]] });
    const t = gf.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state).toMatchObject({ phase: "finished", endReason: "abandoned", winnerIds: ["p0"] });
    expect(gf.getResult(t.state)!.standings.map((x) => x.label)).toEqual(["1 book", "left"]);
  });
});

describe("whole games", () => {
  it("conserves the deck, always terminates, and ends with 13 books and the most-books winners", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const n = 2 + (seed % 5);
      const rng = seededRandomInt(seed * 7);
      let state = gf.createGame(players(n), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: seed }, ctx(seed)).state;
      for (let turns = 0; state.phase === "playing"; turns++) {
        expect(turns).toBeLessThan(1000);
        const pub = gf.getPublicState(state);
        const me = pub.currentPlayerId!;
        const priv = gf.getPrivateState(state, me);
        expect(priv.hand.length).toBeGreaterThan(0);
        const targets = pub.players.filter((p) => p.id !== me && !p.removed && p.cardCount > 0);
        expect(targets.length).toBeGreaterThan(0);
        const target = targets[rng(targets.length)]!;
        const rank = priv.askableRanks[rng(priv.askableRanks.length)]!;
        state = ok(gf.handleAction(state, me, ask(target.id, rank), ctx(seed + turns))).state;

        const all = allCards(state);
        expect(all).toHaveLength(52);
        expect(new Set(all).size).toBe(52);
        for (const p of state.players) expect(takeBooks(p.hand).books).toEqual([]);
        // While the pond has cards, nobody's empty-handed.
        if (state.pond.length) for (const p of state.players) expect(p.hand.length).toBeGreaterThan(0);
      }
      expect(state.endReason).toBe("done");
      expect(state.players.flatMap((p) => p.books).sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
      const top = Math.max(...state.players.map((p) => p.books.length));
      const r = gf.getResult(state)!;
      expect(r.winnerIds).toEqual(state.players.filter((p) => p.books.length === top).map((p) => p.id));
      expect(r.standings[0]!.value).toBe(top);
    }
  });

  it("survives players leaving mid-game: cards conserved, still ends", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const n = 3 + (seed % 4);
      const rng = seededRandomInt(seed * 13);
      let state = gf.createGame(players(n), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(seed)).state;
      for (let turns = 0; state.phase === "playing"; turns++) {
        expect(turns).toBeLessThan(1000);
        if (rng(15) === 0) {
          const seated = state.players.filter((p) => !p.removed);
          state = gf.onPlayerRemoved!(state, seated[rng(seated.length)]!.id, ctx(seed + turns)).state;
        } else if (rng(10) === 0) {
          state = gf.skipTurn!(state, gf.getPublicState(state).currentPlayerId!, ctx()).state;
        } else {
          const pub = gf.getPublicState(state);
          const me = pub.currentPlayerId!;
          const targets = pub.players.filter((p) => p.id !== me && !p.removed && p.cardCount > 0);
          const ranks = ranksHeld(state.players.find((p) => p.id === me)!.hand);
          state = ok(gf.handleAction(state, me, ask(targets[rng(targets.length)]!.id, ranks[rng(ranks.length)]!), ctx(seed + turns))).state;
        }
        const all = allCards(state);
        expect(all).toHaveLength(52);
        expect(new Set(all).size).toBe(52);
      }
      const seated = state.players.filter((p) => !p.removed);
      if (state.endReason === "done") expect(state.players.flatMap((p) => p.books)).toHaveLength(13);
      else expect(seated.length).toBeLessThan(2);
      const top = Math.max(0, ...seated.map((p) => p.books.length));
      expect(gf.getResult(state)!.winnerIds).toEqual(top ? seated.filter((p) => p.books.length === top).map((p) => p.id) : []);
    }
  });
});
