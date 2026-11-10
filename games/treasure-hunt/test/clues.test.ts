import { describe, expect, it } from "vitest";
import {
  LAMP_REACH,
  SHADOW_STEP,
  START_MIN,
  TEMPLATES,
  generateLayout,
  pieceLabel,
  rng,
  shadowTip,
  validateLayout,
  worldLamp,
  worldSlot,
  type SetPiece,
  type TreasureLayout,
} from "../shared/index.ts";
import { makeHunt, type HuntSky } from "../server/hunt.ts";
import { cacheSpots, type Cache, type CacheSpot } from "../server/caches.ts";
import { clueTexts, shadowSpots } from "../server/clues.ts";

const LANDMARK_FILLER = /^[A-Z][^.]*\.$/;
const RELATIONAL = /^Between the (.+) and the (.+), nearer the (.+)\.$/;
const BEARING = /^About (\d+) m from the (.+), at (\d+)°\.$/;

const SHADOW = /^Where the shadow of the (.+) ends at (\d\d):(\d\d)\.$/;
const LAMP = /^Under the lamp at the (.+)\. It comes on when it gets dark\.$/;

type Kind = "landmark" | "relational" | "bearing" | "shadow" | "lamp";
const DIFFICULTY: Record<Kind, 1 | 2 | 3> = { landmark: 1, relational: 2, bearing: 3, shadow: 3, lamp: 2 };

const DAY: HuntSky = { startMin: START_MIN.day, minutes: 60 };
const DUSK_SHORT: HuntSky = { startMin: START_MIN.dusk, minutes: 15 };
const DUSK_LONG: HuntSky = { startMin: START_MIN.dusk, minutes: 60 };
const NIGHT: HuntSky = { startMin: START_MIN.night, minutes: 60 };

/** The first valid layout with a lighthouse in this state. */
function withLighthouse(ruined: 0 | 1): { l: TreasureLayout; p: SetPiece } {
  for (let seed = 1; ; seed++) {
    const l = generateLayout(seed);
    if (validateLayout(l).length > 0) continue;
    const p = l.pieces.find((q) => q.template === "lighthouse" && q.params.ruined === ruined);
    if (p) return { l, p };
  }
}

/** The lighthouse door slot, as a spot. */
function doorSpot(p: SetPiece): CacheSpot {
  return { ...worldSlot(p, TEMPLATES.lighthouse.slots(p.params)[0]!), source: p.id };
}

/** The one piece with this label. Fails if none or more than one has it. */
function byLabel(l: TreasureLayout, label: string): SetPiece {
  const hits = l.pieces.filter((p) => pieceLabel(p) === label);
  expect(hits, `label "${label}"`).toHaveLength(1);
  return hits[0]!;
}

/** Check one clue against the map and return its kind. */
function checkClue(l: TreasureLayout, c: Cache, clue: string, sky: HuntSky): Kind {
  const sh = SHADOW.exec(clue);
  if (sh) {
    const p = byLabel(l, sh[1]!);
    expect(c.source).toBe(p.id);
    const min = c.shadowMin!;
    expect(min % SHADOW_STEP).toBe(0);
    expect(min).toBeGreaterThanOrEqual(sky.startMin);
    expect(min).toBeLessThanOrEqual(sky.startMin + sky.minutes);
    expect(`${sh[2]}:${sh[3]}`).toBe(`${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
    const tip = shadowTip(p, TEMPLATES[p.template].top!(p.params), min)!;
    expect(Math.hypot(tip.x - c.x, tip.z - c.z)).toBeLessThan(1e-9);
    return "shadow";
  }
  const lamp = LAMP.exec(clue);
  if (lamp) {
    const p = byLabel(l, lamp[1]!);
    expect(c.source).toBe(p.id);
    expect(c.shadowMin).toBeUndefined();
    const near = TEMPLATES[p.template].lamps!(p.params).some((k) => {
      const w = worldLamp(p, k);
      return k.clue && Math.hypot(w.x - c.x, w.z - c.z) <= LAMP_REACH;
    });
    expect(near).toBe(true);
    return "lamp";
  }
  const rel = RELATIONAL.exec(clue);
  if (rel) {
    const a = byLabel(l, rel[1]!);
    const b = byLabel(l, rel[2]!);
    const near = byLabel(l, rel[3]!);
    expect(a.id).not.toBe(b.id);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / (len * len);
    const off = Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) / len;
    expect(t).toBeGreaterThanOrEqual(0.2);
    expect(t).toBeLessThanOrEqual(0.8);
    expect(off).toBeLessThanOrEqual(0.25 * len);
    const da = Math.hypot(c.x - a.x, c.z - a.z);
    const db = Math.hypot(c.x - b.x, c.z - b.z);
    expect(near.id).toBe(da <= db ? a.id : b.id);
    return "relational";
  }
  const brg = BEARING.exec(clue);
  if (brg) {
    const d = Number(brg[1]);
    const p = byLabel(l, brg[2]!);
    // Only a shadow spot may take a bearing from its own piece.
    if (c.shadowMin === undefined) expect(p.id).not.toBe(c.source);
    const b = Number(brg[3]);
    expect(d % 50).toBe(0);
    expect(d).toBeGreaterThanOrEqual(50);
    expect(b % 10).toBe(0);
    expect(b).toBeLessThan(360);
    expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeLessThanOrEqual(600);
    const a = (b * Math.PI) / 180;
    const ex = p.x + Math.sin(a) * d;
    const ez = p.z - Math.cos(a) * d;
    expect(Math.hypot(ex - c.x, ez - c.z)).toBeLessThanOrEqual(60);
    return "bearing";
  }
  // Landmark: one of the source piece's own slot hints, at this cache's spot.
  expect(clue).toMatch(LANDMARK_FILLER);
  expect(c.shadowMin, `landmark clue "${clue}" on a shadow spot`).toBeUndefined();
  const p = l.pieces.find((q) => q.id === c.source);
  expect(p, `landmark clue "${clue}" on a non-piece cache`).toBeDefined();
  const slot = TEMPLATES[p!.template].slots(p!.params).find((s) => s.hint.replace("{label}", pieceLabel(p!)) === clue);
  expect(slot, clue).toBeDefined();
  const w = worldSlot(p!, slot!);
  expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeLessThan(1e-9);
  expect(clue).toContain(pieceLabel(p!));
  return "landmark";
}

describe("clues", () => {
  it("bearing text uses north −Z and east +X", () => {
    // Seed 42 must hold at least one bearing clue; check it by hand once.
    const { layout, caches } = makeHunt(42);
    const c = caches.find((k) => k.clues.some((t) => BEARING.test(t)));
    expect(c).toBeDefined();
    const m = BEARING.exec(c!.clues.find((t) => BEARING.test(t))!)!;
    const p = byLabel(layout, m[2]!);
    const raw = ((Math.atan2(c!.x - p.x, -(c!.z - p.z)) * 180) / Math.PI + 360) % 360;
    expect((Math.round(raw / 10) * 10) % 360).toBe(Number(m[3]));
  });

  /** 1–2 clues of different kinds, true to the map, difficulty is the easiest (2 at most at a piece). */
  function checkHunt(seed: number, sky?: HuntSky): void {
    const { layout: l, caches } = makeHunt(seed, sky);
    const at = sky ?? { startMin: START_MIN.day, minutes: 30 };
    for (const c of caches) {
      expect(c.clues.length).toBeGreaterThanOrEqual(1);
      expect(c.clues.length).toBeLessThanOrEqual(2);
      const kinds = c.clues.map((t) => checkClue(l, c, t, at));
      expect(new Set(kinds).size).toBe(kinds.length);
      const easiest = Math.min(...kinds.map((k) => DIFFICULTY[k]));
      // A shadow tip isn't at its piece, so the cap doesn't hold there.
      const atPiece = c.shadowMin === undefined && l.pieces.some((p) => p.id === c.source);
      expect(c.difficulty).toBe(atPiece ? Math.min(easiest, 2) : easiest);
    }
  }

  it("1000 seeds: 1–2 clues of different kinds, true to the map, difficulty is the easiest (2 at most at a piece)", () => {
    for (let seed = 1; seed <= 1000; seed++) checkHunt(seed);
  }, 120_000);

  it("100 seeds at dusk and night: light clues are true too", () => {
    for (let seed = 1; seed <= 100; seed++) {
      checkHunt(seed, DUSK_LONG);
      checkHunt(seed, { startMin: START_MIN.night, minutes: 15 });
    }
  }, 60_000);
});

describe("shadow clues", () => {
  const { l, p } = withLighthouse(0);

  it("by day: one spot per tall piece, at the tip, inside the window", () => {
    const spots = shadowSpots(l, DAY, rng(1));
    const tall = l.pieces.filter((q) => TEMPLATES[q.template].top);
    expect(spots.map((s) => s.source)).toEqual(tall.map((q) => q.id));
    expect(spots.some((s) => s.source === p.id)).toBe(true);
    for (const s of spots) {
      expect(s.dy).toBe(0);
      expect(s.shadowMin! % SHADOW_STEP).toBe(0);
      expect(s.shadowMin!).toBeGreaterThanOrEqual(600);
      expect(s.shadowMin!).toBeLessThanOrEqual(660);
      const t = clueTexts(l, s, DAY);
      expect(t.get("shadow")).toMatch(/^Where the shadow of the .+ ends at 1[01]:[0-5]0\.$/);
      expect(t.has("landmark")).toBe(false);
      expect(t.has("lamp")).toBe(false);
    }
  });

  it("none at night or before sunrise", () => {
    expect(shadowSpots(l, NIGHT, rng(1))).toEqual([]);
    expect(shadowSpots(l, { startMin: 200, minutes: 60 }, rng(1))).toEqual([]);
  });

  it("only a shadow spot takes a shadow clue", () => {
    expect(clueTexts(l, doorSpot(p), DAY).has("shadow")).toBe(false);
  });

  it("cacheSpots takes shadow tips as candidates", () => {
    const tips = cacheSpots(l, DAY).filter((x) => x.shadowMin !== undefined);
    expect(tips.length).toBeGreaterThan(0);
    for (const s of tips) {
      const q = l.pieces.find((x) => x.id === s.source)!;
      const tip = shadowTip(q, TEMPLATES[q.template].top!(q.params), s.shadowMin!)!;
      expect(Math.hypot(tip.x - s.x, tip.z - s.z)).toBeLessThan(1e-9);
    }
  });
});

describe("lamp clues", () => {
  it("a 15-minute dusk round never gets dark enough", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const l = generateLayout(seed);
      for (const s of cacheSpots(l, DUSK_SHORT)) expect(clueTexts(l, s, DUSK_SHORT).has("lamp")).toBe(false);
    }
  });

  it("a 60-minute dusk round lights the door of a working lighthouse", () => {
    const { l, p } = withLighthouse(0);
    expect(clueTexts(l, doorSpot(p), DUSK_LONG).get("lamp")).toBe(`Under the lamp at the ${pieceLabel(p)}. It comes on when it gets dark.`);
    expect(clueTexts(l, doorSpot(p), DAY).has("lamp")).toBe(false);
  });

  it("a ruined lighthouse has no lamp", () => {
    const { l, p } = withLighthouse(1);
    expect(clueTexts(l, doorSpot(p), DUSK_LONG).has("lamp")).toBe(false);
  });
});
