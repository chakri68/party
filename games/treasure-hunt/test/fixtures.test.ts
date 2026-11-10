import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MACRO_SIZE, makeLayout, TEMPLATES, type TreasureLayout } from "../shared/index.ts";

// Godot's tests read these layouts. If the generator changes, this test fails
// first; rerun with UPDATE_FIXTURES=1 to rewrite them, then rerun the Godot tests.
const DIR = join(import.meta.dirname, "../godot/tests/fixtures");
const UPDATE = process.env.UPDATE_FIXTURES === "1";

/** JSON with each grid row of 61 numbers on its own line, so diffs stay readable. */
function format(l: TreasureLayout): string {
  const grid = (a: number[]) => {
    const rows: string[] = [];
    for (let j = 0; j < MACRO_SIZE; j++) rows.push("      " + a.slice(j * MACRO_SIZE, (j + 1) * MACRO_SIZE).join(","));
    return "[\n" + rows.join(",\n") + "\n    ]";
  };
  const { macro } = l;
  return [
    "{",
    `  "version": ${l.version},`,
    `  "seed": ${l.seed},`,
    `  "macro": {`,
    `    "origin": ${macro.origin}, "cell": ${macro.cell}, "size": ${macro.size},`,
    `    "heights": ${grid(macro.heights)},`,
    `    "biomes": ${grid(macro.biomes)}`,
    `  },`,
    `  "ring": ${JSON.stringify(l.ring)},`,
    `  "spawn": ${JSON.stringify(l.spawn)},`,
    `  "pieces": [`,
    l.pieces.map((p) => "    " + JSON.stringify(p)).join(",\n"),
    `  ],`,
    `  "trails": [`,
    l.trails.map((t) => "    " + JSON.stringify(t)).join(",\n"),
    `  ],`,
    `  "minor": [`,
    l.minor.map((m) => "    " + JSON.stringify(m)).join(",\n"),
    `  ]`,
    "}",
    "",
  ].join("\n");
}

describe("Godot fixtures", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`layout_${seed}.json matches makeLayout(${seed})`, () => {
      const file = join(DIR, `layout_${seed}.json`);
      const layout = makeLayout(seed);
      if (UPDATE) writeFileSync(file, format(layout));
      expect(JSON.parse(format(layout))).toEqual(layout);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(layout);
    });
  }
});

// Godot builds each template from its params, then checks every slot stands
// open (piece_tests.gd). These are the params it builds from: every roll at
// its lowest, its middle and its highest, so both sides of every coin flip
// and both ends of every range get built. Variants 0, 1, 2 cover the colours.
const ROLLS = [0, 0.5, 1 - 1e-9];

// Rolling every param with the same v never builds the tight corners, so
// these are added on top: the widest hull rolled the other way, wires on a
// tall tower, a full camp with its pit, a long trail in every direction (4.71
// runs it past the wing slot), and every stone of a small ring that can fall.
const WORST: Record<string, Record<string, number>[]> = {
  shipwreck: [
    { length: 20, buried: 0.5, tilt: -20 },
    { length: 20, buried: 0, tilt: -20 },
  ],
  "radio-tower": [
    { height: 35, wires: 1 },
    { height: 27.5, wires: 1 },
  ],
  camp: [{ tents: 3, firepit: 1 }],
  plane: [0.79, 1.57, 3.93, 4.71, 5.5].map((heading) => ({ debris: 30, heading })),
  "stone-circle": [{ stones: 6, fallen: 3 }],
};

function pieceSamples() {
  const templates: Record<string, unknown> = {};
  for (const [id, t] of Object.entries(TEMPLATES)) {
    templates[id] = {
      labels: t.labels,
      samples: [...ROLLS.map((v) => t.roll(() => v)), ...(WORST[id] ?? [])].map((params, i) => ({
        params,
        variant: i % 3,
        slots: t.slots(params).map(({ x, z, dy }) => ({ x, z, dy })),
      })),
    };
  }
  return { templates };
}

describe("Godot piece fixture", () => {
  it("pieces.json matches TEMPLATES", () => {
    const file = join(DIR, "pieces.json");
    const want = pieceSamples();
    if (UPDATE) writeFileSync(file, JSON.stringify(want, null, 2) + "\n");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(want);
  });
});

// 40 more maps for the pad and trail-end slope checks in terrain_tests.gd:
// a wider spread of hills than the 5 above. Compact, and without the minor
// points, which those checks don't read.
const EXTRA_SEEDS = Array.from({ length: 40 }, (_, k) => 13 + 7919 * (k + 1));

describe("Godot extra layouts fixture", () => {
  it("extra_layouts.json matches makeLayout over EXTRA_SEEDS", () => {
    const file = join(DIR, "extra_layouts.json");
    const want = EXTRA_SEEDS.map((s) => {
      const { minor: _, ...rest } = makeLayout(s);
      return rest;
    });
    if (UPDATE) writeFileSync(file, JSON.stringify({ layouts: want }) + "\n");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ layouts: want });
  });
});
