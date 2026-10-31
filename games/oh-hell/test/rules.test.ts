import { describe, expect, it } from "vitest";
import {
  biggestHand,
  buildSchedule,
  forbiddenBid,
  forbiddenBidMessage,
  makeDeck,
  parseCardId,
  rescheduleFrom,
  scoreRound,
  sortHand,
} from "../shared/rules.ts";
import { ohHellSettingFields } from "../shared/rules-text.ts";
import { legalPlays, trickWinnerIndex } from "../shared/tricks.ts";
import { DEFAULT_SETTINGS } from "../shared/types.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

describe("cards", () => {
  it("aces are high, and every id round-trips", () => {
    expect(parseCardId("spades-A")!.rank).toBe(14);
    expect(parseCardId("spades-2")!.rank).toBe(2);
    expect(parseCardId("spades-1")).toBeNull();
    expect(parseCardId("stars-A")).toBeNull();
    const deck = makeDeck();
    expect(new Set(ids(deck)).size).toBe(52);
    for (const c of deck) expect(parseCardId(c.id)).toEqual(c);
  });

  it("sorts trump first, then by suit, low to high", () => {
    const hand = cards(["spades-A", "clubs-2", "hearts-9", "clubs-K", "diamonds-3", "hearts-2"]);
    expect(ids(sortHand(hand, "clubs"))).toEqual(["clubs-2", "clubs-K", "diamonds-3", "spades-A", "hearts-2", "hearts-9"]);
  });
});

describe("schedule", () => {
  it("caps the biggest hand by player count, always leaving a card for trump", () => {
    expect(biggestHand("max", 3)).toBe(17);
    expect(biggestHand("max", 4)).toBe(12);
    expect(biggestHand("max", 7)).toBe(7);
    expect(biggestHand(7, 3)).toBe(7);
    expect(biggestHand(10, 7)).toBe(7);
    expect(biggestHand(10, 5)).toBe(10);
    for (let n = 3; n <= 7; n++) expect(biggestHand("max", n) * n).toBeLessThanOrEqual(51);
  });

  it("builds every shape", () => {
    expect(buildSchedule("up-down", 7)).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]);
    expect(buildSchedule("down", 7)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(buildSchedule("up", 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(buildSchedule("up-down", 17)).toHaveLength(33);
    expect(buildSchedule("up-down", 1)).toEqual([1]);
  });

  it("carries on from where play stands when the biggest hand changes", () => {
    const ud = buildSchedule("up-down", 7);
    // Still on the way up: climbs to the new peak, then down.
    expect(rescheduleFrom(ud, 2, "up-down", 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1]);
    // At the old peak with room to grow: keeps going up.
    expect(rescheduleFrom(ud, 6, "up-down", 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1]);
    // On the way down: just keeps coming down.
    expect(rescheduleFrom(ud, 9, "up-down", 8)).toEqual(ud);
    // Same biggest hand: nothing changes.
    expect(rescheduleFrom(ud, 4, "up-down", 7)).toEqual(ud);
    expect(rescheduleFrom([1, 2, 3], 1, "up", 5)).toEqual([1, 2, 3, 4, 5]);
    expect(rescheduleFrom([5, 4, 3, 2, 1], 1, "down", 8)).toEqual([5, 4, 3, 2, 1]);
    // Capped if it ever shrinks.
    expect(rescheduleFrom([1, 2, 3, 4, 5, 4, 3, 2, 1], 4, "up-down", 3)).toEqual([1, 2, 3, 4, 3, 2, 1]);
  });

  it("the Biggest hand hint shows the round count", () => {
    const at = (biggest: unknown, n: number) => ohHellSettingFields({ ...DEFAULT_SETTINGS, biggest }, n).find((f) => f.key === "biggest")!;
    expect(at(7, 4).hint).toBe("13 rounds");
    expect(at("max", 3).hint).toBe("33 rounds");
    expect(at(10, 7).hint).toBe("13 rounds · capped at 7 for 7 players");
    expect(at("max", 4).options[2]!.label).toBe("Most the deck allows (12)");
  });
});

describe("bids and scores", () => {
  it("the dealer can't make the bids add up", () => {
    expect(forbiddenBid(3, 1, true, true)).toBe(2);
    expect(forbiddenBid(3, 1, false, true)).toBeNull();
    expect(forbiddenBid(3, 1, true, false)).toBeNull();
    // Everyone else overbid: nothing the dealer says can make it add up.
    expect(forbiddenBid(3, 4, true, true)).toBeNull();
    // The one-card round.
    expect(forbiddenBid(1, 0, true, true)).toBe(1);
    expect(forbiddenBid(1, 1, true, true)).toBe(0);
    expect(forbiddenBidMessage(2, 3)).toBe("Can't bid 2: the bids would add up to 3 tricks");
    expect(forbiddenBidMessage(1, 1)).toBe("Can't bid 1: the bids would add up to 1 trick");
  });

  it("10 + bid when it's exact; a miss scores 0 or costs the difference", () => {
    expect(scoreRound(0, 0, "zero")).toBe(10);
    expect(scoreRound(3, 3, "difference")).toBe(13);
    expect(scoreRound(2, 4, "zero")).toBe(0);
    expect(scoreRound(2, 4, "difference")).toBe(-2);
    expect(scoreRound(3, 0, "difference")).toBe(-3);
  });
});

describe("trick engine", () => {
  it("must follow the led suit if you can, and can play anything if you can't", () => {
    const hand = cards(["hearts-2", "hearts-K", "spades-A", "clubs-5"]);
    expect(ids(legalPlays(hand, null))).toEqual(ids(hand));
    expect(ids(legalPlays(hand, "hearts"))).toEqual(["hearts-2", "hearts-K"]);
    expect(ids(legalPlays(hand, "diamonds"))).toEqual(ids(hand));
  });

  it("highest of the led suit wins; off-suit cards never do, however high", () => {
    expect(trickWinnerIndex(cards(["hearts-9", "hearts-Q", "spades-A", "hearts-3"]), "clubs")).toBe(1);
  });

  it("any trump beats the led suit, and the highest trump wins", () => {
    expect(trickWinnerIndex(cards(["hearts-A", "clubs-2", "hearts-K"]), "clubs")).toBe(1);
    expect(trickWinnerIndex(cards(["hearts-A", "clubs-2", "clubs-9", "hearts-K"]), "clubs")).toBe(2);
  });

  it("a trump lead: the highest trump wins", () => {
    expect(trickWinnerIndex(cards(["clubs-4", "hearts-A", "clubs-J"]), "clubs")).toBe(2);
    expect(trickWinnerIndex(cards(["clubs-4", "hearts-A", "diamonds-K"]), "clubs")).toBe(0);
  });

  it("no trump: straight by the led suit", () => {
    expect(trickWinnerIndex(cards(["diamonds-4", "clubs-A", "diamonds-5"]), null)).toBe(2);
  });
});
