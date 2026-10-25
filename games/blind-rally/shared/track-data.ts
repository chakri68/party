// The track metadata contract (spec §5, §6; map §3.5): what data/tracks.json
// holds and what the server and the Navigator read from it.
//
// NOT exported from shared/index.ts, which is bundled eagerly for everyone,
// Drivers included. Only server/geometry.ts and client/navigator/ import this
// file or the JSON; test/projection.test.ts checks the eager bundle stays clean.
//
// Coordinates are Godot world space, metres: x right, y up, z towards the
// viewer (north is -z). Distances are metres along the route from the spawn,
// the same scale the trip meter counts in, so a pace note at 370 m is about
// 370 m of clean driving from the line.

export type Vec3 = [number, number, number];

export type Difficulty = "easy" | "medium" | "hard";

export interface TrackCheckpoint {
  /** 1..n, in driving order. */
  id: number;
  position: Vec3;
  /** Horizontal metres from `position` that count as "at the gate". */
  radius: number;
  distance: number;
}

export interface TrackAnchor {
  /** A reset after this many checkpoints lands here. 0 is the start. */
  afterCheckpoint: number;
  position: Vec3;
  /** Yaw in radians, 0 facing -z, as Godot's rotation.y. */
  heading: number;
}

export interface PaceNote {
  distance: number;
  text: string;
}

export interface Landmark {
  id: string;
  label: string;
  position: Vec3;
  distance: number;
}

export interface TrackData {
  id: string;
  revision: number;
  name: string;
  difficulty: Difficulty;
  /** Route length estimate, spawn to finish. */
  length: number;
  /** Null until playtests calibrate it (spec §6). */
  par_seconds: number | null;
  /** World XZ rectangle the course lives in: x..x+width, z..z+depth. */
  bounds: { x: number; z: number; width: number; depth: number };
  spawn: { position: Vec3; heading: number };
  checkpoints: TrackCheckpoint[];
  finish: { position: Vec3; radius: number; distance: number };
  recovery: TrackAnchor[];
  paceNotes: PaceNote[];
  landmarks: Landmark[];
}

export interface TrackFile {
  version: 1;
  tracks: TrackData[];
}

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function insideBounds(t: Pick<TrackData, "bounds">, p: Vec3, margin = 0): boolean {
  const b = t.bounds;
  return p[0] >= b.x - margin && p[0] <= b.x + b.width + margin && p[2] >= b.z - margin && p[2] <= b.z + b.depth + margin;
}

/** Horizontal distance: the gates are tall, and y is whatever the terrain says. */
export const flatDistance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Where a reset lands after `passed` checkpoints: the last anchor at or before it (track.gd's recovery_for). */
export function recoveryFor(t: TrackData, passed: number): { position: Vec3; heading: number } {
  let best: TrackAnchor | null = null;
  for (const a of t.recovery) if (a.afterCheckpoint <= passed && (!best || a.afterCheckpoint >= best.afterCheckpoint)) best = a;
  return best ?? t.spawn;
}

/**
 * Every problem with one track, in words; empty when it's fine. Checks shape
 * as well as the rules, since the file will come from an exporter (step 9's
 * Godot half) and nobody reads 2,000 lines of JSON by eye.
 */
export function trackProblems(input: unknown): string[] {
  const t = obj(input);
  if (!t) return ["not an object"];
  const id = text(t.id) ? t.id : "?";
  const out: string[] = [];
  const bad = (what: string) => out.push(`${id}: ${what}`);

  if (!text(t.id)) bad("id missing");
  if (!Number.isInteger(t.revision) || (t.revision as number) < 1) bad("revision must be a positive integer");
  if (!text(t.name)) bad("name missing");
  if (!DIFFICULTIES.includes(t.difficulty as Difficulty)) bad(`difficulty must be one of ${DIFFICULTIES.join(", ")}`);
  if (!finite(t.length) || t.length <= 0) bad("length must be > 0");
  if (t.par_seconds !== null && !(finite(t.par_seconds) && t.par_seconds > 0)) bad("par_seconds must be null or > 0");

  const b = obj(t.bounds);
  const boundsOk = !!b && finite(b.x) && finite(b.z) && finite(b.width) && finite(b.depth) && b.width > 0 && b.depth > 0;
  if (!boundsOk) bad("bounds must be {x, z, width > 0, depth > 0}");
  const inside = (p: unknown, what: string) => {
    if (!isVec3(p)) return bad(`${what}: position must be [x, y, z]`);
    if (boundsOk && !insideBounds(t as unknown as TrackData, p)) bad(`${what} is outside the bounds`);
  };
  const along = (d: unknown, what: string) => {
    if (!finite(d) || d < 0 || (finite(t.length) && d > t.length)) bad(`${what}: distance must be within 0..length`);
  };

  const spawn = obj(t.spawn);
  if (!spawn) bad("spawn missing");
  else {
    inside(spawn.position, "spawn");
    if (!finite(spawn.heading)) bad("spawn: heading missing");
  }

  const cps = Array.isArray(t.checkpoints) ? t.checkpoints : null;
  if (!cps || !cps.length) bad("needs at least one checkpoint");
  let lastDistance = -1;
  for (const [i, raw] of (cps ?? []).entries()) {
    const cp = obj(raw);
    const what = `checkpoint ${i + 1}`;
    if (!cp) {
      bad(`${what} is not an object`);
      continue;
    }
    if (cp.id !== i + 1) bad(`${what}: ids must run 1..n in order (got ${String(cp.id)})`);
    inside(cp.position, what);
    if (!finite(cp.radius) || cp.radius <= 0) bad(`${what}: radius must be > 0`);
    along(cp.distance, what);
    if (finite(cp.distance)) {
      if (cp.distance <= lastDistance) bad(`${what}: distance must be past the one before`);
      lastDistance = cp.distance;
    }
  }

  const fin = obj(t.finish);
  if (!fin) bad("finish missing");
  else {
    inside(fin.position, "finish");
    if (!finite(fin.radius) || fin.radius <= 0) bad("finish: radius must be > 0");
    along(fin.distance, "finish");
    if (finite(fin.distance) && fin.distance <= lastDistance) bad("finish must come after the last checkpoint");
  }

  const rec = Array.isArray(t.recovery) ? t.recovery : null;
  if (!rec) bad("recovery missing");
  const seen = new Set<number>();
  for (const [i, raw] of (rec ?? []).entries()) {
    const a = obj(raw);
    const what = `recovery anchor ${i}`;
    if (!a) {
      bad(`${what} is not an object`);
      continue;
    }
    const n = a.afterCheckpoint;
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > (cps?.length ?? 0)) bad(`${what}: afterCheckpoint must be 0..${cps?.length ?? 0}`);
    else if (seen.has(n as number)) bad(`${what}: two anchors after checkpoint ${String(n)}`);
    else seen.add(n as number);
    inside(a.position, what);
    if (!finite(a.heading)) bad(`${what}: heading missing`);
  }
  if (rec && !seen.has(0)) bad("needs a recovery anchor at the start (afterCheckpoint 0)");

  const notes = Array.isArray(t.paceNotes) ? t.paceNotes : null;
  if (!notes) bad("paceNotes missing");
  let lastNote = -Infinity;
  for (const [i, raw] of (notes ?? []).entries()) {
    const n = obj(raw);
    if (!n || !text(n.text)) {
      bad(`pace note ${i}: needs text`);
      continue;
    }
    along(n.distance, `pace note ${i}`);
    if (finite(n.distance)) {
      if (n.distance < lastNote) bad(`pace note ${i}: notes must be sorted by distance`);
      lastNote = n.distance;
    }
  }

  const marks = Array.isArray(t.landmarks) ? t.landmarks : null;
  if (!marks) bad("landmarks missing");
  const markIds = new Set<string>();
  for (const [i, raw] of (marks ?? []).entries()) {
    const m = obj(raw);
    if (!m || !text(m.id) || !text(m.label)) {
      bad(`landmark ${i}: needs id and label`);
      continue;
    }
    if (markIds.has(m.id)) bad(`landmark ${m.id}: duplicate id`);
    markIds.add(m.id);
    inside(m.position, `landmark ${m.id}`);
    along(m.distance, `landmark ${m.id}`);
  }
  return out;
}

/** Problems across the whole file: each track's, plus duplicate ids. */
export function trackFileProblems(input: unknown): string[] {
  const f = obj(input);
  if (!f || f.version !== 1 || !Array.isArray(f.tracks)) return ["expected {version: 1, tracks: [...]}"];
  const out = f.tracks.flatMap(trackProblems);
  const ids = f.tracks.map((t) => obj(t)?.id);
  for (const [i, id] of ids.entries()) if (ids.indexOf(id) !== i) out.push(`${String(id)}: duplicate track id`);
  return out;
}

/** The file, checked. Throws with every problem listed, so a bad export fails loudly at load. */
export function parseTrackFile(input: unknown): TrackData[] {
  const problems = trackFileProblems(input);
  if (problems.length) throw new Error(`blind-rally: bad track data:\n  ${problems.join("\n  ")}`);
  return (input as TrackFile).tracks;
}
