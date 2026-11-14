import { describe, expect, it } from "vitest";
import { bumpStat, STAT_KEYS, type PartyStats } from "../src/index.ts";

describe("bumpStat", () => {
  it("creates the player and key, adds, and leaves others alone", () => {
    const s: PartyStats = { b: { fooled: 2 } };
    bumpStat(s, "a", "liesTold");
    bumpStat(s, "a", "liesTold", 2);
    expect(s).toEqual({ a: { liesTold: 3 }, b: { fooled: 2 } });
  });

  it("lists every key once", () => {
    expect(new Set(STAT_KEYS).size).toBe(STAT_KEYS.length);
  });
});
