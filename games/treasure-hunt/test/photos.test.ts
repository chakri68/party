import { describe, expect, it } from "vitest";
import {
  MACRO_CELL,
  MACRO_ORIGIN,
  MACRO_SIZE,
  PHOTO_DIST,
  PHOTO_FILL,
  PHOTO_FOV_MAX,
  PHOTO_FOV_MIN,
  START_MIN,
  TEMPLATES,
  generateLayout,
  rng,
  type SetPiece,
  type TemplateId,
  type TreasureLayout,
} from "../shared/index.ts";
import type { CacheSpot } from "../server/caches.ts";
import { makeHunt, type HuntSky } from "../server/hunt.ts";
import { photoCam } from "../server/photos.ts";

const DAY: HuntSky = { startMin: START_MIN.day, minutes: 30 };
const NIGHT: HuntSky = { startMin: START_MIN.night, minutes: 30 };
const DUSK_SHORT: HuntSky = { startMin: START_MIN.dusk, minutes: 15 };
const DUSK_LONG: HuntSky = { startMin: START_MIN.dusk, minutes: 60 };
const PHOTO = /^A photo taken about 5 m from the cache, looking at the (.+)\.$/;

/** A flat 10 m island, no minor points, these pieces. `params` overrides the roll. */
function flat(pieces: { template: TemplateId; x: number; z: number; params?: Record<string, number> }[]): TreasureLayout {
  const l = structuredClone(generateLayout(1));
  l.macro.heights = l.macro.heights.map(() => 100);
  l.minor = [];
  l.trails = [];
  l.pieces = pieces.map((p, i): SetPiece => ({
    id: `p${i}`,
    template: p.template,
    x: p.x,
    z: p.z,
    yaw: 0,
    padY: 10,
    padR: TEMPLATES[p.template].padR,
    variant: 0,
    params: { ...TEMPLATES[p.template].roll(rng(i + 1)), ...p.params },
  }));
  return l;
}

/** Set every macro vertex within `r` of (x, z) to `dm` decimetres. */
function paint(l: TreasureLayout, x: number, z: number, r: number, dm: number): void {
  for (let j = 0; j < MACRO_SIZE; j++) {
    for (let i = 0; i < MACRO_SIZE; i++) {
      const vx = MACRO_ORIGIN + i * MACRO_CELL;
      const vz = MACRO_ORIGIN + j * MACRO_CELL;
      if (Math.hypot(vx - x, vz - z) <= r) l.macro.heights[j * MACRO_SIZE + i] = dm;
    }
  }
}

const spot = (x: number, z: number): CacheSpot => ({ x, z, dy: 0, source: "m0" });

describe("photoCam", () => {
  const l = flat([{ template: "radio-tower", x: 100, z: 0 }]);
  const s = spot(40, 30);

  it("sits 5 m from the spot, behind it from the target", () => {
    const cam = photoCam(l, s, DAY)!;
    expect(cam).not.toBeNull();
    expect(cam.target).toBe("p0");
    expect(Math.abs(Math.hypot(cam.x - s.x, cam.z - s.z) - PHOTO_DIST)).toBeLessThanOrEqual(0.1);
    // The spot lies on the camera-to-target line, between them.
    const t = l.pieces[0]!;
    const dx = t.x - cam.x;
    const dz = t.z - cam.z;
    const len = Math.hypot(dx, dz);
    const off = Math.abs((s.x - cam.x) * dz - (s.z - cam.z) * dx) / len;
    expect(off).toBeLessThanOrEqual(1);
    expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeLessThan(len);
  });

  it("yaw faces the target, Godot style", () => {
    const cam = photoCam(l, s, DAY)!;
    const t = l.pieces[0]!;
    const want = Math.atan2(t.x - cam.x, t.z - cam.z);
    const got = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
    const diff = Math.abs(((got - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(diff).toBeLessThanOrEqual(0.02);
    // The mid-height of a tall tower is above the eye, so it looks up.
    expect(cam.pitch).toBeGreaterThan(0);
    expect(cam.yaw).toBe(Math.round(cam.yaw * 100) / 100);
    expect(cam.x).toBe(Math.round(cam.x * 10) / 10);
  });

  it("skips the spot's own piece", () => {
    const own = flat([{ template: "radio-tower", x: 40, z: 40 }, { template: "camp", x: 120, z: 30 }]);
    expect(photoCam(own, { ...spot(40, 30), source: "p0" }, DAY)?.target).toBe("p1");
  });

  it("nothing past PHOTO_MAX", () => {
    expect(photoCam(flat([{ template: "radio-tower", x: 300, z: 30 }]), spot(40, 30), DAY)).toBeNull();
  });

  it("null when the camera lands in the sea", () => {
    const wet = flat([{ template: "radio-tower", x: 100, z: 0 }]);
    // Sea behind the spot, away from the tower; the spot itself stays on land.
    // Only the vertex at (-32, 0) sinks: the spot at -24 stays at 1 m, the camera at -29 is under water.
    paint(wet, -40, 0, 20, -20);
    expect(photoCam(wet, spot(-24, 0), DAY)).toBeNull();
    expect(photoCam(l, spot(-24, 0), DAY)).not.toBeNull();
  });

  it("null when the camera stands on a pad", () => {
    // Tower 15 m east of the spot; the camera goes 5 m west, 15 m from the camp.
    const at = (padR: number) => {
      const m = flat([{ template: "radio-tower", x: 55, z: 0 }, { template: "camp", x: 20, z: 0 }]);
      m.pieces[1]!.padR = padR;
      return photoCam(m, spot(40, 0), DAY);
    };
    expect(at(14)?.target).toBe("p0");
    expect(at(16)).toBeNull();
  });

  it("null with a ridge between the spot and the only near piece", () => {
    const ridged = flat([{ template: "camp", x: 160, z: 0 }]);
    expect(photoCam(ridged, spot(0, 0), DAY)).not.toBeNull();
    paint(ridged, 80, 0, 20, 400);
    expect(photoCam(ridged, spot(0, 0), DAY)).toBeNull();
  });

  it("at night, a spot near only a plane and a shipwreck gives null", () => {
    const dark = flat([{ template: "plane", x: 60, z: 0 }, { template: "shipwreck", x: -60, z: 40 }]);
    expect(photoCam(dark, spot(0, 0), DAY)).not.toBeNull();
    expect(photoCam(dark, spot(0, 0), NIGHT)).toBeNull();
  });

  it("at night it faces a lit piece, even a farther one", () => {
    const dark = flat([
      { template: "plane", x: 60, z: 0 },
      { template: "lighthouse", x: 0, z: 150, params: { ruined: 1 } },
      { template: "camp", x: -120, z: 0 },
    ]);
    expect(photoCam(dark, spot(0, 0), DAY)!.target).toBe("p0");
    // A ruined lighthouse has no lamps, so the camp wins.
    expect(photoCam(dark, spot(0, 0), NIGHT)!.target).toBe("p2");
  });

  // A dusk round that ends in the dark: a photo can render after dark (a Race clue opens late, a page reloads).
  it("a round that gets dark later counts as night; a short dusk round doesn't", () => {
    const dark = flat([{ template: "plane", x: 60, z: 0 }, { template: "camp", x: -120, z: 0 }]);
    expect(photoCam(dark, spot(0, 0), DUSK_SHORT)!.target).toBe("p0");
    expect(photoCam(dark, spot(0, 0), DUSK_LONG)!.target).toBe("p1");
  });

  it("the lens frames the target's top at PHOTO_FILL of the height, clamped", () => {
    const cam = photoCam(l, s, DAY)!;
    const t = l.pieces[0]!;
    const top = TEMPLATES[t.template].top!(t.params);
    const len = Math.hypot(t.x - cam.x, t.z - cam.z);
    // tan(fov/2) is half the frame's height at the target's distance.
    const fill = top / (2 * len * Math.tan((cam.fov * Math.PI) / 360));
    expect(Math.abs(fill - PHOTO_FILL)).toBeLessThan(0.01);
    expect(cam.fov).toBe(Math.round(cam.fov * 10) / 10);
    // Close up the lens is as wide as it goes; far off, as long as it goes.
    expect(photoCam(flat([{ template: "radio-tower", x: 45, z: 30 }]), s, DAY)!.fov).toBe(PHOTO_FOV_MAX);
    expect(photoCam(flat([{ template: "camp", x: 280, z: 30 }]), s, DAY)!.fov).toBe(PHOTO_FOV_MIN);
  });
});

describe("photo caches", () => {
  it("50 seeds by day, 30 minutes: at least 40 maps have a photo cache, with its pose", () => {
    let hits = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { layout: l, caches } = makeHunt(seed, DAY);
      for (const c of caches) {
        const has = c.clues.some((t) => PHOTO.test(t));
        expect(c.photo !== null, `seed ${seed} ${c.id}`).toBe(has);
        if (c.photo) expect(c.photo).toEqual(photoCam(l, c, DAY));
      }
      if (caches.some((c) => c.photo)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(40);
  });

  // Review I1: dusk 60 ends in the dark, so every photo aims at a piece with lamps.
  it("40 seeds at dusk, 60 minutes: every photo target has lamps", () => {
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { layout: l, caches } = makeHunt(seed, DUSK_LONG);
      for (const c of caches) {
        if (!c.photo) continue;
        n++;
        const p = l.pieces.find((q) => q.id === c.photo!.target)!;
        expect(TEMPLATES[p.template].lamps?.(p.params).length ?? 0, `seed ${seed} ${c.id} ${p.template}`).toBeGreaterThan(0);
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});
