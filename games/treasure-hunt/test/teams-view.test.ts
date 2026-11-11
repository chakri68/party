import { describe, expect, it } from "vitest";
import { canStart, memberText, startNote, teamRows } from "../client/teams.ts";
import { clueItems, raceText, scoreText } from "../client/hud.ts";
import { treasureHuntRules, treasureHuntSettingFields } from "../shared/rules-text.ts";
import type { THPrivate, THPublic } from "../shared/types.ts";

const pub = (players: THPublic["players"], teams: THPublic["teams"] = [
  { id: 1, color: "orange", foundCount: 0, poolSize: 0 },
  { id: 2, color: "sky", foundCount: 0, poolSize: 0 },
]) => ({ phase: "teams", teams, players }) as unknown as THPublic;

const p = (id: string, teamId: number | null, ready = false, removed = false) => ({ id, teamId, ready, removed, spectator: false });

describe("teamRows", () => {
  const game = pub([p("p1", 1, true), p("p2", 2), p("p3", 1), p("p4", 1, true, true), p("p5", null)]);
  const names = { p1: "Asha", p2: "Ravi", p3: "Meera" };

  it("gives one row per team with its colour, shape and members", () => {
    const rows = teamRows(game, names, "p3");
    expect(rows.map((r) => [r.id, r.name, r.shape, r.hex])).toEqual([
      [1, "Orange", "Circle", "#e69f00"],
      [2, "Sky", "Square", "#56b4e9"],
    ]);
    expect(rows[0]!.members).toEqual([
      { id: "p1", name: "Asha", ready: true, you: false },
      { id: "p3", name: "Meera", ready: false, you: true },
    ]);
    expect(rows[1]!.members.map((m) => m.id)).toEqual(["p2"]);
  });

  it("marks my team, and drops the removed and the teamless", () => {
    const rows = teamRows(game, names, "p3");
    expect(rows.map((r) => r.mine)).toEqual([true, false]);
    expect(rows.flatMap((r) => r.members.map((m) => m.id))).not.toContain("p4");
  });

  it("names someone with no seat Someone", () => {
    expect(teamRows(pub([p("px", 1)]), {}, "p1")[0]!.members[0]!.name).toBe("Someone");
  });

  it("writes a member as name · loading or ready, with (you)", () => {
    expect(memberText({ id: "p1", name: "Asha", ready: true, you: false })).toBe("Asha · ready");
    expect(memberText({ id: "p3", name: "Meera", ready: false, you: true })).toBe("Meera (you) · loading");
  });
});

describe("canStart and startNote", () => {
  it("can't start with nobody ready", () => {
    const game = pub([p("p1", 1), p("p2", 2)]);
    expect(canStart(game)).toBe(false);
    expect(startNote(game)).toBe("Waiting for the map to load.");
  });

  it("can start with one ready, and warns the rest will watch", () => {
    const game = pub([p("p1", 1, true), p("p2", 2)]);
    expect(canStart(game)).toBe(true);
    expect(startNote(game)).toBe("Players still loading will watch this round.");
  });

  it("says nothing once everyone is ready", () => {
    const game = pub([p("p1", 1, true), p("p2", 2, true), p("p3", 1, false, true)]);
    expect(canStart(game)).toBe(true);
    expect(startNote(game)).toBeNull();
  });

  it("a removed player's ready doesn't count", () => {
    expect(canStart(pub([p("p1", 1, true, true), p("p2", 2)]))).toBe(false);
  });

  it("only in the teams phase", () => {
    expect(canStart({ ...pub([p("p1", 1, true)]), phase: "hunting" })).toBe(false);
    expect(startNote({ ...pub([p("p1", 1)]), phase: "hunting" })).toBeNull();
  });
});

describe("race score", () => {
  it("reads 2 of 5 in Race, and Race to 5 beside it", () => {
    expect(scoreText(2, 5, "race")).toBe("2 of 5");
    expect(raceText(5)).toBe("Race to 5");
  });

  it("keeps 3 of 6 found in Timed", () => {
    expect(scoreText(3, 6, "timed")).toBe("3 of 6 found");
  });
});

describe("clueItems taken", () => {
  it("marks a clue another team took", () => {
    const priv: THPrivate = {
      teamId: 1,
      pins: [],
      revealed: [],
      clues: [
        { id: "c1", clues: ["A."], difficulty: 1, found: false, taken: true, photo: null },
        { id: "c2", clues: ["B."], difficulty: 1, found: true, taken: false, photo: null },
      ],
    };
    expect(clueItems(priv)).toEqual([
      { text: "A.", found: false, taken: true, photo: null },
      { text: "B.", found: true, taken: false, photo: null },
    ]);
  });
});

describe("treasureHuntSettingFields", () => {
  const keys = (raw: unknown) => treasureHuntSettingFields(raw, 4).map((f) => f.key);

  it("hides Caches to win in Timed", () => {
    expect(keys({ mode: "timed" })).toEqual(["mode", "minutes", "time", "map"]);
    expect(keys(undefined)).toEqual(["mode", "minutes", "time", "map"]);
  });

  it("shows Caches to win, 3 to 10, in Race", () => {
    const fields = treasureHuntSettingFields({ mode: "race", target: 7 }, 4);
    expect(fields.map((f) => f.key)).toEqual(["mode", "minutes", "time", "target", "map"]);
    const target = fields[3]!;
    expect(target.label).toBe("Caches to win");
    expect(target.options.map((o) => o.patch)).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ target: n })));
    expect(target.options[target.selected]!.patch).toEqual({ target: 7 });
  });

  it("offers Timed and Race", () => {
    const mode = treasureHuntSettingFields({ mode: "race" }, 4)[0]!;
    expect(mode.label).toBe("Mode");
    expect(mode.options.map((o) => [o.label, o.patch])).toEqual([
      ["Timed", { mode: "timed" }],
      ["Race", { mode: "race" }],
    ]);
    expect(mode.selected).toBe(1);
  });

  it("offers the time of day after Round length", () => {
    const f = treasureHuntSettingFields({ time: "dusk" }, 4).find((x) => x.key === "time")!;
    expect(f.label).toBe("Time of day");
    expect(f.options.map((o) => [o.label, o.patch])).toEqual([
      ["Day", { time: "day" }],
      ["Dusk", { time: "dusk" }],
      ["Night", { time: "night" }],
      ["Random", { time: "random" }],
    ]);
    expect(f.selected).toBe(1);
    expect(f.hint).toBe("The sun sets during the round. A long round ends in the dark.");
    expect(treasureHuntSettingFields({ time: "random" }, 4).find((x) => x.key === "time")!.hint).toBe("A surprise. Everyone gets the same one.");
  });

  it("rules carry the sky lines", () => {
    expect(treasureHuntRules).toContain(
      "A clue names a place on the map, says the cache is between two places, gives a distance and a direction, shows a photo taken near the cache, or says where a shadow ends or a lamp shines.",
    );
    expect(treasureHuntRules).toContain("The clock at the top shows the time in the game. It moves 1 minute for every real minute. A shadow clue needs that time.");
    expect(treasureHuntRules.some((r) => r.startsWith("At night, press F to turn your torch on or off."))).toBe(true);
    expect(treasureHuntRules.some((r) => r.startsWith("A clue names a place on the map, says the cache is between two places, or"))).toBe(false);
  });
});
