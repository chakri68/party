import { seededRandomInt, shuffle } from "@games/game-core";
import { describe, expect, it } from "vitest";
import {
  bootFor,
  chaalFor,
  compareHands,
  displayOrder,
  doubleFor,
  evaluate,
  handOrder,
  handScore,
  levelIndexFor,
  makeDeck,
  parseCardId,
  potLimitFor,
  stakeAfter,
} from "../shared/rules.ts";
import { teenPattiManifest } from "../shared/manifest.ts";
import type { Card } from "../shared/types.ts";

/** "As Kd Th" → cards. T is ten. */
function cards(text: string): Card[] {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text.split(/\s+/).map((t) => {
    const card = parseCardId(`${suit[t.at(-1) as keyof typeof suit]}-${t.slice(0, -1).replace("T", "10")}`);
    if (!card) throw new Error(`bad card ${t}`);
    return card;
  });
}
const label = (t: string) => evaluate(cards(t)).label;
/** Positive: the first hand wins. */
const cmp = (a: string, b: string) => Math.sign(compareHands(cards(a), cards(b)));

describe("hand names", () => {
  it("names every class", () => {
    expect(label("As Ah Ad")).toBe("Trail of Aces");
    expect(label("Qh Kh Ah")).toBe("Pure sequence, A-K-Q");
    expect(label("2c Ac 3c")).toBe("Pure sequence, A-2-3");
    expect(label("5s 4d 3h")).toBe("Sequence, 5-4-3");
    expect(label("Ks 9s 2s")).toBe("Color, King high");
    expect(label("Kh Kd 4s")).toBe("Pair of Kings");
    expect(label("6s 6d 9c")).toBe("Pair of Sixes");
    expect(label("Ah 9d 4s")).toBe("High card, Ace");
  });

  it("lists the classes best first", () => {
    expect(handOrder()).toEqual(["Trail", "Pure sequence", "Sequence", "Color", "Pair", "High card"]);
  });
});

describe("hand order", () => {
  it("each class beats the next one down, even at its lowest", () => {
    const lowestToHighest = [
      ["2s 2h 2d", "Ah Kh Qh"], // the lowest Trail beats the best Pure sequence
      ["4h 3h 2h", "As Kd Qc"], // the lowest Pure sequence beats the best Sequence
      ["4s 3d 2c", "Ah Kh Jh"], // the lowest Sequence beats the best Color
      ["5h 3h 2h", "As Ad Kc"], // the lowest Color beats the best Pair
      ["2s 2d 3c", "Ah Kd Jc"], // the lowest Pair beats the best High card
    ];
    for (const [a, b] of lowestToHighest) expect(cmp(a!, b!), `${a} vs ${b}`).toBe(1);
  });

  it("A-A-A is the best Trail", () => {
    expect(cmp("As Ah Ad", "Ks Kh Kd")).toBe(1);
    expect(cmp("3s 3h 3d", "2s 2h 2d")).toBe(1);
  });

  it("runs: A-K-Q, then A-2-3, then K-Q-J down to 4-3-2", () => {
    const runs = ["As Kd Qc", "As 2d 3c", "Ks Qd Jc", "Qs Jd Tc", "Ts 9d 8c", "6s 5d 4c", "4s 3d 2c"];
    for (let i = 1; i < runs.length; i++) expect(cmp(runs[i - 1]!, runs[i]!), `${runs[i - 1]} over ${runs[i]}`).toBe(1);
    // The same order in one suit.
    expect(cmp("Ah Kh Qh", "Ah 2h 3h")).toBe(1);
    expect(cmp("Ah 2h 3h", "Kh Qh Jh")).toBe(1);
  });

  it("K-A-2 and Q-K-2 are not runs", () => {
    expect(evaluate(cards("Ks As 2d")).category).toBe(0);
    expect(evaluate(cards("Kh Ah 2h")).category).toBe(2);
    expect(evaluate(cards("Qs Ks 2d")).category).toBe(0);
  });

  it("ties go to the higher cards, high to low", () => {
    expect(cmp("Kh Kd 9s", "Kc Ks 8d")).toBe(1); // pair, then the third card
    expect(cmp("Qh Qd 2s", "Jc Js Ad")).toBe(1); // the pair first
    expect(cmp("Ah 9h 4h", "Ad 9d 3d")).toBe(1); // Color: the third card decides
    expect(cmp("Ks Jd 5c", "Kd Th 9c")).toBe(1); // High card: the second card decides
    expect(cmp("Ks Qd 9c", "Kd Qh 8c")).toBe(1);
  });

  it("suits never break a tie: fully equal hands split", () => {
    expect(cmp("As Kd 9c", "Ah Kc 9d")).toBe(0);
    expect(cmp("5s 4d 3c", "5h 4c 3d")).toBe(0);
    expect(cmp("Ah 2h 3h", "As 2s 3s")).toBe(0);
    expect(cmp("8s 8d 4c", "8h 8c 4d")).toBe(0);
  });

  it("handScore agrees with compareHands", () => {
    const rng = seededRandomInt(5);
    for (let i = 0; i < 3000; i++) {
      const deck = shuffle(makeDeck(), rng);
      const a = deck.slice(0, 3);
      const b = deck.slice(3, 6);
      expect(Math.sign(handScore(a) - handScore(b)), `${a.map((c) => c.id)} vs ${b.map((c) => c.id)}`).toBe(Math.sign(compareHands(a, b)));
    }
  });

  it("shows a hand high card first, a pair first, and A-2-3 as A, 2, 3", () => {
    const ids = (t: string) => displayOrder(cards(t)).map((c) => c.id);
    expect(ids("4s Kd 9c")).toEqual(["diamonds-K", "clubs-9", "spades-4"]);
    expect(ids("4s Kd 4c")).toEqual(["spades-4", "clubs-4", "diamonds-K"]);
    expect(ids("3s 2d Ac")).toEqual(["clubs-A", "diamonds-2", "spades-3"]);
  });
});

describe("deck", () => {
  it("has 52 different cards", () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });
});

describe("boot, stake and the pot limit", () => {
  it("the boot goes up a level at a time, then doubles", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(bootFor)).toEqual([10, 20, 30, 50, 80, 100, 150, 200, 300, 500]);
    expect(bootFor(10)).toBe(1000);
    expect(bootFor(11)).toBe(2000);
  });

  it("a level lasts the set number of hands", () => {
    expect([1, 6, 7, 12, 13].map((n) => levelIndexFor(n, 6))).toEqual([0, 0, 1, 1, 2]);
    expect([1, 4, 5].map((n) => levelIndexFor(n, 4))).toEqual([0, 0, 1]);
  });

  it("Blind bets 1x or 2x the stake; Seen bets 2x or 4x", () => {
    expect(chaalFor(20, false)).toBe(20);
    expect(doubleFor(20, false)).toBe(40);
    expect(chaalFor(20, true)).toBe(40);
    expect(doubleFor(20, true)).toBe(80);
  });

  it("the bigger bet doubles the stake, Blind or Seen; the normal bet keeps it", () => {
    expect(stakeAfter(doubleFor(20, false), false)).toBe(40);
    expect(stakeAfter(doubleFor(20, true), true)).toBe(40);
    expect(stakeAfter(chaalFor(20, false), false)).toBe(20);
    expect(stakeAfter(chaalFor(20, true), true)).toBe(20);
  });

  it("the pot limit is 256 boots", () => {
    expect(potLimitFor(10)).toBe(2560);
    expect(potLimitFor(50)).toBe(12_800);
  });
});

describe("manifest", () => {
  it("3 to 7 players, best 4 to 6, with computers and pause", () => {
    expect(teenPattiManifest).toMatchObject({ id: "teen-patti", minPlayers: 3, maxPlayers: 7, bestMinPlayers: 4, bestMaxPlayers: 6, computers: true, pausable: true });
  });
});
