import { describe, expect, it } from "vitest";
import { roundLines } from "../shared/lines.ts";
import type { Step } from "../shared/types.ts";

const NAMES: Record<string, string> = { a: "Ravi", b: "Meera", c: "Arjun" };
const name = (id: string) => NAMES[id] ?? id;
const lines = (steps: Step[]) => roundLines(steps, name);

describe("round lines", () => {
  it("says each kind in plain words", () => {
    expect(lines([{ t: "gate", who: "a" }])).toEqual(["Ravi opened the gate."]);
    expect(lines([{ t: "stone", who: "b", ruin: "shrine", how: "roll" }])).toEqual(["Meera found the key stone at the Sunken Shrine."]);
    expect(lines([{ t: "stone", who: "b", ruin: "tower", how: "half" }])).toEqual(["Meera found the key stone at the Star Tower."]);
    expect(lines([{ t: "stone", who: "c", ruin: "cave", how: "force" }])).toEqual(["Arjun forced the Root Cave open. The sun moved on."]);
    expect(lines([{ t: "down", who: "a" }])).toEqual(["Ravi is down."]);
    expect(lines([{ t: "up", who: "a", by: "b" }])).toEqual(["Meera got Ravi back up."]);
    expect(lines([{ t: "lit", tile: "0,0", by: "a" }])).toEqual(["Ravi lit the forest."]);
    expect(lines([{ t: "lit", tile: "0,0", by: "a" }, { t: "lit", tile: "1,0", by: null }])).toEqual(["Ravi lit the forest. The fire spread."]);
    expect(lines([{ t: "burnt", tile: "0,0", to: "broken" }])).toEqual(["The fire burned the bridge."]);
    expect(lines([{ t: "bridge", tile: "0,0", fixed: false, by: null }])).toEqual(["The bridge broke."]);
    expect(lines([{ t: "damage", who: "a", by: "spider", blocked: false }])).toEqual(["The spider bit Ravi."]);
    expect(lines([{ t: "event", id: "rain", option: null, nothing: true }])).toEqual(["Rain: nothing happened."]);
  });

  it("names everyone the spider bit", () => {
    const bite = (who: string): Step => ({ t: "damage", who, by: "spider", blocked: false });
    expect(lines([bite("a"), bite("b")])).toEqual(["The spider bit Ravi and Meera."]);
    expect(lines([bite("a"), bite("b"), bite("c"), bite("a")])).toEqual(["The spider bit Ravi, Meera and Arjun."]);
  });

  it("says nothing for quiet steps", () => {
    expect(lines([
      { t: "event", id: "rain", option: null, nothing: false },
      { t: "lit", tile: "0,0", by: null },
      { t: "burnt", tile: "0,0", to: "ash" },
      { t: "up", who: "a", by: null },
      { t: "damage", who: "a", by: "spider", blocked: true },
      { t: "bridge", tile: "0,0", fixed: true, by: "a" },
    ])).toEqual([]);
  });

  it("keeps one line per kind", () => {
    expect(lines([{ t: "down", who: "a" }, { t: "down", who: "b" }])).toEqual(["Ravi is down."]);
    expect(lines([{ t: "gate", who: "a" }, { t: "gate", who: "b" }])).toEqual(["Ravi opened the gate."]);
  });

  it("puts lines in priority order and keeps at most 4", () => {
    const steps: Step[] = [
      { t: "event", id: "rain", option: null, nothing: true },
      { t: "damage", who: "c", by: "spider", blocked: false },
      { t: "burnt", tile: "0,0", to: "broken" },
      { t: "lit", tile: "0,0", by: "a" },
      { t: "up", who: "a", by: "b" },
      { t: "down", who: "c" },
      { t: "stone", who: "b", ruin: "shrine", how: "roll" },
      { t: "gate", who: "a" },
    ];
    expect(lines(steps)).toEqual([
      "Ravi opened the gate.",
      "Meera found the key stone at the Sunken Shrine.",
      "Arjun is down.",
      "Meera got Ravi back up.",
    ]);
    expect(lines(steps.slice(0, 4))).toEqual([
      "Ravi lit the forest.",
      "The fire burned the bridge.",
      "The spider bit Arjun.",
      "Rain: nothing happened.",
    ]);
  });
});
