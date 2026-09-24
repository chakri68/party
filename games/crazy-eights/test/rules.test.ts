import { describe, expect, it } from "vitest";
import {
  cardPoints,
  compareCards,
  handPoints,
  isPlayable,
  makeDeck,
  parseCardId,
  resolveDecks,
  stockAfterDeal,
} from "../shared/rules.ts";

const c = (id: string) => parseCardId(id)!;

describe("cards", () => {
  it("round-trips ids, aces low", () => {
    expect(c("hearts-A")).toEqual({ id: "hearts-A", suit: "hearts", rank: 1, copy: 0 });
    expect(c("clubs-8~1")).toMatchObject({ rank: 8, copy: 1 });
    expect(parseCardId("hearts-1")).toBeNull();
    expect(parseCardId("stars-8")).toBeNull();
  });

  it("builds 52 unique cards per deck", () => {
    const two = makeDeck(2);
    expect(two).toHaveLength(104);
    expect(new Set(two.map((x) => x.id)).size).toBe(104);
  });

  it("sorts eights to the end of the hand", () => {
    const hand = ["hearts-8", "spades-K", "clubs-8", "spades-2"].map(c).sort(compareCards);
    expect(hand.map((x) => x.id)).toEqual(["spades-2", "spades-K", "hearts-8", "clubs-8"]);
  });
});

describe("isPlayable", () => {
  const top = c("hearts-5");

  it("matches suit or rank", () => {
    expect(isPlayable(c("hearts-K"), top, null)).toBe(true);
    expect(isPlayable(c("spades-5"), top, null)).toBe(true);
    expect(isPlayable(c("spades-K"), top, null)).toBe(false);
  });

  it("lets eights go on anything", () => {
    expect(isPlayable(c("clubs-8"), top, null)).toBe(true);
  });

  it("after an eight, only the called suit or another eight", () => {
    const eight = c("hearts-8");
    expect(isPlayable(c("spades-3"), eight, "spades")).toBe(true);
    expect(isPlayable(c("hearts-3"), eight, "spades")).toBe(false); // the eight's own suit doesn't count
    expect(isPlayable(c("diamonds-8"), eight, "spades")).toBe(true);
  });
});

describe("scoring", () => {
  it("uses Bicycle's values", () => {
    expect(cardPoints(c("hearts-8"))).toBe(50);
    expect(cardPoints(c("hearts-10"))).toBe(10);
    expect(cardPoints(c("hearts-K"))).toBe(10);
    expect(cardPoints(c("hearts-A"))).toBe(1);
    expect(cardPoints(c("hearts-7"))).toBe(7);
    expect(handPoints(["spades-8", "clubs-Q", "hearts-A", "hearts-3"].map(c))).toBe(64);
  });
});

describe("decks", () => {
  it("auto: one deck to 5 players, two beyond", () => {
    expect(resolveDecks("auto", 5)).toBe(1);
    expect(resolveDecks("auto", 6)).toBe(2);
    expect(resolveDecks(1, 9)).toBe(1);
  });

  it("always leaves a stock", () => {
    expect(stockAfterDeal(1, 2)).toBe(41);
    expect(stockAfterDeal(1, 10)).toBe(1);
    expect(stockAfterDeal(2, 10)).toBe(53);
  });
});
