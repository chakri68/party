import { seededRandomInt } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { balancedSplit, canSwitch, captainOf, parseCarry, pickDescriber, restoreTeams, sizes } from "../server/teams.ts";
import type { DontSayItPlayerState, TeamId } from "../shared/types.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const count = (m: Map<string, TeamId>, t: TeamId) => [...m.values()].filter((x) => x === t).length;

function players(teams: TeamId[]): DontSayItPlayerState[] {
  return teams.map((team, seat) => ({ id: `p${seat}`, seat, team, removed: false, away: false, described: 0 }));
}

describe("splits", () => {
  it("are within 1, and differ by seed", () => {
    for (let n = 4; n <= 12; n++) {
      const m = balancedSplit(ids(n), seededRandomInt(n));
      expect(m.size).toBe(n);
      expect(Math.abs(count(m, 0) - count(m, 1))).toBeLessThanOrEqual(1);
    }
    const a = [...balancedSplit(ids(8), seededRandomInt(1)).values()].join();
    const b = [...balancedSplit(ids(8), seededRandomInt(2)).values()].join();
    expect(a).not.toBe(b);
  });
});

describe("switching", () => {
  it("is fine within 1, or closer than before", () => {
    expect(canSwitch([3, 3], 0)).toBe(false);
    expect(canSwitch([3, 2], 0)).toBe(true);
    expect(canSwitch([2, 3], 0)).toBe(false);
    expect(canSwitch([4, 3], 1)).toBe(false);
    expect(canSwitch([4, 2], 0)).toBe(true);
    expect(canSwitch([5, 1], 0)).toBe(true);
  });
});

describe("rematch teams", () => {
  it("keep the old sides, drop leavers, and put newcomers on the smaller side", () => {
    const carry = { teams: [["p0", "p1", "gone"], ["p2", "p3"]] as [string[], string[]], used: [] };
    const m = restoreTeams(["p0", "p1", "p2", "p3", "p4"], carry, seededRandomInt(3));
    expect([m.get("p0"), m.get("p1"), m.get("p2"), m.get("p3")]).toEqual([0, 0, 1, 1]);
    expect(m.has("gone")).toBe(false);
    expect(m.size).toBe(5);
  });

  it("even out a lopsided carry", () => {
    const carry = { teams: [["p0", "p1", "p2", "p3"], ["p4", "p5", "p6", "p7"]] as [string[], string[]], used: [] };
    const m = restoreTeams(["p0", "p1", "p2", "p3", "p4"], carry, seededRandomInt(4));
    expect(Math.abs(count(m, 0) - count(m, 1))).toBeLessThanOrEqual(1);
  });

  it("read carries defensively", () => {
    expect(parseCarry(null)).toBeNull();
    expect(parseCarry({ teams: [["a"]] })).toBeNull();
    expect(parseCarry({ teams: [["a"], [1]] })).toBeNull();
    expect(parseCarry({ teams: [["a"], ["b"]] })).toEqual({ teams: [["a"], ["b"]], used: [] });
  });
});

describe("captains and describers", () => {
  it("the captain is the first by seat who's here", () => {
    const ps = players([1, 0, 1, 0, 1]);
    expect(captainOf(ps, 0)).toBe("p1");
    expect(captainOf(ps, 1)).toBe("p0");
    ps[0]!.away = true;
    expect(captainOf(ps, 1)).toBe("p2");
    expect(captainOf(ps, 1, ["p2"])).toBe("p4");
    ps[2]!.removed = true;
    ps[4]!.away = true;
    expect(captainOf(ps, 1)).toBe("p0");
  });

  it("describers rotate by fewest turns, then seat, connected first", () => {
    const ps = players([0, 1, 0, 1, 0]);
    expect(pickDescriber(ps, 0)).toBe("p0");
    ps[0]!.described = 1;
    expect(pickDescriber(ps, 0)).toBe("p2");
    ps[2]!.described = 1;
    ps[4]!.away = true;
    expect(pickDescriber(ps, 0)).toBe("p0");
    expect(pickDescriber(ps, 0, ["p0", "p2"])).toBe("p4");
    expect(sizes(ps)).toEqual([3, 2]);
  });
});
