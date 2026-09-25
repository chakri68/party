import { describe, expect, it } from "vitest";
import {
  bestCards,
  checkPlay,
  compareCards,
  makeDeck,
  ordinal,
  parseCardId,
  playableRanks,
  pointsFor,
  power,
  setName,
  titleFor,
  tributes,
  worstCards,
} from "../shared/rules.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);
const onTop = (ids: string[]) => ({ playerId: "p0", cards: cards(ids) });

describe("ranks", () => {
  it("runs 3 low through K, A, then 2 on top", () => {
    const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];
    expect(order.map(power)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const sorted = [...makeDeck()].sort(compareCards);
    expect(sorted[0]!.id).toBe("clubs-3");
    expect(sorted.at(-1)!.id).toBe("spades-2");
  });

  it("takes the best cards for tribute and the worst for a skipped return", () => {
    const hand = cards(["hearts-5", "spades-2", "clubs-A", "diamonds-2", "clubs-3"]);
    expect(bestCards(hand, 2).map((c) => c.id)).toEqual(["diamonds-2", "spades-2"]);
    expect(worstCards(hand, 2).map((c) => c.id)).toEqual(["clubs-3", "hearts-5"]);
  });
});

describe("checkPlay", () => {
  it("leads any single, pair, triple or quad of one rank", () => {
    expect(checkPlay(cards(["hearts-7"]), null, false)).toBeNull();
    expect(checkPlay(cards(["hearts-7", "clubs-7", "spades-7", "diamonds-7"]), null, false)).toBeNull();
    expect(checkPlay(cards(["hearts-7", "clubs-8"]), null, false)).toMatch(/one rank/);
    expect(checkPlay([], null, false)).toMatch(/one to four/);
  });

  it("follows with the same count, strictly higher", () => {
    const pair9 = onTop(["hearts-9", "clubs-9"]);
    expect(checkPlay(cards(["hearts-10", "clubs-10"]), pair9, false)).toBeNull();
    expect(checkPlay(cards(["hearts-2", "clubs-2"]), pair9, false)).toBeNull();
    expect(checkPlay(cards(["hearts-8", "clubs-8"]), pair9, false)).toMatch(/doesn't beat a pair of Nines/);
    expect(checkPlay(cards(["hearts-K"]), pair9, false)).toMatch(/pairs this trick/);
    expect(checkPlay(cards(["hearts-K", "clubs-K", "spades-K"]), pair9, false)).toMatch(/pairs/);
  });

  it("aces beat kings, twos beat aces", () => {
    expect(checkPlay(cards(["hearts-A"]), onTop(["clubs-K"]), false)).toBeNull();
    expect(checkPlay(cards(["hearts-2"]), onTop(["clubs-A"]), false)).toBeNull();
    expect(checkPlay(cards(["hearts-A"]), onTop(["clubs-2"]), false)).not.toBeNull();
  });

  it("lets an equal rank through only with the house rule", () => {
    const six = onTop(["clubs-6"]);
    expect(checkPlay(cards(["hearts-6"]), six, false)).toMatch(/a single Six/);
    expect(checkPlay(cards(["hearts-6"]), six, true)).toBeNull();
  });
});

describe("playableRanks", () => {
  const hand = cards(["clubs-4", "hearts-9", "spades-9", "clubs-K", "diamonds-K", "hearts-K", "spades-2"]);

  it("is every rank on a lead", () => {
    expect(playableRanks(hand, null, false)).toEqual([4, 9, 13, 2]);
  });

  it("needs enough of a higher rank to follow", () => {
    expect(playableRanks(hand, onTop(["clubs-8"]), false)).toEqual([9, 13, 2]);
    expect(playableRanks(hand, onTop(["clubs-8", "hearts-8"]), false)).toEqual([9, 13]);
    expect(playableRanks(hand, onTop(["clubs-9", "hearts-9"]), false)).toEqual([13]);
    expect(playableRanks(hand, onTop(["clubs-9", "diamonds-9"]), true)).toEqual([9, 13]);
    expect(playableRanks(hand, onTop(["clubs-A", "hearts-A", "spades-A"]), false)).toEqual([]);
  });
});

describe("standing", () => {
  it("titles: vices from four players", () => {
    expect([1, 2, 3].map((p) => titleFor(p, 3))).toEqual(["President", "Citizen", "Asshole"]);
    expect([1, 2, 3, 4].map((p) => titleFor(p, 4))).toEqual(["President", "Vice-President", "Vice-Asshole", "Asshole"]);
    expect([1, 2, 3, 4, 5].map((p) => titleFor(p, 5))).toEqual(["President", "Vice-President", "Citizen", "Vice-Asshole", "Asshole"]);
  });

  it("a point per player beaten", () => {
    expect([1, 2, 3, 4].map((p) => pointsFor(p, 4))).toEqual([3, 2, 1, 0]);
  });

  it("tributes: two from the bottom, one from the second-bottom with four or more", () => {
    expect(tributes(["a", "b", "c"])).toEqual([{ fromId: "c", toId: "a", count: 2 }]);
    expect(tributes(["a", "b", "c", "d", "e"])).toEqual([
      { fromId: "e", toId: "a", count: 2 },
      { fromId: "d", toId: "b", count: 1 },
    ]);
    expect(tributes(["a"])).toEqual([]);
  });

  it("names sets", () => {
    expect(setName(1, 12)).toBe("a single Queen");
    expect(setName(2, 6)).toBe("a pair of Sixes");
    expect(setName(3, 2)).toBe("three Twos");
    expect(setName(4, 1)).toBe("four Aces");
    expect([1, 2, 3, 11].map(ordinal)).toEqual(["1st", "2nd", "3rd", "11th"]);
  });
});
