import { describe, expect, it } from "vitest";
import {
  emptyBoard,
  getPlayableCards,
  isPlayable,
  makeCard,
  makeDeck,
  parseCardId,
  placeCard,
  resolveDecks,
} from "../shared/rules.ts";
import { SUITS, type RowRange, type SevensBoardState, type Suit } from "../shared/types.ts";

/** One-deck shorthand: a single range per suit. */
const board = (rows: Partial<Record<Suit, RowRange | null>>): SevensBoardState =>
  Object.fromEntries(SUITS.map((s) => [s, [rows[s] ?? null]])) as SevensBoardState;

describe("isPlayable", () => {
  it("any seven starts its suit", () => {
    for (const suit of ["clubs", "diamonds", "hearts", "spades"] as const) {
      expect(isPlayable(makeCard(suit, 7), emptyBoard())).toBe(true);
    }
  });

  it("nothing but a seven opens a suit", () => {
    expect(isPlayable(makeCard("clubs", 6), emptyBoard())).toBe(false);
    expect(isPlayable(makeCard("clubs", 8), emptyBoard())).toBe(false);
  });

  it("6 and 8 can follow 7", () => {
    const b = board({ clubs: { low: 7, high: 7 } });
    expect(isPlayable(makeCard("clubs", 6), b)).toBe(true);
    expect(isPlayable(makeCard("clubs", 8), b)).toBe(true);
  });

  it("5 cannot follow 7 directly", () => {
    expect(isPlayable(makeCard("clubs", 5), board({ clubs: { low: 7, high: 7 } }))).toBe(false);
  });

  it("different suits cannot extend each other", () => {
    expect(isPlayable(makeCard("hearts", 8), board({ clubs: { low: 7, high: 7 } }))).toBe(false);
  });

  it("the row grows outward from both exposed ends", () => {
    const b = board({ clubs: { low: 5, high: 9 } });
    expect(isPlayable(makeCard("clubs", 4), b)).toBe(true);
    expect(isPlayable(makeCard("clubs", 10), b)).toBe(true);
    expect(isPlayable(makeCard("clubs", 6), b)).toBe(false); // already down
  });

  it("ace high: K → A, and A never touches 2", () => {
    const high = board({ spades: { low: 2, high: 13 } });
    expect(isPlayable(parseCardId("spades-A", "high")!, high)).toBe(true);
    expect(isPlayable(parseCardId("spades-A", "high")!, board({ spades: { low: 2, high: 12 } }))).toBe(false);
  });

  it("ace low: A → 2, and A never touches K", () => {
    expect(isPlayable(parseCardId("spades-A", "low")!, board({ spades: { low: 2, high: 13 } }))).toBe(true);
    expect(isPlayable(parseCardId("spades-A", "low")!, board({ spades: { low: 3, high: 13 } }))).toBe(false);
  });
});

describe("cards", () => {
  it("decks have 52 unique cards in either ace position", () => {
    for (const ace of ["high", "low"] as const) {
      const deck = makeDeck(ace);
      expect(deck).toHaveLength(52);
      expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    }
  });

  it("card ids round-trip", () => {
    for (const card of makeDeck("high")) expect(parseCardId(card.id, "high")).toEqual(card);
    expect(parseCardId("clubs-1", "high")).toBeNull();
    expect(parseCardId("clubs-11", "high")).toBeNull();
    expect(parseCardId("cups-7", "high")).toBeNull();
  });

  it("placeCard widens the right end", () => {
    let b = placeCard(emptyBoard(), makeCard("hearts", 7)).board;
    b = placeCard(b, makeCard("hearts", 8)).board;
    b = placeCard(b, makeCard("hearts", 6)).board;
    expect(b.hearts).toEqual([{ low: 6, high: 8 }]);
  });

  it("seven-of-diamonds rule only allows 7♦ on an empty board", () => {
    const hand = [makeCard("clubs", 7), makeCard("diamonds", 7)];
    expect(getPlayableCards(hand, emptyBoard(), "seven-of-diamonds").map((c) => c.id)).toEqual(["diamonds-7"]);
    expect(getPlayableCards(hand, emptyBoard(), "dealer-left")).toHaveLength(2);
  });
});

describe("several decks", () => {
  it("decks and ids scale: 104 unique cards, second copies suffixed", () => {
    const deck = makeDeck("high", 2);
    expect(deck).toHaveLength(104);
    expect(new Set(deck.map((c) => c.id)).size).toBe(104);
    expect(deck.find((c) => c.copy === 1)!.id).toBe("spades-2~1");
    for (const card of deck) expect(parseCardId(card.id, "high")).toEqual(card);
  });

  it("auto picks 1 deck up to 6 players, 2 up to 12, 3 beyond; explicit wins", () => {
    expect([2, 6, 7, 12, 13, 16].map((n) => resolveDecks("auto", n))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(resolveDecks(1, 16)).toBe(1);
    expect(resolveDecks(3, 2)).toBe(3);
  });

  it("each seven opens its own row, up to one per deck", () => {
    let b = emptyBoard(2);
    const first = placeCard(b, makeCard("hearts", 7, 0));
    b = first.board;
    const second = placeCard(b, makeCard("hearts", 7, 1));
    b = second.board;
    expect([first.row, second.row]).toEqual([0, 1]);
    expect(isPlayable(makeCard("hearts", 7, 0), b)).toBe(false); // both rows open
  });

  it("a card extends whichever row it fits", () => {
    const b = { ...emptyBoard(2), hearts: [{ low: 7, high: 9 }, { low: 5, high: 7 }] };
    expect(placeCard(b, makeCard("hearts", 10)).row).toBe(0);
    expect(placeCard(b, makeCard("hearts", 4)).row).toBe(1);
    expect(placeCard(b, makeCard("hearts", 8, 1)).row).toBe(1);
    expect(isPlayable(makeCard("hearts", 2), b)).toBe(false);
  });
});
