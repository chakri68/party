import { describe, expect, it } from "vitest";
import {
  dealerDraws,
  dealerPeeks,
  handResult,
  handTotal,
  isBlackjack,
  isPair,
  makeShoe,
  parseCardId,
  payout,
  totalLabel,
} from "../shared/rules.ts";
import { SHOE_CARDS } from "../shared/types.ts";

const cards = (...ids: string[]) => ids.map((id) => parseCardId(id)!);
const hand = (split: boolean, ...ids: string[]) => ({ cards: cards(...ids), split });

describe("cards", () => {
  it("reads ids, with the Ace as 1 and faces as 11 to 13", () => {
    expect(parseCardId("hearts-A")).toEqual({ id: "hearts-A", suit: "hearts", rank: 1 });
    expect(parseCardId("spades-10")!.rank).toBe(10);
    expect(parseCardId("clubs-K")!.rank).toBe(13);
    expect(parseCardId("hearts-1")).toBeNull();
    expect(parseCardId("stars-5")).toBeNull();
  });

  it("makes a shoe of 6 decks", () => {
    const shoe = makeShoe();
    expect(shoe).toHaveLength(SHOE_CARDS);
    expect(shoe.filter((id) => id === "hearts-A")).toHaveLength(6);
    expect(new Set(shoe).size).toBe(52);
  });
});

describe("hand totals", () => {
  it("counts faces as 10", () => {
    expect(handTotal(cards("hearts-K", "spades-Q"))).toEqual({ total: 20, soft: false });
    expect(handTotal(cards("hearts-J", "spades-5", "clubs-3"))).toEqual({ total: 18, soft: false });
  });

  it("counts one Ace as 11 when that stays under 22 (a soft total)", () => {
    expect(handTotal(cards("hearts-A", "spades-6"))).toEqual({ total: 17, soft: true });
    expect(handTotal(cards("hearts-A", "spades-6", "clubs-9"))).toEqual({ total: 16, soft: false });
    expect(handTotal(cards("hearts-A", "spades-A"))).toEqual({ total: 12, soft: true });
    expect(handTotal(cards("hearts-A", "spades-A", "clubs-9"))).toEqual({ total: 21, soft: true });
    expect(handTotal(cards("hearts-A", "spades-A", "clubs-A", "diamonds-A"))).toEqual({ total: 14, soft: true });
  });

  it("goes over 21 only when no Ace can drop to 1", () => {
    expect(handTotal(cards("hearts-K", "spades-Q", "clubs-2"))).toEqual({ total: 22, soft: false });
    expect(handTotal(cards("hearts-K", "spades-Q", "clubs-A"))).toEqual({ total: 21, soft: false });
  });

  it("labels totals", () => {
    expect(totalLabel(cards("hearts-A", "spades-6"))).toBe("Soft 17");
    expect(totalLabel(cards("hearts-10", "spades-6"))).toBe("16");
    expect(totalLabel(cards("hearts-A", "spades-K"))).toBe("Blackjack");
    expect(totalLabel(cards("hearts-A", "spades-K"), true)).toBe("21");
    expect(totalLabel(cards("hearts-10", "spades-6", "clubs-8"))).toBe("Bust 24");
  });
});

describe("blackjack", () => {
  it("is an Ace and a 10-value card as the first two cards", () => {
    expect(isBlackjack(cards("hearts-A", "spades-10"))).toBe(true);
    expect(isBlackjack(cards("spades-Q", "hearts-A"))).toBe(true);
    expect(isBlackjack(cards("hearts-A", "spades-5", "clubs-5"))).toBe(false);
    expect(isBlackjack(cards("hearts-7", "spades-7", "clubs-7"))).toBe(false);
  });

  it("is never a split hand", () => {
    expect(isBlackjack(cards("hearts-A", "spades-K"), true)).toBe(false);
  });

  it("beats a 21 made of more cards", () => {
    expect(handResult(hand(false, "hearts-A", "spades-K"), cards("clubs-7", "clubs-4", "clubs-K"))).toBe("blackjack");
    expect(handResult(hand(false, "hearts-7", "spades-4", "clubs-K"), cards("clubs-A", "diamonds-Q"))).toBe("lose");
  });

  it("ties with a dealer Blackjack", () => {
    expect(handResult(hand(false, "hearts-A", "spades-K"), cards("clubs-A", "diamonds-Q"))).toBe("push");
  });

  it("a split 21 is only a 21", () => {
    expect(handResult(hand(true, "hearts-A", "spades-K"), cards("clubs-7", "clubs-4", "clubs-K"))).toBe("push");
    expect(handResult(hand(true, "hearts-A", "spades-K"), cards("clubs-10", "clubs-9"))).toBe("win");
  });
});

describe("the dealer", () => {
  it("peeks under an Ace or a 10-value card", () => {
    expect(dealerPeeks(parseCardId("hearts-A")!)).toBe(true);
    expect(dealerPeeks(parseCardId("hearts-10")!)).toBe(true);
    expect(dealerPeeks(parseCardId("hearts-J")!)).toBe(true);
    expect(dealerPeeks(parseCardId("hearts-9")!)).toBe(false);
  });

  it("stands on every 17, soft ones too", () => {
    expect(dealerDraws(cards("hearts-10", "spades-6"))).toBe(true);
    expect(dealerDraws(cards("hearts-10", "spades-7"))).toBe(false);
    expect(dealerDraws(cards("hearts-A", "spades-6"))).toBe(false);
    expect(dealerDraws(cards("hearts-A", "spades-5"))).toBe(true);
  });
});

describe("results and pay", () => {
  it("compares totals", () => {
    expect(handResult(hand(false, "hearts-10", "spades-9"), cards("clubs-10", "clubs-8"))).toBe("win");
    expect(handResult(hand(false, "hearts-10", "spades-8"), cards("clubs-10", "clubs-8"))).toBe("push");
    expect(handResult(hand(false, "hearts-10", "spades-7"), cards("clubs-10", "clubs-8"))).toBe("lose");
    expect(handResult(hand(false, "hearts-10", "spades-2"), cards("clubs-10", "clubs-6", "clubs-9"))).toBe("win");
  });

  it("a bust loses even when the dealer busts too", () => {
    expect(handResult(hand(false, "hearts-10", "spades-6", "clubs-8"), cards("clubs-10", "clubs-6", "clubs-9"))).toBe("bust");
  });

  it("pays 1 to 1, 3 to 2 for Blackjack rounded down, and the bet back on a tie", () => {
    expect(payout("win", 100)).toBe(200);
    expect(payout("blackjack", 100)).toBe(250);
    expect(payout("blackjack", 15)).toBe(37);
    expect(payout("blackjack", 25)).toBe(62);
    expect(payout("blackjack", 11)).toBe(27);
    expect(payout("push", 40)).toBe(40);
    expect(payout("lose", 40)).toBe(0);
    expect(payout("bust", 40)).toBe(0);
  });
});

describe("pairs", () => {
  it("are two cards of the same rank", () => {
    expect(isPair(cards("hearts-8", "spades-8"))).toBe(true);
    expect(isPair(cards("hearts-K", "spades-K"))).toBe(true);
    expect(isPair(cards("hearts-K", "spades-Q"))).toBe(false);
    expect(isPair(cards("hearts-8", "spades-8", "clubs-8"))).toBe(false);
  });
});
