// Our own sprites, drawn in code: flat shapes, no outlines. Each one is drawn
// in its own units with (0, 0) at the feet on the ground line, then scaled by
// `s` (1 = a band 150 px tall). They face right; the rider can turn round.
import type { Health } from "../../shared/types.ts";

type C = CanvasRenderingContext2D;
type Pt = [number, number];

const SKIN = "#a86f48";
const WRAP = "#efe2c4";
const SHADE = "rgba(0,0,0,0.2)";
const CAMEL = "#c99a5e";
const CAMEL_FAR = "#ab7f4b";
const WOOD = "#7a5235";
const TRAVELLER = 1.15; // travellers a little larger than life, so players find themselves

/** Where a rider sits on a camel, from the camel's feet, at s = 1. */
export const CAMEL_SEAT = { x: -2, y: -33 } as const;

function ell(c: C, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
}

function poly(c: C, pts: Pt[], fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
  c.closePath();
  c.fill();
}

function box(c: C, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}

/** A limb or a pole: a thick line with round ends. */
function limb(c: C, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

/** One of four walk steps from a phase 0..1. */
function step(frame: number): number {
  return Math.floor((((frame % 1) + 1) % 1) * 4) % 4;
}
const SWING = [-1, 0, 1, 0] as const;

function begin(c: C, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
}

export function drawCamel(c: C, x: number, y: number, s: number, frame: number, load: "normal" | "high" | "none"): void {
  begin(c, x, y, s);
  const st = step(frame);
  const sw = SWING[st]! * 3;
  const bob = st % 2 ? -0.8 : 0;
  // Far legs, then body, then near legs.
  limb(c, -9, -20 + bob, -9 - sw, -1.5, 3, CAMEL_FAR);
  limb(c, 12, -20 + bob, 12 - sw, -1.5, 3, CAMEL_FAR);
  c.translate(0, bob);
  limb(c, -15, -27, -17.5, -19, 1.6, CAMEL_FAR); // tail
  ell(c, 0, -25, 16, 8, CAMEL);
  ell(c, -2, -30, 9.5, 8.5, CAMEL);
  c.fillStyle = CAMEL;
  c.beginPath();
  c.moveTo(10, -31);
  c.quadraticCurveTo(17, -31, 20, -39);
  c.lineTo(25, -38);
  c.quadraticCurveTo(22, -26, 15, -21);
  c.closePath();
  c.fill();
  ell(c, 24.5, -40, 5.5, 3.4, CAMEL, 0.15);
  ell(c, 29, -38.8, 1.8, 1.6, CAMEL_FAR); // muzzle
  poly(c, [[20.5, -43], [21.5, -46], [23, -42.5]], CAMEL_FAR); // ear
  ell(c, 25.5, -41, 0.9, 0.9, "#3a2a20"); // eye
  c.translate(0, -bob);
  limb(c, -5, -20 + bob, -5 + sw, -1.5, 3.2, CAMEL);
  limb(c, 9, -20 + bob, 9 + sw, -1.5, 3.2, CAMEL);
  c.translate(0, bob);
  // The pack: a blanket always, bags and bundles when loaded.
  poly(c, [[-11, -34], [6, -34], [8, -24], [-13, -24]], "#a8432f");
  box(c, -12, -26, 21, 1.6, "#e2b04a");
  if (load !== "none") {
    ell(c, -10, -24, 4.5, 5, "#7a5a3a");
    ell(c, 6, -24, 4, 4.6, "#6b4e33");
    ell(c, -2, -39, 7, 3.2, "#e6d3a6");
    box(c, -3, -42, 1.6, 6, SHADE);
  }
  if (load === "high") {
    const pile: [number, number, number, string][] = [
      [-1, -45, 8, "#8c6a44"],
      [-3, -51, 6.5, "#d9c08c"],
      [0, -56.5, 5.5, "#b3523a"],
      [-2, -61, 4, "#e6d3a6"],
    ];
    for (const [px, py, r, col] of pile) ell(c, px, py, r, r * 0.55, col);
    box(c, -1.8, -63, 1.4, 21, SHADE); // the rope
  }
  c.restore();
}

export function drawTraveller(
  c: C,
  x: number,
  y: number,
  s: number,
  frame: number,
  w: { color: string; health: Health; riding: boolean; alpha: number; down?: boolean },
): void {
  begin(c, x, y, s * TRAVELLER);
  c.globalAlpha *= Math.max(0, Math.min(1, w.alpha));
  if (w.down) {
    lying(c, w.color);
    c.restore();
    return;
  }
  const st = step(frame);
  if (w.riding) {
    // Seated on a camel's back: (x, y) is the seat.
    c.translate(0, st % 2 ? -0.5 : 0);
    limb(c, 1, -2, 4.5, 6, 2.6, w.color);
    limb(c, 4.5, 6, 5.5, 7, 2.2, "#3d2c22");
    poly(c, [[-5, 0], [4, 0], [4, -14], [-4, -14]], w.color);
    upper(c, w.color, -14, w.health < 3);
    c.restore();
    return;
  }
  const limp = w.health === 1;
  const lean = limp ? 0.2 : w.health === 2 ? 0.1 : 0;
  const bobBy = limp ? [0, -0.4, 1.2, -0.4] : w.health === 2 ? [0, -0.4, 0, -0.4] : [0, -1, 0, -1];
  const sw = SWING[st]! * (limp ? 1.2 : 2.2);
  c.rotate(lean);
  limb(c, -1.5, -6, -1.5 - sw, -0.8, 2.2, "#3d2c22");
  limb(c, 1.5, -6, 1.5 + sw, -0.8, 2.2, "#3d2c22");
  c.translate(0, bobBy[st]!);
  poly(c, [[-6, -4], [6, -4], [4, -16], [-4, -16]], w.color);
  if (limp) limb(c, 4.5, -12, 8, 0, 1.4, WOOD); // a walking stick
  upper(c, w.color, -16, w.health < 3);
  c.restore();
}

/** Lying on the ground, feet at (-11, 0), head to the right at (10, -3.5). Riding or walking does not matter. */
function lying(c: C, color: string): void {
  limb(c, -11, -1.4, -5, -1.4, 2.4, "#3d2c22"); // legs
  poly(c, [[-6, 0], [5, 0], [5, -6], [-6, -4.5]], color);
  ell(c, 5, -3, 2.6, 3.2, color); // shoulders
  box(c, -1, -5.6, 1.4, 5.6, SHADE); // sash
  ell(c, 10, -3.5, 3.6, 3.4, SKIN);
  c.fillStyle = WRAP;
  c.beginPath();
  c.ellipse(11, -3.5, 3.4, 3.8, 0, -Math.PI / 2, Math.PI / 2);
  c.fill();
}

/** Shoulders, arm, head and head wrap, with the top of the robe at `top`. */
function upper(c: C, color: string, top: number, droop: boolean): void {
  ell(c, 0, top, 4.2, 3, color);
  box(c, -4.6, top + 4, 9.2, 1.4, SHADE); // sash
  limb(c, 1, top, droop ? 3 : 4, top + 7, 2.4, color);
  limb(c, 1, top, droop ? 3 : 4, top + 7, 2.4, SHADE);
  ell(c, 0.5, top - 5.5, 3.6, 3.8, SKIN);
  c.fillStyle = WRAP;
  c.beginPath();
  c.ellipse(0, top - 6.5, 4.2, 3.6, 0, Math.PI, Math.PI * 2);
  c.fill();
  box(c, -4.2, top - 7, 8.4, 1.8, WRAP);
  poly(c, [[-4.2, top - 6], [-2, top - 6], [-5.5, top + 1], [-6.5, top]], WRAP);
}

export function drawTent(c: C, x: number, y: number, s: number): void {
  begin(c, x, y, s);
  const roof: Pt[] = [[-22, 0], [-18, -15], [-7, -21], [7, -21], [18, -15], [22, 0]];
  poly(c, roof, "#5a4436");
  for (const sx of [-14, -4, 6, 15]) box(c, sx, -20, 3, 20, "rgba(0,0,0,0.12)");
  poly(c, [[-6, 0], [0, -15], [6, 0]], "#2a1f1a");
  limb(c, -7, -21, -7, -24, 1.4, WOOD);
  limb(c, 7, -21, 7, -24, 1.4, WOOD);
  c.restore();
}

export function drawFire(c: C, x: number, y: number, s: number, frame: number): void {
  begin(c, x, y, s);
  ell(c, 0, -6, 15, 12, "rgba(255,170,60,0.16)");
  for (const sx of [-6, -2.5, 2.5, 6]) ell(c, sx, -0.8, 2.2, 1.6, "#7d7468");
  limb(c, -5, -1, 5, -3.5, 2.2, WOOD);
  limb(c, -5, -3.5, 5, -1, 2.2, "#5e3d27");
  // The flame changes shape, never brightness.
  const t = [0, 1.5, 0.5, 2][step(frame)]!;
  const lean = [0, 1, -0.5, 0.5][step(frame)]!;
  poly(c, [[-5, -3], [lean - 1, -14 - t], [5, -3]], "#e8742b");
  poly(c, [[-3, -3], [lean + 1, -10 - t * 0.6], [3.5, -3]], "#f7b23b");
  poly(c, [[-1.5, -3], [lean * 0.5, -6.5 - t * 0.3], [1.5, -3]], "#ffe28a");
  c.restore();
}

export function drawStall(c: C, x: number, y: number, s: number, hue: number): void {
  begin(c, x, y, s);
  limb(c, -13, 0, -13, -24, 1.8, WOOD);
  limb(c, 13, 0, 13, -24, 1.8, WOOD);
  box(c, -14, -11, 28, 11, "#8a5a3a");
  box(c, -14, -11, 28, 2, "#a8744c");
  const goods = ["#d9862c", "#c94d3a", "#e2c35a", "#7f9a3c"];
  goods.forEach((g, i) => ell(c, -9 + i * 6, -13, 2.6, 2.2, g));
  poly(c, [[-17, -22], [17, -22], [14, -28], [-14, -28]], `hsl(${hue}, 55%, 52%)`);
  for (let i = 0; i < 4; i++) box(c, -14 + i * 8, -28, 4, 6, `hsl(${hue}, 60%, 84%)`);
  for (let i = 0; i < 5; i++) ell(c, -14 + i * 7, -22, 3.5, 2, `hsl(${hue}, 55%, ${i % 2 ? 84 : 52}%)`);
  c.restore();
}

export function drawHouse(c: C, x: number, y: number, s: number): void {
  begin(c, x, y, s);
  box(c, -15, -24, 30, 24, "#d8b98a");
  box(c, 9, -24, 6, 24, "#c4a274");
  box(c, -16, -26, 32, 3, "#c9a979");
  box(c, -9, -36, 13, 10, "#d8b98a");
  c.fillStyle = "#e3c697";
  c.beginPath();
  c.arc(-2.5, -36, 6.5, Math.PI, Math.PI * 2);
  c.fill();
  box(c, -3, -13, 6, 13, "#6b4630");
  ell(c, 0, -13, 3, 3, "#6b4630");
  box(c, -11, -19, 4, 4, "#5a3e2c");
  box(c, 6, -19, 3, 4, "#5a3e2c");
  c.restore();
}

export function drawGate(c: C, x: number, y: number, s: number): void {
  begin(c, x, y, s);
  const wall = "#c9a476";
  const dark = "#b08c60";
  for (const tx of [-34, 18]) {
    box(c, tx, -56, 16, 56, wall);
    box(c, tx + 11, -56, 5, 56, dark);
    for (let i = 0; i < 3; i++) box(c, tx + i * 6, -61, 4, 5, wall);
  }
  box(c, -18, -44, 36, 44, wall);
  box(c, -20, -47, 40, 4, dark);
  box(c, -10, -22, 20, 22, "#3a2a20");
  ell(c, 0, -22, 10, 10, "#3a2a20");
  ell(c, 0, -40, 4, 4, "#a8432f");
  poly(c, [[-27, -50], [-21, -50], [-21, -36], [-24, -39], [-27, -36]], "#a8432f");
  poly(c, [[21, -50], [27, -50], [27, -36], [24, -39], [21, -36]], "#a8432f");
  c.restore();
}

export function drawRider(c: C, x: number, y: number, s: number, frame: number, facing: 1 | -1): void {
  begin(c, x, y, s);
  c.scale(facing, 1);
  const st = step(frame);
  const g = [[-4, 4], [-1, 1], [4, -4], [1, -1]][st]!;
  const bob = st % 2 ? -1.2 : 0;
  const horse = "#6a4630";
  const far = "#54371f";
  limb(c, -9, -18 + bob, -9 + g[1]!, -1, 2.6, far);
  limb(c, 9, -18 + bob, 9 + g[0]!, -1, 2.6, far);
  c.translate(0, bob);
  limb(c, -13, -24, -18, -14, 2.4, "#2e2018"); // tail
  ell(c, 0, -22, 14, 6.5, horse);
  poly(c, [[8, -26], [16, -40], [21, -38], [14, -19]], horse);
  ell(c, 20, -38, 6, 2.8, horse, 0.5);
  poly(c, [[8, -27], [15, -41], [12, -26]], "#2e2018"); // mane
  c.translate(0, -bob);
  limb(c, -6, -18 + bob, -6 + g[0]!, -1, 2.8, horse);
  limb(c, 11, -18 + bob, 11 + g[1]!, -1, 2.8, horse);
  c.translate(0, bob);
  // The rider: dark robe, a veil over the face.
  const robe = "#2f2a3a";
  poly(c, [[-5, -24], [5, -24], [3, -34], [-4, -34]], robe);
  limb(c, 2, -24, 5, -17, 2.4, robe);
  ell(c, 0, -34, 4, 2.8, robe);
  ell(c, 0.5, -39.5, 3.6, 3.8, SKIN);
  poly(c, [[-3.8, -40.5], [4.2, -40.5], [4.2, -36], [-3, -35.5]], "#1f1c26");
  c.fillStyle = "#1f1c26";
  c.beginPath();
  c.ellipse(0, -40.5, 4.2, 3.6, 0, Math.PI, Math.PI * 2);
  c.fill();
  poly(c, [[-4.2, -40], [-2, -40], [-7, -32], [-8, -33]], "#1f1c26");
  limb(c, 3, -30, 12, -35, 1.6, robe); // the arm on the reins
  c.restore();
}
