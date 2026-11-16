import { describe, expect, it } from "vitest";
import { cardLabel, failLine, FORCE_LINE, fromTile, oddsLine, people, signed, targets, toPlan, type Draft } from "../client/plan.ts";
import { TILE_ORDER, coords, distance } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import { RUINS } from "../shared/ruins.ts";
import type { PublicExplorer, PublicTile, Role, Terrain, TileId, WildsPublicState } from "../shared/types.ts";

type OpenTile = Extract<PublicTile, { open: true }>;

/** All open grass, with overrides. Fog where `fog` says. */
function pub(
  opts: {
    terrain?: Record<TileId, Terrain>;
    tile?: Record<TileId, Partial<OpenTile>>;
    fog?: TileId[];
    explorers?: (Partial<PublicExplorer> & { id: string; tile: TileId })[];
    spider?: TileId | null;
    stones?: WildsPublicState["stones"];
    half?: WildsPublicState["half"];
    gateOpen?: boolean;
  } = {},
): WildsPublicState {
  const tiles: PublicTile[] = TILE_ORDER.map((id) => {
    if (opts.fog?.includes(id)) return { id, open: false };
    const { q, r } = coords(id);
    return {
      id, open: true, q, r, terrain: opts.terrain?.[id] ?? "grass", fire: 0, noise: 0, cache: false, nest: false, ruin: null,
      ...(opts.tile?.[id] ?? {}),
    };
  });
  return {
    phase: "plan", deadline: 0, round: 1, sun: 0, sunLimit: 10, planSeconds: 45,
    stones: opts.stones ?? [], half: opts.half ?? [], gateOpen: opts.gateOpen ?? false,
    order: (opts.explorers ?? []).map((e) => e.id),
    tiles,
    explorers: (opts.explorers ?? []).map((e) => ({ role: "fixer" as Role, hearts: 3, items: [], down: false, left: false, ready: false, ...e })),
    spider: opts.spider ? { tile: opts.spider, arrow: null } : null,
    event: null, pending: null, voted: null, lastRound: null, end: null,
  };
}

const ok = (t: ReturnType<typeof targets>) => [...t.highlight].filter(([, v]) => v === "ok").map(([k]) => k).sort();

describe("odds line", () => {
  it("names the attribute, the way, the need and the percent", () => {
    // Fixer: Mind +2. Bold +1. Need 9: 2d6 >= 6 is 26 of 36.
    expect(oddsLine("fixer", RUINS.shrine.approaches[0], "bold")).toBe("Mind +2 · Bold +1 · need 9 · 72%");
  });
  it("leaves Normal out, and shows Careful as minus 1", () => {
    expect(oddsLine("runner", RUINS.shrine.approaches[1], "normal")).toBe("Strength +0 · need 7 · 58%");
    expect(oddsLine("protector", RUINS.shrine.approaches[1], "careful")).toBe("Strength +2 · Careful −1 · need 7 · 72%");
  });
  it("signs numbers", () => {
    expect([signed(2), signed(0), signed(-1)]).toEqual(["+2", "+0", "−1"]);
  });
});

describe("fail line", () => {
  it("says the cost, and Careful makes it 1 noise", () => {
    expect(failLine(RUINS.shrine.approaches[1], "normal")).toBe("If you fail: you lose 1 Heart.");
    expect(failLine(RUINS.tower.approaches[1], "bold")).toBe("If you fail: 3 noise on the ruin.");
    expect(failLine(RUINS.tower.approaches[1], "careful")).toBe("If you fail: 1 noise on the ruin.");
  });
  it("Force reads its noise from N", () => {
    expect(FORCE_LINE).toBe(`No roll. The sun moves on by 1. ${N.forceNoise} noise.`);
  });
});

describe("where a beat starts", () => {
  const p = pub({ explorers: [{ id: "a", tile: "0,0" }] });
  it("Beat 2 starts where Beat 1's Move ends", () => {
    const d: Draft = [{ kind: "move", to: "1,0" }, null];
    expect(fromTile(p, "a", d, 0)).toBe("0,0");
    expect(fromTile(p, "a", d, 1)).toBe("1,0");
  });
  it("otherwise where you stand", () => {
    expect(fromTile(p, "a", [{ kind: "look" }, null], 1)).toBe("0,0");
    expect(fromTile(p, "nobody", [null, null], 0)).toBeNull();
  });
});

describe("move targets", () => {
  it("light open tiles within the move, not your own", () => {
    const p = pub({ explorers: [{ id: "a", tile: "0,0" }] });
    const t = targets(p, "a", "0,0", { kind: "move" });
    expect(ok(t)).toEqual(TILE_ORDER.filter((x) => x !== "0,0" && distance("0,0", x) <= N.move).sort());
    expect(t.offReason.get("0,0")).toBe("You are here.");
    expect(t.offReason.get("3,0")).toBe(`Too far. You can move ${N.move} tiles.`);
  });
  it("a Runner goes further", () => {
    const p = pub({ explorers: [{ id: "a", tile: "0,0", role: "runner" }] });
    expect(targets(p, "a", "0,0", { kind: "move" }).highlight.get("3,0")).toBe("ok");
  });
  it("say why fog, river, rock, broken bridges, fire and the spider are off", () => {
    const p = pub({
      explorers: [{ id: "a", tile: "0,0" }],
      fog: ["1,0"],
      terrain: { "0,1": "river", "-1,1": "rock", "-1,0": "broken" },
      tile: { "0,-1": { fire: 2 } },
      spider: "1,-1",
    });
    const t = targets(p, "a", "0,0", { kind: "move" });
    expect(t.offReason.get("1,0")).toMatch(/^Fog/);
    expect(t.offReason.get("0,1")).toMatch(/^River/);
    expect(t.offReason.get("-1,1")).toMatch(/^Rock/);
    expect(t.offReason.get("-1,0")).toMatch(/^Broken bridge/);
    expect(t.offReason.get("0,-1")).toMatch(/^Fire/);
    expect(t.offReason.get("1,-1")).toBe("The spider is there.");
    // Every tile is either ok or has a reason.
    for (const [id, v] of t.highlight) if (v === "off") expect(t.offReason.get(id)).toBeTruthy();
  });
  it("reeds stop a move", () => {
    // Reeds all around the start: nothing past them.
    const ring = ["1,0", "1,-1", "0,-1", "-1,0", "-1,1", "0,1"];
    const p = pub({ explorers: [{ id: "a", tile: "0,0" }], terrain: Object.fromEntries(ring.map((x) => [x, "reeds" as Terrain])) });
    const t = targets(p, "a", "0,0", { kind: "move" });
    expect(ok(t)).toEqual([...ring].sort());
    expect(t.offReason.get("2,0")).toMatch(/Reeds stop a Move/);
  });
  it("a path cut by river, fog, fire or the spider is blocked, with no word about reeds", () => {
    // 2,0 is in range, and 1,0 is the only tile between it and 0,0.
    const cases: Parameters<typeof pub>[0][] = [
      { terrain: { "1,0": "river" } },
      { fog: ["1,0"] },
      { tile: { "1,0": { fire: 2 } } },
      { spider: "1,0" },
    ];
    for (const c of cases) {
      const p = pub({ explorers: [{ id: "a", tile: "0,0" }], ...c });
      expect(targets(p, "a", "0,0", { kind: "move" }).offReason.get("2,0")).toBe("The way is blocked.");
    }
  });
  it("names reeds only when reeds stopped the path", () => {
    // 1,0 is reeds, the only tile between 0,0 and 2,0.
    const p = pub({ explorers: [{ id: "a", tile: "0,0" }], terrain: { "1,0": "reeds" } });
    expect(targets(p, "a", "0,0", { kind: "move" }).offReason.get("2,0")).toMatch(/Reeds stop a Move/);
  });
});

describe("act targets", () => {
  it("light a ruin, a cache, and a broken bridge for a Fixer, next to you", () => {
    const p = pub({
      explorers: [{ id: "a", tile: "0,0" }],
      terrain: { "1,0": "ruin", "-1,0": "broken" },
      tile: { "1,0": { ruin: "shrine" }, "0,1": { cache: true }, "3,0": { cache: true } },
    });
    const t = targets(p, "a", "0,0", { kind: "act" });
    expect(ok(t)).toEqual(["-1,0", "0,1", "1,0"]);
    expect(t.offReason.get("3,0")).toMatch(/^Too far/);
    expect(t.offReason.get("0,0")).toBe("Nothing to do here.");
  });
  it("not a broken bridge for other roles, nor a found ruin", () => {
    const p = pub({
      explorers: [{ id: "a", tile: "0,0", role: "runner" }],
      terrain: { "1,0": "ruin", "-1,0": "broken" },
      tile: { "1,0": { ruin: "shrine" } },
      stones: ["shrine"],
    });
    const t = targets(p, "a", "0,0", { kind: "act" });
    expect(t.offReason.get("-1,0")).toMatch(/Only a Fixer/);
    expect(t.offReason.get("1,0")).toMatch(/already found/);
  });
  it("the gate needs all the key stones and you standing on it", () => {
    const base = { explorers: [{ id: "a", tile: "0,0" }], terrain: { "0,0": "gate" as Terrain, "1,0": "gate" as Terrain } };
    expect(targets(pub(base), "a", "0,0", { kind: "act" }).offReason.get("0,0")).toMatch(/You need all 3 key stones/);
    const all = pub({ ...base, stones: ["shrine", "tower", "cave"] });
    expect(targets(all, "a", "0,0", { kind: "act" }).highlight.get("0,0")).toBe("ok");
    expect(targets(all, "a", "0,0", { kind: "act" }).offReason.get("1,0")).toBe("Stand on the gate to open it.");
  });
});

describe("item targets", () => {
  it("Torch: forest, a bridge or the spider, next to you", () => {
    const p = pub({
      explorers: [{ id: "a", tile: "0,0" }],
      terrain: { "1,0": "forest", "-1,0": "bridge", "0,1": "forest" },
      tile: { "0,1": { fire: 1 } },
      spider: "0,-1",
    });
    const t = targets(p, "a", "0,0", { kind: "item", item: "torch" });
    expect(ok(t)).toEqual(["-1,0", "0,-1", "1,0"]);
    expect(t.offReason.get("0,1")).toBe("It is already burning.");
    expect(t.offReason.get("0,0")).toBe("Pick a tile next to you.");
  });
  it("Planks: a river or a broken bridge next to you", () => {
    const p = pub({ explorers: [{ id: "a", tile: "0,0" }], terrain: { "1,0": "river", "-1,0": "broken", "0,1": "bridge" } });
    const t = targets(p, "a", "0,0", { kind: "item", item: "planks" });
    expect(ok(t)).toEqual(["-1,0", "1,0"]);
    expect(t.offReason.get("0,1")).toBe("The bridge is fine.");
  });
  it("Lure: any open tile in range", () => {
    const p = pub({ explorers: [{ id: "a", tile: "-3,0" }], fog: ["-2,0"] });
    const t = targets(p, "a", "-3,0", { kind: "item", item: "lure" });
    expect(t.highlight.get("0,0")).toBe("ok");
    expect(t.offReason.get("1,0")).toBe(`Too far. A Lure reaches ${N.lureRange} tiles.`);
    expect(t.offReason.get("-2,0")).toMatch(/^Fog/);
  });
  it("Medkit: you, or a friend near you who isn't down", () => {
    const p = pub({
      explorers: [
        { id: "a", tile: "0,0" }, { id: "b", tile: "1,0" }, { id: "c", tile: "3,0" }, { id: "d", tile: "-1,0", down: true },
      ],
    });
    const t = targets(p, "a", "0,0", { kind: "item", item: "medkit" });
    expect(ok(t)).toEqual(["0,0", "1,0"]);
    expect(t.offReason.get("-1,0")).toMatch(/can't get a down player up/);
    expect(t.offReason.get("3,0")).toMatch(/^Too far/);
  });
});

describe("help", () => {
  const p = pub({
    explorers: [{ id: "a", tile: "0,0" }, { id: "b", tile: "0,0" }, { id: "c", tile: "1,0", down: true }, { id: "d", tile: "3,0" }],
  });
  it("names friends on your tile or next to it, down ones too, never you", () => {
    expect(people(p, "a", "0,0", "help")).toEqual([
      { id: "b", why: null }, { id: "c", why: null }, { id: "d", why: "Too far. Stand on their tile or next to it." },
    ]);
    const t = targets(p, "a", "0,0", { kind: "help" });
    expect(ok(t)).toEqual(["0,0", "1,0"]);
    expect(t.offReason.get("3,0")).toMatch(/^Too far/);
  });
});

describe("plan labels", () => {
  const p = pub({ explorers: [{ id: "a", tile: "0,0" }, { id: "b", tile: "1,0" }], terrain: { "1,0": "ruin" }, tile: { "1,0": { ruin: "tower" } } });
  const name = (id: string) => (id === "b" ? "Ravi" : id);
  it("say what each card does", () => {
    expect(cardLabel(null, p, "a", name)).toBe("Empty");
    expect(cardLabel({ kind: "act", at: "1,0", approach: 0, way: "bold" }, p, "a", name)).toBe("Act: Star Tower, Bold");
    expect(cardLabel({ kind: "act", at: "1,0", approach: "force" }, p, "a", name)).toBe("Force: Star Tower");
    expect(cardLabel({ kind: "help", who: "b" }, p, "a", name)).toBe("Help Ravi");
    expect(cardLabel({ kind: "item", item: "medkit", who: "a" }, p, "a", name)).toBe("Medkit on you");
  });
  it("empty beats go to the server as Guard", () => {
    expect(toPlan([{ kind: "look" }, null])).toEqual([{ kind: "look" }, { kind: "guard" }]);
  });
});
