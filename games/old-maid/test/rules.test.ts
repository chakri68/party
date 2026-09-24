import { describe, expect, it } from "vitest";
import { makeDeck, ordinal, pairOff, parseCardId } from "../shared/rules.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

describe("pairOff", () => {
  it("pairs by rank, leaves the spare of three, and makes two pairs of four", () => {
    const { pairs, rest } = pairOff(cards(["spades-5", "hearts-5", "clubs-5", "spades-K", "hearts-K", "clubs-K", "diamonds-K", "joker"]));
    expect(pairs).toHaveLength(3);
    expect(rest.map((c) => c.id)).toEqual(["clubs-5", "joker"]);
  });

  it("never pairs the joker", () => {
    expect(pairOff(cards(["joker", "spades-2"])).pairs).toEqual([]);
  });
});

describe("decks", () => {
  it("has exactly one unpairable card either way", () => {
    expect(makeDeck("queen")).toHaveLength(51);
    expect(makeDeck("joker")).toHaveLength(53);
    expect(pairOff(makeDeck("queen")).rest.map((c) => c.rank)).toEqual([12]);
    expect(pairOff(makeDeck("joker")).rest.map((c) => c.id)).toEqual(["joker"]);
  });

  it("parses ids round-trip and rejects junk", () => {
    expect(parseCardId("hearts-Q")).toEqual({ id: "hearts-Q", suit: "hearts", rank: 12 });
    expect(parseCardId("joker")).toMatchObject({ suit: "joker", rank: 0 });
    expect(parseCardId("hearts-8~1")).toBeNull();
    expect(parseCardId("cups-3")).toBeNull();
  });
});

it("ordinal", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});
