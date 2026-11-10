import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MACRO_SIZE, makeLayout, type TreasureLayout } from "../shared/index.ts";

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
    `  "spawn": ${JSON.stringify(l.spawn)}`,
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
