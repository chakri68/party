import { describe, expect, it } from "vitest";
import { describeResult } from "../shared/describe.ts";
import { readsAsWolf, ROLES } from "../shared/roles.ts";
import { shortNightRules } from "../shared/rules-text.ts";
import { start } from "./helpers.ts";

const name = (id: string) => (id === "p0" ? "you" : id.toUpperCase());
const say = (r: Parameters<typeof describeResult>[0], holder = "p0") => describeResult(r, holder, "p0", name);

describe("night results, in words", () => {
  it("team checks say how players read, never what they are", () => {
    expect(say({ kind: "lamp", target: "p2", reads: "wolves" })).toBe("P2 reads as a wolf.");
    expect(say({ kind: "lamp", target: "p2", reads: "village" })).toBe("P2 reads as village.");
    expect(say({ kind: "match", targets: ["p1", "p2"], same: true })).toBe("P1 and P2 read as the same side.");
    expect(say({ kind: "match", targets: ["p1", "p2"], same: false })).toBe("P1 and P2 read as different sides.");
    expect(say({ kind: "bell", neighbours: ["p1", "p2"], count: 1 })).toBe("1 of P1 and P2 reads as a wolf.");
    expect(say({ kind: "bell", neighbours: ["p1", "p2"], count: 2 })).toBe("2 of P1 and P2 read as wolves.");
    expect(say({ kind: "gossip", pair: ["p1", "p2"] })).toBe("At least one of P1 and P2 reads as a wolf.");
  });

  it("card-level results name cards", () => {
    expect(say({ kind: "wander", target: "p3", notRole: "wolf" })).toBe("P3 isn't the Wolf.");
    expect(say({ kind: "wolves", pack: ["p0", "p4"], villager: null })).toBe("The Wolves: you and P4.");
    expect(say({ kind: "wolves", pack: ["p0"], villager: "p2" })).toBe("You're the only Wolf. P2 holds a Villager.");
    expect(say({ kind: "wolves", pack: ["p0"], villager: null })).toBe("You're the only Wolf. No Villagers were dealt.");
    expect(say({ kind: "missed" })).toBe("You didn't pick in time.");
  });

  it("you, in your own result", () => {
    expect(describeResult({ kind: "lamp", target: "p0", reads: "village" }, "p1", "p0", name)).toBe("You read as village.");
  });

  it("the rules and the cards say what reading as a wolf means", () => {
    expect(shortNightRules.join(" ")).toMatch(/Reads as a wolf" means a Wolf or the Stray/);
    for (const r of ROLES.filter((x) => ["lamplighter", "matchmaker", "bellringer", "gossip"].includes(x.id))) {
      expect(r.blurb, r.id).toMatch(/read/);
      expect(r.blurb, r.id).not.toMatch(/\b(is|are) (a )?wol(f|ves)\b/);
    }
  });
});

describe("the Gossip with the Stray dealt", () => {
  it('always names someone who reads as a wolf; sometimes only the Stray, which is why it says "reads as"', () => {
    let strayOnly = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = start(["villager", "gossip", "villager", "wolf", "villager", "stray", "villager"], {}, seed).state;
      const pair = (s.results.p1 as { pair: [string, string] }).pair;
      expect(pair.some((id) => readsAsWolf(s.cards[id]!)), `seed ${seed}`).toBe(true);
      if (!pair.some((id) => s.cards[id] === "wolf")) strayOnly++;
    }
    expect(strayOnly).toBeGreaterThan(0);
  });
});
