import { describe, expect, it } from "vitest";
import { compareCards, handSize, makeDeck, parseCardId, pondAfterDeal, rankPlural, ranksHeld, takeBooks } from "../shared/rules.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

describe("takeBooks", () => {
  it("takes all four of a rank and leaves threes alone", () => {
    const { books, rest } = takeBooks(cards(["spades-7", "hearts-7", "clubs-7", "diamonds-7", "spades-K", "hearts-K", "clubs-K", "hearts-2"]));
    expect(books.map((b) => b.map((c) => c.id))).toEqual([["spades-7", "hearts-7", "clubs-7", "diamonds-7"]]);
    expect(rest.map((c) => c.id)).toEqual(["spades-K", "hearts-K", "clubs-K", "hearts-2"]);
  });

  it("can take two books at once, low rank first", () => {
    const hand = cards(["spades-K", "spades-A", "hearts-K", "hearts-A", "clubs-K", "clubs-A", "diamonds-K", "diamonds-A"]);
    const { books, rest } = takeBooks(hand);
    expect(books.map((b) => b[0]!.rank)).toEqual([1, 13]);
    expect(rest).toEqual([]);
  });
});

describe("dealing", () => {
  it("deals seven to two or three, five to more", () => {
    expect([2, 3, 4, 5, 6].map(handSize)).toEqual([7, 7, 5, 5, 5]);
    expect([2, 3, 4, 6].map(pondAfterDeal)).toEqual([38, 31, 32, 22]);
  });

  it("has 52 distinct cards that parse round-trip", () => {
    const deck = makeDeck();
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    for (const c of deck) expect(parseCardId(c.id)).toEqual(c);
    expect(parseCardId("hearts-8~1")).toBeNull();
    expect(parseCardId("cups-3")).toBeNull();
  });
});

it("sorts by rank so a rank's cards sit together, and lists the ranks held", () => {
  const hand = cards(["diamonds-9", "spades-2", "hearts-9", "clubs-A"]).sort(compareCards);
  expect(hand.map((c) => c.id)).toEqual(["clubs-A", "spades-2", "hearts-9", "diamonds-9"]);
  expect(ranksHeld(hand)).toEqual([1, 2, 9]);
});

it("rankPlural", () => {
  expect([1, 6, 7, 10, 12].map(rankPlural)).toEqual(["Aces", "Sixes", "Sevens", "Tens", "Queens"]);
});
