import type { GameOutcome } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { resultHeadline } from "../src/views/headline.ts";

const nameOf = (id: string) => id.toUpperCase();
const out = (o: Partial<GameOutcome>): GameOutcome => ({ winnerIds: [], standings: [], ...o });

describe("the results headline", () => {
  it("reads as before for games that don't set one", () => {
    expect(resultHeadline(out({ winnerIds: ["a"] }), "me", nameOf)).toBe("A wins");
    expect(resultHeadline(out({ winnerIds: ["me"] }), "me", nameOf)).toBe("You win!");
    expect(resultHeadline(out({ winnerIds: ["a", "me"] }), "me", nameOf)).toBe("You and A tie");
    expect(resultHeadline(out({ winnerIds: ["a", "b", "c"] }), "me", nameOf)).toBe("A, B and C tie");
    expect(resultHeadline(out({ winnerIds: ["a"], loserIds: ["b"] }), "me", nameOf)).toBe("B loses");
    expect(resultHeadline(out({ loserIds: ["me"] }), "me", nameOf)).toBe("You lose");
    expect(resultHeadline(out({}), "me", nameOf)).toBe("Game over");
    expect(resultHeadline(null, "me", nameOf)).toBe("Game over");
  });

  it("uses the game's own when it has one", () => {
    expect(resultHeadline(out({ winnerIds: ["a", "b"], headline: "Teal win, 4 to 1" }), "me", nameOf)).toBe("Teal win, 4 to 1");
  });
});
