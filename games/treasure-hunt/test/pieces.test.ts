import { LAMP_REACH } from "../shared/sky.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BIOMES,
  TEMPLATES,
  generateLayout,
  macroHeight,
  makeLayout,
  pieceLabel,
  placePieces,
  rng,
  worldLamp,
  worldSlot,
  type SetPiece,
  type TemplateId,
  type TreasureLayout,
} from "../shared/index.ts";

const IDS = Object.keys(TEMPLATES) as TemplateId[];

// Parameter ranges from the M2 brief, checked against each roll.
const RANGES: Record<TemplateId, Record<string, [number, number]>> = {
  lighthouse: { height: [14, 22], ruined: [0, 1] },
  shipwreck: { length: [12, 20], buried: [0, 0.5], tilt: [-20, 20] },
  "stone-circle": { stones: [6, 12], fallen: [0, 3] },
  "radio-tower": { height: [20, 35], wires: [0, 1] },
  camp: { tents: [1, 3], firepit: [0, 1] },
  plane: { debris: [10, 30], heading: [0, 2 * Math.PI] },
  windmill: { height: [9, 13], turning: [0, 1] },
  farm: { buildings: [1, 3], ruin: [0, 2] },
  watchtower: { floors: [1, 3], broken: [0, 1] },
  lookout: { stilts: [4, 8] },
  garden: { hedge: [1.2, 2] },
};
const BOOLS = new Set(["ruined", "wires", "firepit", "turning", "broken"]);
const INTS = new Set(["stones", "fallen", "tents", "debris", "buildings", "ruin", "floors"]);

/** Macro vertices as [x, z, height m, biome name]. */
function vertices(l: TreasureLayout): [number, number, number, string][] {
  const { origin, cell, size, heights, biomes } = l.macro;
  const out: [number, number, number, string][] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      out.push([origin + i * cell, origin + j * cell, heights[j * size + i]! / 10, BIOMES[biomes[j * size + i]!]!]);
    }
  }
  return out;
}

/** Biome of the vertex nearest (x, z). */
function biomeAt(l: TreasureLayout, x: number, z: number): string {
  const { origin, cell, size, biomes } = l.macro;
  const i = Math.round((x - origin) / cell);
  const j = Math.round((z - origin) / cell);
  return BIOMES[biomes[j * size + i]!]!;
}

/**
 * Highest minus lowest macro height over the pad: its centre and 8 points on
 * its rim. Re-derived here rather than imported from sites.ts, so the test
 * checks the rule on its own terms.
 */
function padSpread(l: TreasureLayout, p: SetPiece): number {
  const hs = [macroHeight(l, p.x, p.z)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    hs.push(macroHeight(l, p.x + Math.cos(a) * p.padR, p.z + Math.sin(a) * p.padR));
  }
  return Math.max(...hs) - Math.min(...hs);
}

describe("TEMPLATES", () => {
  it("every template rolls params in range and gives 2–4 slots with 0 ≤ dy ≤ 1", () => {
    expect([...IDS].sort()).toEqual(Object.keys(RANGES).sort());
    for (const id of IDS) {
      const t = TEMPLATES[id];
      expect(t.id).toBe(id);
      expect(new Set(t.labels).size).toBe(3);
      const r = rng(id.length * 977);
      for (let n = 0; n < 50; n++) {
        const params = t.roll(r);
        expect(Object.keys(params).sort()).toEqual(Object.keys(RANGES[id]).sort());
        for (const [k, [lo, hi]] of Object.entries(RANGES[id])) {
          const v = params[k]!;
          expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
          if (BOOLS.has(k)) expect([0, 1]).toContain(v);
          if (INTS.has(k)) expect(Number.isInteger(v)).toBe(true);
        }
        const slots = t.slots(params);
        expect(slots.length).toBeGreaterThanOrEqual(2);
        expect(slots.length).toBeLessThanOrEqual(4);
        for (const s of slots) {
          expect([0, 0.5, 1]).toContain(s.dy);
          expect(s.hint).toContain("{label}");
          // Plain copy: no word of 4+ letters said twice, even inside
          // another word ("Beside the side of ...").
          const text = s.hint.replace("{label}", "").toLowerCase();
          for (const w of text.match(/[a-z]{4,}/g) ?? []) expect(text.split(w).length - 1, s.hint).toBe(1);
          // On the pad, so the pad height holds under it.
          expect(Math.hypot(s.x, s.z)).toBeLessThan(t.padR);
        }
      }
    }
  });
});

describe("placePieces", () => {
  it("keeps the spacing, bounds and site rules", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const l = generateLayout(seed);
      const pieces = placePieces(l, rng(seed ^ 0x5e7));
      expect(pieces).toEqual(l.pieces);
      const vs = vertices(l);
      const seaSide = l.ring.includes("sea");
      const counts: Record<string, Set<number>> = {};
      pieces.forEach((p, i) => {
        const where = `seed ${seed} ${p.id} ${p.template} at (${p.x}, ${p.z})`;
        expect(p.id).toBe(`p${i}`);
        expect(p.padR).toBe(TEMPLATES[p.template].padR);
        expect(Math.abs(p.x), where).toBeLessThanOrEqual(690);
        expect(Math.abs(p.z), where).toBeLessThanOrEqual(690);
        const h = macroHeight(l, p.x, p.z);
        expect(h, where).toBeGreaterThanOrEqual(0.5);
        expect(p.padY).toBeCloseTo(Math.round(h * 10) / 10, 9);
        expect(Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z), where).toBeGreaterThanOrEqual(60);
        for (const q of pieces.slice(0, i)) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), where).toBeGreaterThanOrEqual(150);
        }
        (counts[p.template] ??= new Set()).add(p.variant);
        expect([0, 1, 2]).toContain(p.variant);

        const near = (d: number) => vs.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) <= d);
        switch (p.template) {
          case "lighthouse":
            expect(seaSide, where).toBe(true);
            expect(near(120).some((v) => v[2] < 0), where).toBe(true);
            expect(h, where).toBeGreaterThanOrEqual(8);
            break;
          case "shipwreck":
            expect(near(40).some((v) => v[2] < 0), where).toBe(true);
            expect(h, where).toBeGreaterThanOrEqual(0.5);
            expect(h, where).toBeLessThanOrEqual(4);
            break;
          case "stone-circle":
            expect(biomeAt(l, p.x, p.z), where).toBe("meadow");
            expect(padSpread(l, p), where).toBeLessThanOrEqual(2);
            break;
          case "radio-tower":
            expect(near(150).every((v) => v[2] <= h), where).toBe(true);
            break;
          case "camp":
            expect(biomeAt(l, p.x, p.z), where).toBe("forest");
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "plane":
            expect(["forest", "snowcap"]).not.toContain(biomeAt(l, p.x, p.z));
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "windmill":
            expect(["meadow", "rocky"]).toContain(biomeAt(l, p.x, p.z));
            expect(h, where).toBeGreaterThanOrEqual(12);
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "farm":
            expect(["meadow", "wetland"]).toContain(biomeAt(l, p.x, p.z));
            expect(padSpread(l, p), where).toBeLessThanOrEqual(2);
            break;
          case "watchtower":
            expect(biomeAt(l, p.x, p.z), where).not.toBe("forest");
            expect(h, where).toBeGreaterThanOrEqual(15);
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "lookout":
            expect(biomeAt(l, p.x, p.z), where).toBe("forest");
            expect(h, where).toBeGreaterThanOrEqual(10);
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "garden":
            expect(biomeAt(l, p.x, p.z), where).toBe("meadow");
            expect(padSpread(l, p), where).toBeLessThanOrEqual(2);
            break;
        }
      });
      // At most 3 of a kind, each with its own label.
      for (const t of IDS) {
        const n = pieces.filter((p) => p.template === t).length;
        expect(n).toBeLessThanOrEqual(3);
        expect(counts[t]?.size ?? 0).toBe(n);
      }
    }
  }, 30_000);

  it("pieceLabel names the kind with its label word", () => {
    const p = makeLayout(1).pieces[0]!;
    const t = TEMPLATES[p.template];
    expect(pieceLabel(p)).toBe(`${t.labels[p.variant]} ${t.name}`);
    expect(pieceLabel({ ...p, template: "lighthouse", variant: 0 })).toBe("red lighthouse");
  });
});

describe("worldSlot", () => {
  it("worldSlot rotates by yaw", () => {
    const p: SetPiece = {
      id: "p0", template: "camp", x: 0, z: 0, yaw: Math.PI / 2, padY: 3, padR: 14, variant: 0, params: {},
    };
    const w = worldSlot(p, { x: 2, z: 0, dy: 0.5, hint: "" });
    expect(w.x).toBeCloseTo(0, 9);
    expect(w.z).toBeCloseTo(-2, 9);
    expect(w.dy).toBe(0.5);
    const q = worldSlot({ ...p, x: 100, z: -50, yaw: 0 }, { x: 2, z: 3, dy: 0, hint: "" });
    expect(q).toEqual({ x: 102, z: -47, dy: 0 });
  });
});

describe("lamps and heights", () => {
  const samples = (id: TemplateId) => {
    const t = TEMPLATES[id];
    return [0, 0.5, 1 - 1e-9].map((v) => t.roll(() => v));
  };

  it("lighthouse: top and lamps", () => {
    for (const p of samples("lighthouse")) {
      const t = TEMPLATES.lighthouse;
      expect(t.top!(p)).toBeCloseTo(p.height! + (p.ruined ? 1.1 : 3.6), 9);
      const R = 2.5 + p.height! * 0.1;
      expect(t.lamps!(p)).toEqual(
        p.ruined
          ? []
          : [
              { x: 0, y: p.height! + 1.2, z: 0, clue: false },
              { x: 0, y: 2.6, z: -(R + 0.25), clue: true },
            ],
      );
    }
  });

  it("radio tower: top and lamps", () => {
    for (const p of samples("radio-tower")) {
      const t = TEMPLATES["radio-tower"];
      const b = 1 + p.height! * 0.03;
      expect(t.top!(p)).toBeCloseTo(p.height! + 3.5, 9);
      expect(t.lamps!(p)).toEqual([
        { x: 0, y: p.height! + 3.25, z: 0, clue: false },
        { x: b + 3.5, y: 2.6, z: -1.75, clue: true },
      ]);
    }
  });

  it("camp: a lantern, no top", () => {
    const t = TEMPLATES.camp;
    expect(t.top).toBeUndefined();
    const [l] = t.lamps!({ tents: 2, firepit: 0 });
    expect(l!.x).toBeCloseTo(Math.sin((3 * Math.PI) / 4) * 2.6, 9);
    expect(l!.z).toBeCloseTo(-Math.cos((3 * Math.PI) / 4) * 2.6, 9);
    expect(l!.y).toBe(2.2);
    expect(l!.clue).toBe(true);
  });

  it("the other templates have neither", () => {
    for (const id of ["shipwreck", "stone-circle", "plane"] as TemplateId[]) {
      expect(TEMPLATES[id].top).toBeUndefined();
      expect(TEMPLATES[id].lamps).toBeUndefined();
    }
  });

  it("every clue lamp is within LAMP_REACH of a slot of its piece", () => {
    for (const id of IDS) {
      const t = TEMPLATES[id];
      if (!t.lamps) continue;
      for (const p of samples(id)) {
        for (const l of t.lamps(p).filter((x) => x.clue)) {
          const d = Math.min(...t.slots(p).map((s) => Math.hypot(s.x - l.x, s.z - l.z)));
          expect(d, id).toBeLessThanOrEqual(LAMP_REACH);
        }
      }
    }
  });

  it("worldLamp turns like worldSlot and lifts by padY", () => {
    const p = { x: 100, z: -50, yaw: Math.PI / 2, padY: 7 };
    const w = worldLamp(p, { x: 2, y: 2.6, z: 3, clue: true });
    const s = worldSlot(p, { x: 2, z: 3, dy: 0, hint: "" });
    expect(w.x).toBeCloseTo(s.x, 9);
    expect(w.z).toBeCloseTo(s.z, 9);
    expect(w.y).toBeCloseTo(9.6, 9);
  });
});

describe("1000 seeds", () => {
  it("1000 seeds: makeLayout never fails and every map has 10–14 pieces", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const l = makeLayout(seed);
      expect(l.version).toBe(2);
      expect(l.pieces.length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(l.pieces.length, `seed ${seed}`).toBeLessThanOrEqual(14);
    }
  }, 60_000);
});

// The M4b built templates: the values in the task-2 brief, word for word.
describe("windmill, farm, watchtower, fire lookout, garden", () => {
  type Want = { top: number; lamps?: object[]; slots: [number, number, number, string][] };
  const WANT: Record<string, { rolls: Record<string, number>[]; want: (p: Record<string, number>) => Want }> = {
    windmill: {
      rolls: [{ height: 9, turning: 1 }, { height: 12.3, turning: 0 }],
      want: (p) => ({
        top: p.height! + 1.5,
        lamps: [
          { x: 0, y: 2.6, z: -2.75, clue: true },
          { x: 0, y: p.height! - 1, z: -3.2, clue: false },
        ],
        slots: [
          [0, -3.3, 0, "By the door of the {label}."],
          [0, 3.3, 0, "Behind the {label}."],
          [3.8, 0, 1, "On the crates beside the {label}."],
        ],
      }),
    },
    farm: {
      rolls: [{ buildings: 1, ruin: 0 }, { buildings: 3, ruin: 2 }, { buildings: 2, ruin: 1 }],
      want: (p) => ({
        top: p.ruin! < 2 ? 5 : 3,
        slots: [
          [0, -5, 0, "Inside the barn of the {label}."],
          [1.8, 4, 0, "Beside the cart at the {label}."],
          [0, 9.2, 0, "By the broken fence of the {label}."],
        ],
      }),
    },
    watchtower: {
      rolls: [{ floors: 1, broken: 1 }, { floors: 3, broken: 0 }],
      want: (p) => ({
        top: p.floors! * 4 + (p.broken ? 0 : 1.5),
        slots: [
          [0, -3.3, 0, "At the door of the {label}."],
          [4.2, 0, 0.5, "On the fallen stones by the {label}."],
          [0, 3.3, 0, "Behind the {label}."],
        ],
      }),
    },
    lookout: {
      rolls: [{ stilts: 4 }, { stilts: 7.6 }],
      want: (p) => ({
        top: p.stilts! + 3.5,
        slots: [
          [0, 0, 0, "Under the {label}, between its legs."],
          [0, 2.7, 0, "At the foot of the ladder of the {label}."],
          [3.6, 0.3, 0, "Beside the wood pile at the {label}."],
        ],
      }),
    },
    garden: {
      rolls: [{ hedge: 1.2 }, { hedge: 1.8 }],
      want: () => ({
        top: 2,
        lamps: [
          { x: -1.8, y: 2.2, z: -9.6, clue: true },
          { x: 1.8, y: 2.2, z: -9.6, clue: false },
        ],
        slots: [
          [0, 3, 0, "Behind the fountain in the {label}."],
          [6.5, 6.5, 0, "In a corner of the {label}."],
          [0, -9.5, 0, "Outside the gate of the {label}."],
        ],
      }),
    },
  };

  it("names, labels and pad radii", () => {
    const meta = (id: TemplateId) => [TEMPLATES[id].name, TEMPLATES[id].labels, TEMPLATES[id].padR];
    expect(meta("windmill")).toEqual(["windmill", ["white", "red", "brown"], 10]);
    expect(meta("farm")).toEqual(["farm", ["red", "white", "yellow"], 16]);
    expect(meta("watchtower")).toEqual(["watchtower", ["grey", "sandy", "dark"], 10]);
    expect(meta("lookout")).toEqual(["fire lookout", ["green", "brown", "red"], 8]);
    expect(meta("garden")).toEqual(["garden", ["white", "sandy", "dark"], 14]);
  });

  for (const [id, { rolls, want }] of Object.entries(WANT)) {
    it(`${id}: top, lamps and slots for each roll`, () => {
      const t = TEMPLATES[id as TemplateId];
      for (const p of rolls) {
        const w = want(p);
        expect(t.top!(p), JSON.stringify(p)).toBeCloseTo(w.top, 9);
        if (w.lamps) {
          const got = t.lamps!(p).map((l) => ({ ...l, y: Math.round(l.y * 1e9) / 1e9 }));
          expect(got).toEqual(w.lamps);
        } else expect(t.lamps).toBeUndefined();
        const slots = t.slots(p);
        expect(slots.map((s) => [s.x, s.z, s.dy, s.hint])).toEqual(w.slots);
        for (const s of slots) expect(Math.hypot(s.x, s.z), `${id} ${s.hint}`).toBeLessThanOrEqual(t.padR - 1);
        for (let i = 0; i < slots.length; i++) {
          for (let j = 0; j < i; j++) {
            const d = Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.z - slots[j]!.z);
            expect(d, `${id} slots ${j} and ${i}`).toBeGreaterThanOrEqual(1.5);
          }
        }
      }
    });
  }

  it("no hint says {label} twice or {label}'s", () => {
    for (const id of IDS) {
      const t = TEMPLATES[id];
      for (const p of [0, 0.5, 1 - 1e-9].map((v) => t.roll(() => v))) {
        for (const s of t.slots(p)) {
          expect(s.hint.split("{label}").length - 1, s.hint).toBe(1);
          expect(s.hint, s.hint).not.toContain("{label}'s");
        }
      }
    }
  });

  it("pieces.json keeps the old six templates as they were at dbba03a", () => {
    // sha256 of JSON.stringify([[id, entry], ...]) over the six, read from
    // the fixture as committed before the five were added.
    const file = join(import.meta.dirname, "../godot/tests/fixtures/pieces.json");
    const fx = JSON.parse(readFileSync(file, "utf8"));
    const old = ["lighthouse", "shipwreck", "stone-circle", "radio-tower", "camp", "plane"];
    const hash = createHash("sha256").update(JSON.stringify(old.map((k) => [k, fx.templates[k]]))).digest("hex");
    expect(hash).toBe("b5e42018e58bc6ff019ba5bbdf3e735d1bbbef9fca648d31e1d1bd680618331f");
    expect(Object.keys(fx.templates).sort()).toEqual([...IDS].sort());
  });
});
