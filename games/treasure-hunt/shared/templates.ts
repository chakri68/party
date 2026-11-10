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

/** A lamp in the piece's local frame. y is metres above the pad. `clue` is true
 *  for a ground lamp a cache can be "under". */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  clue: boolean;
}

export interface Template {
  id: TemplateId;
  name: string;
  labels: [string, string, string];
  padR: number;
  roll(r: Rng): Record<string, number>;
  /** 2–4 slots, 0 ≤ dy ≤ 1. */
  slots(params: Record<string, number>): Slot[];
  /** Metres above the pad of the piece's highest point, at its local origin. */
  top(params: Record<string, number>): number;
  /** Lamps that come on at dusk. */
  lamps?(params: Record<string, number>): Lamp[];
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
    // Working: gallery, lamp and roof reach height + 3.6. Ruined: the broken rim, height + 1.1.
    top: (p) => p.height! + (p.ruined ? 1.1 : 3.6),
    // Working only: the lamp at the top, and one over the door.
    lamps: (p) =>
      p.ruined
        ? []
        : [
            { x: 0, y: p.height! + 1.2, z: 0, clue: false },
            { x: 0, y: 2.6, z: -(lighthouseRadius(p) + 0.25), clue: true },
          ],
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
    // The broken mast's tip, L / 2 over the keel: tilted, then sunk by `buried` of the hull's 0.25 L.
    top: (p) => p.length! * (0.5 * Math.cos((p.tilt! * Math.PI) / 180) - 0.25 * p.buried!),
    slots: (p) => {
      const L = p.length!;
      return [
        { x: 0, z: -(L / 2 + 1.5), dy: 0, hint: "At the front end of the {label}." },
        { x: 0, z: L / 2 + 1.5, dy: 0, hint: "At the back end of the {label}." },
        { x: hullBeam(p) / 2 + 2.5, z: 0, dy: 0, hint: "Along the side of the {label}." },
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
    // Stone 0, the tallest, never falls.
    top: () => 3.4,
    slots: (p) => {
      const Rc = circleRadius(p);
      const n = p.stones!;
      const out: Slot[] = [
        { x: 0, z: 0, dy: 0, hint: "In the middle of the {label}." },
        { ...polar(0, Rc + 1.2), dy: 0, hint: "Behind the tallest stone of the {label}." },
      ];
      if (p.fallen! > 0) {
        out.push({ ...polar((2 * Math.PI * (n - 1)) / n, Rc + 1.5), dy: 0.5, hint: "On top of a fallen stone by the {label}." });
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
    // The mast ends at height + 3, the red lamp on it at height + 3.5.
    top: (p) => p.height! + 3.5,
    // The red lamp on the mast, and one at the hut door.
    lamps: (p) => [
      { x: 0, y: p.height! + 3.25, z: 0, clue: false },
      { x: towerBase(p) + 3.5, y: 2.6, z: -1.75, clue: true },
    ],
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

  // Tent i at polar(2πi/tents, 5 m), door facing the centre, its footprint
  // within 1.25 m of that point (2.5 m across at most). A fire pit, 0.8 m
  // across, at the centre. A log seat, 0.5 m high and 0.4 m thick, at x = −2.2,
  // running 2 m along Z (z −1..1). With 3 tents, the tent at (−4.33, 2.5) then
  // keeps 1 m clear of the log.
  camp: {
    id: "camp",
    name: "camp",
    labels: ["orange", "green", "blue"],
    padR: 14,
    roll: (r) => ({ tents: int(r, 1, 3), firepit: coin(r) }),
    // The lantern's bulb, on its post.
    top: () => 2.35,
    // A lantern on a post, 2.6 m out at 135°, clear of every tent and slot.
    lamps: () => [{ ...polar((3 * Math.PI) / 4, 2.6), y: 2.2, clue: true }],
    slots: (p) => [
      { ...polar(0, 7.2), dy: 0, hint: "Behind a tent at the {label}." },
      p.firepit
        ? { x: 1.3, z: 0, dy: 0, hint: "Next to the fire pit at the {label}." }
        : { x: 0, z: 0, dy: 0, hint: "In the middle of the {label}." },
      { x: -2.2, z: 0, dy: 0.5, hint: "On the log seat at the {label}." },
    ],
  },

  // Body along Z from −6 to 6, nose at −Z. Wings at z −2..0, x −7..7.
  // Careful: `heading` is radians clockwise from −Z (as in `polar`), while
  // `yaw` is Godot's, counter-clockwise. Use polar(heading, d) for the trail.
  // The debris trail runs out along `heading`. Each bit sits beyond 9 m plus
  // its own size, and at least 1 m clear of every slot, the nose, tail and wing
  // ones included. With 20 or more bits, the biggest piece sits at
  // polar(heading, 13.5), its footprint under 0.8 m in radius, so the slot at
  // 12 m stands just in front of it.
  plane: {
    id: "plane",
    name: "plane",
    labels: ["white", "yellow", "red"],
    padR: 16,
    roll: (r) => ({ debris: int(r, 10, 30), heading: round(between(r, 0, 2 * Math.PI), 0.01) }),
    // The tail fin.
    top: () => 3.2,
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

  // Tower: 5 × 5 m, centred, `height` tall, the door on −Z. A roof cap,
  // tinted by the label, from height to height + 1.5. The sails turn on a
  // hub at (0, height − 1, −2.8): 4 blades, each 0.45 · height long, so the
  // lowest tip is 0.55 · height − 1 ≥ 3.95 m up. A stack of crates, 1 m high
  // and 1.2 m square, centred at (3.8, 0).
  windmill: {
    id: "windmill",
    name: "windmill",
    labels: ["white", "red", "brown"],
    padR: 10,
    roll: (r) => ({ height: round(between(r, 9, 13), 0.1), turning: coin(r) }),
    top: (p) => p.height! + 1.5,
    // A lamp over the door, and one on the front of the hub.
    lamps: (p) => [
      { x: 0, y: 2.6, z: -2.75, clue: true },
      { x: 0, y: p.height! - 1, z: -3.2, clue: false },
    ],
    slots: () => [
      { x: 0, z: -3.3, dy: 0, hint: "By the door of the {label}." },
      { x: 0, z: 3.3, dy: 0, hint: "Behind the {label}." },
      { x: 3.8, z: 0, dy: 1, hint: "On the crates beside the {label}." },
    ],
  },

  // Barn: 6 × 4 m (x −3..3, z −7..−3), walls 3 m, the label on its walls,
  // a doorway 1.4 m wide and 2.4 m high in the middle of its +Z wall. Its
  // gable roof peaks at 5 m. Ruin 1: half the roof is gone. Ruin 2: walls only.
  // Building 2 at (−9, 3), building 3 at (9, 3): 4 × 4 m, walls 3 m, no door.
  // A cart, 1.4 × 2.4 m along Z, at (0, 4). A broken fence along z = 10, x −6..6.
  farm: {
    id: "farm",
    name: "farm",
    labels: ["red", "white", "yellow"],
    padR: 16,
    roll: (r) => ({ buildings: int(r, 1, 3), ruin: int(r, 0, 2) }),
    top: (p) => (p.ruin! < 2 ? 5 : 3),
    slots: () => [
      { x: 0, z: -5, dy: 0, hint: "Inside the barn of the {label}." },
      { x: 1.8, z: 4, dy: 0, hint: "Beside the cart at the {label}." },
      { x: 0, z: 9.2, dy: 0, hint: "By the broken fence of the {label}." },
    ],
  },

  // Tower: 5 × 5 m, centred, floors · 4 m tall, a doorway on −Z, solid
  // inside. A battlement cap 1.5 m high, unless broken. A rubble block
  // 1.6 × 0.5 × 1.2 m centred at (4.2, 0); broken adds one at (−4.2, 1).
  watchtower: {
    id: "watchtower",
    name: "watchtower",
    labels: ["grey", "sandy", "dark"],
    padR: 10,
    roll: (r) => ({ floors: int(r, 1, 3), broken: coin(r) }),
    top: (p) => p.floors! * 4 + (p.broken ? 0 : 1.5),
    slots: () => [
      { x: 0, z: -3.3, dy: 0, hint: "At the door of the {label}." },
      { x: 4.2, z: 0, dy: 0.5, hint: "On the fallen stones by the {label}." },
      { x: 0, z: 3.3, dy: 0, hint: "Behind the {label}." },
    ],
  },

  // Four posts 0.25 m square at (±1.6, ±1.6), `stilts` tall. On them a cabin
  // 4 × 4 × 2.5 m, the label on its walls, and a roof 1 m high. A ladder on
  // the +Z face, x −0.4..0.4, z 1.6..2.0. A log stack 1.6 × 1 × 0.8 m
  // centred at (3.6, −1).
  lookout: {
    id: "lookout",
    name: "fire lookout",
    labels: ["green", "brown", "red"],
    padR: 8,
    roll: (r) => ({ stilts: round(between(r, 4, 8), 0.1) }),
    top: (p) => p.stilts! + 3.5,
    slots: () => [
      { x: 0, z: 0, dy: 0, hint: "Under the {label}, between its legs." },
      { x: 0, z: 2.7, dy: 0, hint: "At the foot of the ladder of the {label}." },
      { x: 3.6, z: 0.3, dy: 0, hint: "Beside the wood pile at the {label}." },
    ],
  },

  // A square hedge ring, its centre line at x, z = ±8, 0.8 m thick and
  // `hedge` tall, with 2 m gates in the middle of its −Z and +Z sides. A
  // fountain at the centre, the label on its stone: radius 2, rim 0.6 m,
  // a column to 1.6 m. Lantern posts, 0.1 m thick and with no collider, at
  // (±1.8, −9.6), either side of the −Z gate.
  garden: {
    id: "garden",
    name: "garden",
    labels: ["white", "sandy", "dark"],
    padR: 14,
    roll: (r) => ({ hedge: round(between(r, 1.2, 2), 0.1) }),
    top: () => 2,
    lamps: () => [
      { x: -1.8, y: 2.2, z: -9.6, clue: true },
      { x: 1.8, y: 2.2, z: -9.6, clue: false },
    ],
    slots: () => [
      { x: 0, z: 3, dy: 0, hint: "Behind the fountain in the {label}." },
      { x: 6.5, z: 6.5, dy: 0, hint: "In a corner of the {label}." },
      { x: 0, z: -9.5, dy: 0, hint: "Outside the gate of the {label}." },
    ],
  },

  // An open-fronted horseshoe of rock blocks, the label on the rock. Step k
  // (k = 0..terraces − 1) is a block x −8..8, z (2 + 2k)..(4 + 2k), 2k + 1
  // high. Side walls at x −10..−8 and 8..10, z 0..(2 + 2 · terraces),
  // 2 · terraces − 1 high. A cart, 1.4 × 2.4 m along Z, at (4, −3), tools
  // leaning on its −X side.
  quarry: {
    id: "quarry",
    name: "quarry",
    labels: ["grey", "sandy", "red"],
    padR: 16,
    roll: (r) => ({ terraces: int(r, 2, 3) }),
    top: (p) => 2 * p.terraces! - 1,
    slots: () => [
      { x: -4, z: 3, dy: 1, hint: "On the lowest step of the {label}." },
      { x: 5.8, z: -3, dy: 0, hint: "Beside the cart in the {label}." },
      { x: 0, z: -8, dy: 0, hint: "At the mouth of the {label}." },
    ],
  },

  // A rock mound x −7..7, z −2..10, 6 m high, the label on the rock. A
  // tunnel 2.5 m wide and 2.5 m high runs in from z = −2 along +Z for
  // 3 · chambers m. The mound is boxes round the hollow: left and right
  // walls, a roof slab and a back wall. A rock 1 × 0.5 × 1 m at (−5.5, −4).
  cave: {
    id: "cave",
    name: "cave",
    labels: ["grey", "dark", "sandy"],
    padR: 12,
    roll: (r) => ({ chambers: int(r, 1, 3) }),
    top: () => 6,
    slots: (p) => [
      { x: 2.6, z: -3, dy: 0, hint: "At the mouth of the {label}." },
      { x: 0, z: 3 * p.chambers! - 3.5, dy: 0, hint: "Deep inside the {label}." },
      { x: -5.5, z: -4, dy: 0.5, hint: "On a rock by the {label}." },
    ],
  },

  // A pool of radius 3 at the centre: water, the label's colour, at 0.05 m,
  // in a ring of rocks from radius 3 to 3.6, 0.4 m high. Pools 2: a second
  // pool of radius 2 (rocks 2–2.6) at (6.8, 2.5). A boulder 1 m high on the
  // big ring at (0, 3.3). Steam over each pool: 0, 12 or 24 puffs. A flat
  // rock 1.2 × 0.5 × 1.2 m at (−4.8, 2).
  "hot-spring": {
    id: "hot-spring",
    name: "hot spring",
    labels: ["blue", "green", "white"],
    padR: 10,
    roll: (r) => ({ steam: int(r, 0, 2), pools: int(r, 1, 2) }),
    top: () => 1,
    slots: (p) => {
      const out: Slot[] = [
        { x: 0, z: -4.2, dy: 0, hint: "Among the rocks at the edge of the {label}." },
        { x: -4.8, z: 2, dy: 0.5, hint: "On a flat rock by the {label}." },
      ];
      if (p.pools === 2) out.push({ x: 6.8, z: 5.7, dy: 0, hint: "Beside the small pool of the {label}." });
      return out;
    },
  },

  // Ice of radius 12, the label's colour, at 0.03 m: no collider, the pad is
  // the floor. Hole 1: a dark disc of radius 1.2 at (4, −3) and a fishing
  // stand at (5.6, −3). A canvas shelter 3 × 2.5 × 2.5 m at (−11, 6).
  "frozen-lake": {
    id: "frozen-lake",
    name: "frozen lake",
    labels: ["blue", "white", "grey"],
    padR: 18,
    roll: (r) => ({ hole: coin(r) }),
    top: () => 2.5,
    slots: (p) => [
      p.hole
        ? { x: 4, z: -1.4, dy: 0, hint: "By the hole in the ice of the {label}." }
        : { x: 0, z: 0, dy: 0, hint: "In the middle of the {label}." },
      { x: -8.6, z: 6, dy: 0, hint: "Beside the shelter at the {label}." },
      { x: 0, z: 13.5, dy: 0, hint: "On the far shore of the {label}." },
    ],
  },

  // Engine 0: a trebuchet 4 × 6 m (x × z), 8 m high, at (0, −6). Engine 1: a
  // catapult 3 × 4 m at (−7, 3). Engine 2: a ballista 2.5 × 3 m at (7, 3).
  // The first `broken` engines are wrecks, under 1 m high. Banner poles 3 m
  // high at (±3, 8), the label on the banners.
  "siege-camp": {
    id: "siege-camp",
    name: "siege camp",
    labels: ["red", "blue", "yellow"],
    padR: 16,
    roll: (r) => {
      const engines = int(r, 2, 3);
      return { engines, broken: int(r, 0, engines) };
    },
    // The trebuchet is the first to break; then the banner poles are the top.
    top: (p) => (p.broken! === 0 ? 8 : 3),
    slots: () => [
      { x: 3, z: -6, dy: 0, hint: "Beside the big siege engine at the {label}." },
      { x: -7, z: 6, dy: 0, hint: "Behind the catapult at the {label}." },
      { x: 0, z: 8, dy: 0, hint: "Between the banners at the {label}." },
    ],
  },
};

/** "red lighthouse". */
export function pieceLabel(p: SetPiece): string {
  const t = TEMPLATES[p.template];
  return `${t.labels[p.variant]} ${t.name}`;
}

/** A slot in world space. Godot's yaw turns +X towards −Z. Minor points use it too. */
export function worldSlot(p: Pick<SetPiece, "x" | "z" | "yaw">, s: Slot): { x: number; z: number; dy: number } {
  const c = Math.cos(p.yaw);
  const n = Math.sin(p.yaw);
  return { x: p.x + s.x * c + s.z * n, z: p.z - s.x * n + s.z * c, dy: s.dy };
}

/** A lamp in world space. Turns like `worldSlot`; y is the pad plus the lamp's own. */
export function worldLamp(p: Pick<SetPiece, "x" | "z" | "yaw" | "padY">, l: Lamp): { x: number; y: number; z: number } {
  const c = Math.cos(p.yaw);
  const n = Math.sin(p.yaw);
  return { x: p.x + l.x * c + l.z * n, y: p.padY + l.y, z: p.z - l.x * n + l.z * c };
}
