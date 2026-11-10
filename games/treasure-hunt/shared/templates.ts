// The set-piece catalog (§5). Each template rolls its params and says where
// its cache slots are. Godot builds the geometry (Task 5) to the sizes noted
// here, so every slot lands next to something real and never inside it.
//
// Local frame, before yaw: −Z is the front, +X the right. Slot dy is metres
// above the pad: 0 on the ground, 0.5 or 1.0 on top of a low block.

import type { Rng } from "./noise.ts";
import type { SetPiece, TemplateId } from "./types.ts";

export interface Slot {
  x: number;
  z: number;
  dy: number;
  /** Plain words with a {label} placeholder, e.g. "By the door of the {label}." */
  hint: string;
}

export interface Template {
  id: TemplateId;
  name: string;
  labels: [string, string, string];
  padR: number;
  roll(r: Rng): Record<string, number>;
  /** 2–4 slots, 0 ≤ dy ≤ 1. */
  slots(params: Record<string, number>): Slot[];
}

const between = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const coin = (r: Rng) => (r() < 0.5 ? 1 : 0);
const round = (v: number, step: number) => Math.round(v / step) * step + 0;
/** A point at angle `a` (clockwise from −Z) and radius `d`. */
const polar = (a: number, d: number) => ({ x: Math.sin(a) * d, z: -Math.cos(a) * d });

/** Lighthouse: a round tower with the door at −Z. */
export const lighthouseRadius = (p: Record<string, number>) => 2.5 + p.height! * 0.1;
/** Shipwreck: a hull along Z, bow at −Z, this wide. Tilt rolls it about Z. */
export const hullBeam = (p: Record<string, number>) => p.length! * 0.3;
/** Stone circle: stone k stands at polar(2πk/stones, radius). Stone 0 is the tallest. */
export const circleRadius = (p: Record<string, number>) => 2 + p.stones! * 0.6;
/** Radio tower: four legs at (±b, ±b). */
export const towerBase = (p: Record<string, number>) => 1 + p.height! * 0.03;

export const TEMPLATES: Record<TemplateId, Template> = {
  // Tower radius R. Ruined: a fallen stone block, 0.5 m high, at (R + 2.5, 0).
  // Working: a stack of boxes, 1 m high, at the same spot.
  lighthouse: {
    id: "lighthouse",
    name: "lighthouse",
    labels: ["red", "white", "blue"],
    padR: 10,
    roll: (r) => ({ height: round(between(r, 14, 22), 0.1), ruined: coin(r) }),
    slots: (p) => {
      const R = lighthouseRadius(p);
      return [
        { x: 0, z: -(R + 0.8), dy: 0, hint: "By the door of the {label}." },
        { x: 0, z: R + 0.8, dy: 0, hint: "Behind the {label}." },
        p.ruined
          ? { x: R + 2.5, z: 0, dy: 0.5, hint: "On a fallen stone by the {label}." }
          : { x: R + 2.5, z: 0, dy: 1, hint: "On top of the boxes by the {label}." },
      ];
    },
  },

  // Hull: length L along Z, beam 0.3 L, about 0.25 L high before burying.
  // A 20° roll moves its top edge out by under 2 m, so the side slot keeps 2.5 m.
  shipwreck: {
    id: "shipwreck",
    name: "shipwreck",
    labels: ["blue", "green", "black"],
    padR: 14,
    roll: (r) => ({
      length: round(between(r, 12, 20), 0.1),
      buried: round(between(r, 0, 0.5), 0.01),
      tilt: round(between(r, -20, 20), 1),
    }),
    slots: (p) => {
      const L = p.length!;
      return [
        { x: 0, z: -(L / 2 + 1.5), dy: 0, hint: "At the front end of the {label}." },
        { x: 0, z: L / 2 + 1.5, dy: 0, hint: "At the back end of the {label}." },
        { x: hullBeam(p) / 2 + 2.5, z: 0, dy: 0, hint: "Beside the side of the {label}." },
      ];
    },
  },

  // Fallen stones are the last `fallen` ones. Each lies flat, pointing out from
  // the centre, 0.5 m high, its middle 1.5 m outside the ring.
  "stone-circle": {
    id: "stone-circle",
    name: "stone circle",
    labels: ["grey", "dark", "sandy"],
    padR: 14,
    roll: (r) => ({ stones: int(r, 6, 12), fallen: int(r, 0, 3) }),
    slots: (p) => {
      const Rc = circleRadius(p);
      const n = p.stones!;
      const out: Slot[] = [
        { x: 0, z: 0, dy: 0, hint: "In the middle of the {label}." },
        { ...polar(0, Rc + 1.2), dy: 0, hint: "Behind the tallest stone of the {label}." },
      ];
      if (p.fallen! > 0) {
        out.push({ ...polar((2 * Math.PI * (n - 1)) / n, Rc + 1.5), dy: 0.5, hint: "On top of a fallen stone in the {label}." });
      }
      return out;
    },
  },

  // Legs at (±b, ±b). A 3 × 3 m hut centred at (b + 3.5, 0), door on its −Z face.
  // Wires: three anchors at polar(0°, 120°, 240°; 6.5 m).
  "radio-tower": {
    id: "radio-tower",
    name: "radio tower",
    labels: ["red", "white", "yellow"],
    padR: 8,
    roll: (r) => ({ height: round(between(r, 20, 35), 0.1), wires: coin(r) }),
    slots: (p) => {
      const b = towerBase(p);
      const out: Slot[] = [
        { x: 0, z: 0, dy: 0, hint: "Under the {label}, between its four legs." },
        { x: b + 3.5, z: -2.3, dy: 0, hint: "By the door of the small hut at the {label}." },
      ];
      if (p.wires) out.push({ ...polar((4 * Math.PI) / 3, 7.4), dy: 0, hint: "Where a wire from the {label} meets the ground." });
      return out;
    },
  },

  // Tent i at polar(2πi/tents, 5 m), door facing the centre. A fire pit,
  // 0.8 m across, at the centre. A log seat, 0.5 m high, along Z at x = −2.2.
  camp: {
    id: "camp",
    name: "camp",
    labels: ["orange", "green", "blue"],
    padR: 14,
    roll: (r) => ({ tents: int(r, 1, 3), firepit: coin(r) }),
    slots: (p) => [
      { ...polar(0, 7.2), dy: 0, hint: "Behind a tent at the {label}." },
      p.firepit
        ? { x: 1.3, z: 0, dy: 0, hint: "Next to the fire pit at the {label}." }
        : { x: 0, z: 0, dy: 0, hint: "In the middle of the {label}." },
      { x: -2.2, z: 0, dy: 0.5, hint: "On the log seat at the {label}." },
    ],
  },

  // Body along Z from −6 to 6, nose at −Z. Wings at z −2..0, x −7..7. The
  // debris trail starts 9 m out along `heading` (radians, clockwise from −Z);
  // with 20 or more bits, its biggest piece sits at 12 m.
  plane: {
    id: "plane",
    name: "plane",
    labels: ["white", "yellow", "red"],
    padR: 16,
    roll: (r) => ({ debris: int(r, 10, 30), heading: round(between(r, 0, 2 * Math.PI), 0.01) }),
    slots: (p) => {
      const out: Slot[] = [
        { x: 0, z: -7.5, dy: 0, hint: "By the nose of the {label}." },
        { x: 0, z: 7.5, dy: 0, hint: "By the tail of the {label}." },
        { x: -8.2, z: -1, dy: 0, hint: "By the end of a wing of the {label}." },
      ];
      if (p.debris! >= 20) out.push({ ...polar(p.heading!, 12), dy: 0, hint: "Next to a big broken piece of the {label}." });
      return out;
    },
  },
};

/** "red lighthouse". */
export function pieceLabel(p: SetPiece): string {
  const t = TEMPLATES[p.template];
  return `${t.labels[p.variant]} ${t.name}`;
}

/** A slot in world space. Godot's yaw turns +X towards −Z. */
export function worldSlot(p: SetPiece, s: Slot): { x: number; z: number; dy: number } {
  const c = Math.cos(p.yaw);
  const n = Math.sin(p.yaw);
  return { x: p.x + s.x * c + s.z * n, z: p.z - s.x * n + s.z * c, dy: s.dy };
}
