import { describe, expect, it } from "vitest";
import {
  awardPots,
  bestHand,
  bestHandFor,
  blindsFor,
  buildPots,
  compareHands,
  handScoreFor,
  isPotLimit,
  levelIndexFor,
  makeDeck,
  parseCardId,
} from "../shared/rules.ts";
import type { Card } from "../shared/types.ts";

/** "As Kd Th 9c 2s" → cards. T is ten. */
function cards(text: string): Card[] {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text.split(/\s+/).map((t) => {
    const r = t.slice(0, -1).replace("T", "10");
    const card = parseCardId(`${suit[t.at(-1) as keyof typeof suit]}-${r}`);
    if (!card) throw new Error(`bad card ${t}`);
    return card;
  });
}

const hand = (text: string) => bestHand(cards(text));

describe("buildPots", () => {
  it("one all-in under two callers: a main pot for three and a side pot for two", () => {
    expect(buildPots({ a: 100, b: 300, c: 300 }, [])).toEqual([
      { amount: 300, eligible: ["a", "b", "c"] },
      { amount: 400, eligible: ["b", "c"] },
    ]);
  });

  it("three different all-in amounts make three pots", () => {
    expect(buildPots({ a: 50, b: 150, c: 300, d: 300 }, [])).toEqual([
      { amount: 200, eligible: ["a", "b", "c", "d"] },
      { amount: 300, eligible: ["b", "c", "d"] },
      { amount: 300, eligible: ["c", "d"] },
    ]);
  });

  it("a folded player's chips stay in the pots they reached, and they can't win them", () => {
    // d put in 250 and folded: 100 in the main pot, 150 in the side pot.
    expect(buildPots({ a: 100, b: 400, c: 400, d: 250 }, ["d"])).toEqual([
      { amount: 400, eligible: ["a", "b", "c"] },
      { amount: 750, eligible: ["b", "c"] },
    ]);
  });

  it("an uncalled bet goes back to the bettor", () => {
    expect(buildPots({ a: 500, b: 200 }, [])).toEqual([
      { amount: 400, eligible: ["a", "b"] },
      { amount: 300, eligible: ["a"], uncalled: true },
    ]);
  });

  it("uncalled is only the unmatched part: a folder's chips above the caller still count", () => {
    // b all-in 100, c folded after 300, a bet 600. 300 of a's is unmatched by anyone.
    expect(buildPots({ a: 600, b: 100, c: 300 }, ["c"])).toEqual([
      { amount: 300, eligible: ["a", "b"] },
      { amount: 400, eligible: ["a"] },
      { amount: 300, eligible: ["a"], uncalled: true },
    ]);
  });

  it("everyone in for the same: one pot", () => {
    expect(buildPots({ a: 40, b: 40, c: 40, d: 20 }, ["d"])).toEqual([{ amount: 140, eligible: ["a", "b", "c"] }]);
  });

  it("skips players who put nothing in", () => {
    expect(buildPots({ a: 20, b: 20, c: 0 }, ["c"])).toEqual([{ amount: 40, eligible: ["a", "b"] }]);
  });
});

describe("awardPots", () => {
  // Hand strengths as tiebreak tuples: higher wins.
  const strong = [1, 14];
  const weak = [0, 9];

  it("ties within a side pot split it, while the main pot goes to the best hand", () => {
    const pots = buildPots({ a: 100, b: 400, c: 400 }, []);
    const { won, results } = awardPots(pots, { a: [2, 5], b: strong, c: strong }, ["a", "b", "c"]);
    expect(results.map((r) => r.winners)).toEqual([["a"], ["b", "c"]]);
    expect(won).toEqual({ a: 300, b: 300, c: 300 });
  });

  it("odd chips go to the first tied winner left of the button", () => {
    // Seat order from the button's left: c, a, b.
    const pots = [{ amount: 301, eligible: ["a", "b", "c"] }];
    const { won } = awardPots(pots, { a: strong, b: weak, c: strong }, ["c", "a", "b"]);
    expect(won).toEqual({ c: 151, a: 150 });
  });

  it("a three-way split with two odd chips gives both to the first winner", () => {
    const pots = [{ amount: 302, eligible: ["a", "b", "c"] }];
    const { won } = awardPots(pots, { a: strong, b: strong, c: strong }, ["b", "c", "a"]);
    expect(won).toEqual({ b: 102, c: 100, a: 100 });
  });

  it("an uncalled bet comes back without needing a hand", () => {
    const pots = buildPots({ a: 500, b: 200 }, []);
    const { won, returned, results } = awardPots(pots, { a: weak, b: strong }, ["a", "b"]);
    expect(won).toEqual({ b: 400 });
    expect(returned).toEqual({ a: 300 });
    expect(results.at(-1)).toMatchObject({ uncalled: true, winners: ["a"], amount: 300 });
  });
});

describe("bestHand", () => {
  it("names every category", () => {
    expect(hand("As Kd 9h 7c 4s 3d 2h").label).toBe("High card, Ace");
    expect(hand("9s 9d Ah 7c 4s 3d 2h").label).toBe("Pair of Nines");
    expect(hand("Ks Kd 5h 5c As 3d 2h").label).toBe("Two pair, Kings and Fives");
    expect(hand("7s 7d 7h Kc 4s 3d 2h").label).toBe("Three of a kind, Sevens");
    expect(hand("9s 8d 7h 6c 5s Kd 2h").label).toBe("Straight, Nine high");
    expect(hand("Ah Jh 8h 4h 2h Kd 3c").label).toBe("Flush, Ace high");
    expect(hand("Ks Kd Kh 5c 5s 3d 2h").label).toBe("Full house, Kings over Fives");
    expect(hand("Qs Qd Qh Qc 5s 3d 2h").label).toBe("Four of a kind, Queens");
    expect(hand("9h 8h 7h 6h 5h Kd 2c").label).toBe("Straight flush, Nine high");
    expect(hand("Ah Kh Qh Jh Th 2d 3c").label).toBe("Royal flush");
    expect(hand("9h 8h 7h 6h 5h Kd 2c").category).toBe(8);
  });

  it("ranks the categories in order", () => {
    const ladder = [
      "As Kd 9h 7c 4s 3d 2h",
      "9s 9d Ah 7c 4s 3d 2h",
      "Ks Kd 5h 5c As 3d 2h",
      "7s 7d 7h Kc 4s 3d 2h",
      "9s 8d 7h 6c 5s Kd 2h",
      "Ah Jh 8h 4h 2h Kd 3c",
      "Ks Kd Kh 5c 5s 3d 2h",
      "Qs Qd Qh Qc 5s 3d 2h",
      "9h 8h 7h 6h 5h Kd 2c",
    ].map(hand);
    for (let i = 1; i < ladder.length; i++) expect(compareHands(ladder[i]!, ladder[i - 1]!)).toBeGreaterThan(0);
  });

  it("kickers decide a pair against the same pair", () => {
    const a = hand("9s 9d Ah Qc 4s 3d 2h");
    const b = hand("9h 9c Ad Jc 4d 3s 2c");
    expect(compareHands(a, b)).toBeGreaterThan(0);
    expect(a.ranks).toEqual([1, 9, 14, 12, 4]);
  });

  it("two pair: the fifth card kicks", () => {
    expect(compareHands(hand("Ks Kd 5h 5c Qs 3d 2h"), hand("Kh Kc 5s 5d Js 3c 2d"))).toBeGreaterThan(0);
  });

  it("three pairs: the best two plus the best kicker", () => {
    const v = hand("Ks Kd 5h 5c 4s 4d 2h");
    expect(v.ranks).toEqual([2, 13, 5, 4]);
  });

  it("the wheel is a five-high straight", () => {
    const wheel = hand("As 2d 3h 4c 5s Kd 9h");
    expect(wheel.label).toBe("Straight, Five high");
    expect(wheel.ranks).toEqual([4, 5]);
    expect(compareHands(hand("2s 3d 4h 5c 6s Kd 9h"), wheel)).toBeGreaterThan(0);
  });

  it("broadway beats king-high", () => {
    const broadway = hand("As Kd Qh Jc Ts 3d 2h");
    expect(broadway.label).toBe("Straight, Ace high");
    expect(compareHands(broadway, hand("Ks Qd Jh Tc 9s 3d 2h"))).toBeGreaterThan(0);
  });

  it("a flush beats a straight", () => {
    expect(compareHands(hand("2h 5h 7h 9h Jh 3c 4d"), hand("9s 8d 7h 6c 5s Kd 2h"))).toBeGreaterThan(0);
  });

  it("full house over full house: trips first, then the pair", () => {
    expect(compareHands(hand("Ks Kd Kh 2c 2s 3d 4h"), hand("Qs Qd Qh Ac As 3c 4c"))).toBeGreaterThan(0);
    expect(compareHands(hand("Ks Kd Kh 9c 9s 3d 4h"), hand("Kc Ks Kh 8c 8s 3c 4c"))).toBeGreaterThan(0);
  });

  it("two trips make a full house with the lower as the pair", () => {
    expect(hand("Ks Kd Kh 9c 9s 9d 4h").label).toBe("Full house, Kings over Nines");
  });

  it("the board plays: both players split", () => {
    const board = "As Kd Qh Jc Ts";
    const a = hand(`${board} 2c 3d`);
    const b = hand(`${board} 4c 4d`);
    expect(compareHands(a, b)).toBe(0);
    expect(a.cards.sort()).toEqual(cards(board).map((c) => c.id).sort());
  });

  it("a straight flush on the wheel, beating a plain wheel and a six-high straight", () => {
    const sf = hand("Ah 2h 3h 4h 5h Kd 6c");
    expect(sf.label).toBe("Straight flush, Five high");
    expect(sf.ranks).toEqual([8, 5]);
    expect(compareHands(sf, hand("2s 3d 4h 5c 6s Kd 9h"))).toBeGreaterThan(0);
  });

  it("picks the flush's best five, not the first five", () => {
    expect(hand("2h 5h 7h 9h Jh Ah 3c").ranks).toEqual([5, 14, 11, 9, 7, 5]);
  });

  it("returns the five cards that make it, deciding cards first", () => {
    const v = hand("9s 9d Ah 7c 4s 3d 2h");
    expect(v.cards).toEqual(["spades-9", "diamonds-9", "hearts-A", "clubs-7", "spades-4"]);
  });

  it("works on exactly five cards", () => {
    expect(hand("Ks Kd Kh 5c 5s").label).toBe("Full house, Kings over Fives");
  });
});

describe("deck and blinds", () => {
  it("52 different cards", () => {
    expect(new Set(makeDeck().map((c) => c.id)).size).toBe(52);
  });

  it("follows the level table, then doubles", () => {
    expect(blindsFor(0)).toEqual({ sb: 10, bb: 20 });
    expect(blindsFor(4)).toEqual({ sb: 75, bb: 150 });
    expect(blindsFor(9)).toEqual({ sb: 500, bb: 1000 });
    expect(blindsFor(10)).toEqual({ sb: 1000, bb: 2000 });
    expect(blindsFor(11)).toEqual({ sb: 2000, bb: 4000 });
  });

  it("levels count hands", () => {
    expect(levelIndexFor(1, 6)).toBe(0);
    expect(levelIndexFor(6, 6)).toBe(0);
    expect(levelIndexFor(7, 6)).toBe(1);
    expect(levelIndexFor(13, 6)).toBe(2);
  });
});

describe("Omaha hands: exactly 2 private cards and exactly 3 shared", () => {
  const omaha = (hole: string, board: string) => bestHandFor("omaha", cards(hole), cards(board));

  it.each([
    // Best of all nine would be wrong in each of these.
    ["4 hearts on the board and 1 in hand: no flush", "Qh 3s 4d 8c", "Ah Kh 7h 2h 9c", "High card, Ace"],
    ["4 spades in hand and 1 on the board: no flush, no straight", "As Ks Qs Js", "Ts 2h 3d 7c 9h", "High card, Ace"],
    ["four of a kind on the board: only three of them play", "Ah Kd Qc Js", "9s 9h 9d 9c 2h", "Three of a kind, Nines"],
    ["a straight on the board does not count", "Ac Ad Kc Kd", "5h 6s 7h 8s 9d", "Pair of Aces"],
    ["one card in hand makes no straight", "Ts 2c 2d 3h", "Js Qd Kc Ah 4d", "Pair of Twos"],
    // And the 2+3 hands that are real.
    ["2 hearts in hand and 3 on the board: a flush", "Qh 3h 4d 8c", "Ah Kh 7h 2c 9c", "Flush, Ace high"],
    ["a pair in hand and trips on the board: a full house", "Ac Ad 7h 8h", "Kh Kd Ks 5c 2d", "Full house, Kings over Aces"],
    ["2 in hand and 3 on the board: a straight", "Js Ts 2c 2d", "Qs 9h 3h 8d Ah", "Straight, Queen high"],
  ])("%s", (_, hole, board, label) => {
    expect(omaha(hole, board).label).toBe(label);
  });

  it("the five always use 2 private cards and 3 shared", () => {
    const deck = makeDeck();
    for (let i = 0; i < 200; i++) {
      // A fixed walk through the deck: different hands, no randomness.
      const picked = Array.from({ length: 9 }, (_, k) => deck[(i * 7 + k * 5) % 52]!);
      if (new Set(picked.map((c) => c.id)).size < 9) continue;
      const hole = picked.slice(0, 4);
      const board = picked.slice(4);
      const best = bestHandFor("omaha", hole, board);
      expect(best.cards.filter((id) => hole.some((c) => c.id === id))).toHaveLength(2);
      expect(best.cards.filter((id) => board.some((c) => c.id === id))).toHaveLength(3);
    }
  });

  it("works on the flop: 3 shared cards, all of them play", () => {
    expect(omaha("Ah Ad Kc 2s", "As 7d 3c").label).toBe("Three of a kind, Aces");
  });

  it("scores in the same order as the hand values", () => {
    const pairs = [
      ["Qh 3s 4d 8c", "Ac 5d 6s Tc", "Ah Kh 7h 2h 9c"],
      ["As Ks Qs Js", "2c 3c 8d 8h", "Ts 2h 3d 7c 9h"],
      ["Ac Ad 7h 8h", "Kc 5s 6d 6h", "Kh Kd Ks 5c 2d"],
    ];
    for (const [a, b, board] of pairs) {
      const va = bestHandFor("omaha", cards(a!), cards(board!));
      const vb = bestHandFor("omaha", cards(b!), cards(board!));
      const sa = handScoreFor("omaha", cards(a!), cards(board!));
      const sb = handScoreFor("omaha", cards(b!), cards(board!));
      expect(Math.sign(sa - sb), `${a} vs ${b} on ${board}`).toBe(Math.sign(compareHands(va, vb)));
    }
  });

  it("Hold'em keeps the best five of all seven", () => {
    const hole = cards("Qh 3s");
    const board = cards("Ah Kh 7h 2h 9c");
    expect(bestHandFor("holdem", hole, board)).toEqual(bestHand([...hole, ...board]));
    expect(bestHandFor("holdem", hole, board).label).toBe("Flush, Ace high");
  });

  it("only Omaha is pot-limit", () => {
    expect(isPotLimit("omaha")).toBe(true);
    expect(isPotLimit("holdem")).toBe(false);
  });
});
