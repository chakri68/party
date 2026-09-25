import { describe, expect, it } from "vitest";
import { allowedClaims, claimText, compareCards, isHonest, makeDeck, nextRank, parseCardId, prevRank, resolveDecks } from "../shared/rules.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

describe("claims", () => {
  it("starts on Aces and goes up one at a time, K wrapping to A", () => {
    expect(allowedClaims(null, "strict")).toEqual([1]);
    expect(allowedClaims(null, "near")).toEqual([1]);
    expect(allowedClaims(1, "strict")).toEqual([2]);
    expect(allowedClaims(12, "strict")).toEqual([13]);
    expect(allowedClaims(13, "strict")).toEqual([1]);
    expect([nextRank(13), prevRank(1)]).toEqual([1, 13]);
  });

  it("near: the same rank, or one either side, wrapping both ways", () => {
    expect(allowedClaims(7, "near")).toEqual([6, 7, 8]);
    expect(allowedClaims(1, "near")).toEqual([13, 1, 2]);
    expect(allowedClaims(13, "near")).toEqual([12, 13, 1]);
  });

  it("a play is honest only if every card is the claimed rank", () => {
    expect(isHonest(cards(["spades-7", "hearts-7"]), 7)).toBe(true);
    expect(isHonest(cards(["spades-7", "hearts-8"]), 7)).toBe(false);
    expect(isHonest(cards(["spades-K"]), 1)).toBe(false);
  });

  it("says claims out loud", () => {
    expect(claimText(1, 1)).toBe("one Ace");
    expect(claimText(3, 6)).toBe("three Sixes");
    expect(claimText(2, 12)).toBe("two Queens");
  });
});

describe("decks", () => {
  it("one deck up to six players, two from seven", () => {
    expect([3, 6, 7, 10].map((n) => resolveDecks("auto", n))).toEqual([1, 1, 2, 2]);
    expect(resolveDecks(2, 3)).toBe(2);
  });

  it("makes unique ids across two decks, sorted by rank first", () => {
    const deck = makeDeck(2);
    expect(new Set(deck.map((c) => c.id)).size).toBe(104);
    const sorted = [...deck].sort(compareCards);
    expect(sorted.slice(0, 8).every((c) => c.rank === 1)).toBe(true);
    expect(sorted[1]!.id).toBe("spades-A~1");
  });

  it("parses ids round-trip and rejects junk", () => {
    expect(parseCardId("hearts-Q")).toEqual({ id: "hearts-Q", suit: "hearts", rank: 12, copy: 0 });
    expect(parseCardId("clubs-10~1")).toEqual({ id: "clubs-10~1", suit: "clubs", rank: 10, copy: 1 });
    expect(parseCardId("cups-3")).toBeNull();
    expect(parseCardId("hearts-1")).toBeNull();
  });
});
