import type { ControlInput, DashRelay, GhostRelay, HitRelay } from "./types.ts";

// Stream payloads arrive untrusted on both ends. Each parser returns a clean
// copy or null; numbers come back finite and clamped, never NaN.

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Two decimals is plenty for a thumb, and keeps the relay short. */
const q = (v: number) => Math.round(v * 100) / 100;

/** Seqs are counters, not timestamps: a client that sends 2^53 has other problems. */
export const MAX_SEQ = 2 ** 31;

/**
 * Driver input. Out-of-range values are clamped rather than refused: a stuck
 * analog stick at 1.02 should still drive. A missing or non-numeric field is
 * a malformed packet and drops it.
 */
export function parseControl(input: unknown): ControlInput | null {
  const o = obj(input);
  if (!o || o.t !== "in") return null;
  if (!Number.isInteger(o.seq) || (o.seq as number) < 1 || (o.seq as number) > MAX_SEQ) return null;
  if (!finite(o.steer) || !finite(o.throttle) || !finite(o.brake)) return null;
  return {
    t: "in",
    seq: o.seq as number,
    steer: q(clamp(o.steer, -1, 1)),
    throttle: q(clamp(o.throttle, 0, 1)),
    brake: q(clamp(o.brake, 0, 1)),
  };
}

/** The Driver's dashboard. 100 m/s is 360 km/h, well past anything with wheels here. */
export function parseDash(input: unknown): DashRelay | null {
  const o = obj(input);
  if (!o || o.t !== "dash" || !finite(o.speed)) return null;
  return { t: "dash", speed: clamp(o.speed, -100, 100) };
}

export function parseHit(input: unknown): HitRelay | null {
  const o = obj(input);
  if (!o || o.t !== "hit" || !finite(o.strength)) return null;
  return { t: "hit", strength: clamp(o.strength, 0, 10) };
}

/** A shared-stage rival, on the Navigator's side. */
export function parseGhost(input: unknown): GhostRelay | null {
  const o = obj(input);
  if (!o || o.t !== "ghost" || !Number.isInteger(o.teamId) || typeof o.color !== "string") return null;
  const p = o.position;
  if (!Array.isArray(p) || p.length !== 3 || !p.every(finite) || !finite(o.heading) || !finite(o.speed)) return null;
  return {
    t: "ghost",
    teamId: o.teamId as number,
    color: o.color.slice(0, 16),
    tick: Number.isInteger(o.tick) ? (o.tick as number) : 0,
    position: [p[0] as number, p[1] as number, p[2] as number],
    heading: o.heading,
    speed: o.speed,
  };
}

/** Race clock as m:ss.t, the way rally timing boards show it. */
export function formatClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100));
  const m = Math.floor(t / 600);
  const s = Math.floor((t % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${t % 10}`;
}
