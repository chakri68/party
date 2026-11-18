// Small helpers the event scenes share: time, easing, outcome checks, and a
// few drawn bits (puffs, drops, a turned sprite, a particle field).
import type { EventOutcome } from "../../../shared/events.ts";
import { SITUATION_LOOP_MS } from "../director.ts";
import type { Stagehand } from "./index.ts";

type C = CanvasRenderingContext2D;

/** One situation loop. Other beats are timed by their own length, `h.ms`. */
export const LOOP_MS = SITUATION_LOOP_MS;
const msOf = (h: Stagehand) => (h.loop || !Number.isFinite(h.ms) ? LOOP_MS : h.ms);

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
/** 0 before `a`, 1 after `b`, eased between. */
export const ramp = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));
/** Up from `a` to `b`, held, down from `c` to `d`. */
export const env = (t: number, a: number, b: number, c: number, d: number) => Math.min(ramp(t, a, b), 1 - ramp(t, c, d));
/** Turns -0 into 0, so a pose at rest compares equal to {}. */
export const px = (x: number) => x + 0;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** A wave that runs `n` whole times through the beat, so a loop meets itself. */
export const cyc = (t: number, n = 1) => Math.sin(t * n * Math.PI * 2);

/** A step counter that changes at most `perSec` times a second. In a loop it wraps, so t = 0 and t = 1 match. */
export function ticks(h: Stagehand, perSec = 3): number {
  const n = Math.max(1, Math.floor((msOf(h) * perSec) / 1000));
  const k = Math.floor(clamp01(h.t) * n);
  return h.loop ? k % n : Math.min(k, n - 1);
}

/** A walk frame for the sprites (four steps per unit), from seconds into the beat. */
export function walkFrame(h: Stagehand, stepsPerSec = 1.5): number {
  if (h.loop) return clamp01(h.t) * Math.max(1, Math.round((LOOP_MS / 1000) * stepsPerSec)); // whole cycles
  return ((clamp01(h.t) * msOf(h)) / 1000) * stepsPerSec;
}

/** A fixed random number 0..1. */
export function rnd(i: number, k = 0): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
export const wrap = (x: number, m: number) => ((x % m) + m) % m;

// What the outcome shows. A null outcome is the mildest version: nothing lost.
export const lostCargo = (o: EventOutcome | null) => !!o && (o.cargo < 0 || (o.stock.coins ?? 0) < 0);
export const lostAnimal = (o: EventOutcome | null) => !!o && (o.stock.animals ?? 0) < 0;
export const burnt = (o: EventOutcome | null) => !!o && (o.cargo < 0 || (o.stock.food ?? 0) < 0);
export const gained = (o: EventOutcome | null) => !!o && Object.values(o.stock).some((d) => (d ?? 0) > 0);
export const gave = (o: EventOutcome | null) => !!o && Object.values(o.stock).some((d) => (d ?? 0) < 0);

/** The hurt traveller, never in a loop: a situation shows only the setup. */
export const hurt = (h: Stagehand) => (h.loop ? null : h.target);
/** Clamp an x into the band, `pad` px from each side. */
export const inBand = (h: Stagehand, x: number, pad: number) => Math.max(pad, Math.min(h.v.w - pad, x));

export function ell(c: C, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, Math.PI * 2);
  c.fill();
}

export function poly(c: C, pts: [number, number][], fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
  c.closePath();
  c.fill();
}

export function line(c: C, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

/** A soft round cloud of dust or smoke, `a` its opacity. */
export function puff(c: C, x: number, y: number, r: number, color: string, a: number): void {
  if (a <= 0 || r <= 0) return;
  c.save();
  c.globalAlpha *= clamp01(a);
  ell(c, x, y, r, r * 0.75, color);
  ell(c, x - r * 0.6, y + r * 0.2, r * 0.7, r * 0.5, color);
  ell(c, x + r * 0.6, y + r * 0.15, r * 0.75, r * 0.55, color);
  c.restore();
}

/** A bundle or a bag: a round sack with a tie on top. */
export function sack(c: C, x: number, y: number, r: number, fill: string): void {
  ell(c, x, y - r * 0.8, r, r * 0.85, fill);
  ell(c, x, y - r * 1.7, r * 0.35, r * 0.25, "rgba(0,0,0,0.25)");
}

/** Draws a right-facing sprite turned to face left about `x`. */
export function turned(c: C, x: number, facing: 1 | -1, draw: (x: number) => void): void {
  if (facing === 1) return draw(x);
  c.save();
  c.translate(x, 0);
  c.scale(-1, 1);
  draw(0);
  c.restore();
}

/**
 * A field of `n` bits blowing right to left across the band. In a loop each bit
 * crosses a whole number of times, so the field meets itself at t = 1.
 */
export function blow(
  h: Stagehand,
  o: { n: number; seed: number; laps: number; top: number; bottom: number; color: string; a: number; kind: "streak" | "flake" },
): void {
  const { c, v } = h;
  if (o.a <= 0) return;
  const span = v.w + 40 * v.s;
  c.save();
  c.globalAlpha *= clamp01(o.a);
  c.fillStyle = o.color;
  for (let i = 0; i < o.n; i++) {
    const speed = o.laps + Math.floor(rnd(i, o.seed) * 2); // whole laps
    const x = span - wrap(rnd(i, o.seed + 1) * span + h.t * speed * span, span) - 20 * v.s;
    const drift = o.kind === "flake" ? cyc(h.t + rnd(i, o.seed + 3), 2) * 3 * v.s : 0;
    const y = o.top + rnd(i, o.seed + 2) * (o.bottom - o.top) + drift;
    if (o.kind === "streak") c.fillRect(x, y, (10 + rnd(i, o.seed + 4) * 18) * v.s, 1.3 * v.s);
    else {
      c.beginPath();
      c.arc(x, y, (0.8 + rnd(i, o.seed + 4) * 0.9) * v.s, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}
