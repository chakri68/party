// Photo clues (§6.2): a camera about PHOTO_DIST from the cache, on the far
// side from a landmark, so the cache sits between the lens and the piece.
// The client renders the picture from this pose once the world is built.

import { macroHeight } from "../shared/generate.ts";
import { PHOTO_DIST, PHOTO_EYE, PHOTO_FILL, PHOTO_FOV_MAX, PHOTO_FOV_MIN, PHOTO_MAX, PHOTO_MIN_TOP, darkWithin } from "../shared/sky.ts";
import { TEMPLATES } from "../shared/templates.ts";
import type { PhotoCam, SetPiece, TreasureLayout } from "../shared/types.ts";
import { CACHE_BOUND, CACHE_MIN_HEIGHT, type CacheSpot } from "./caches.ts";
import type { HuntSky } from "./hunt.ts";

/** The sight line is checked this often, in metres. */
export const PHOTO_SAMPLE = 16;
/** It may dip this far under the macro surface: the mesh's detail and bushes, not a ridge. */
export const PHOTO_DIP = 2;

const r1 = (v: number) => Math.round(v * 10) / 10 + 0;
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** A template "is lit" when it has lamps for these params. A ruined lighthouse has none. */
const lit = (p: SetPiece) => (TEMPLATES[p.template].lamps?.(p.params).length ?? 0) > 0;

/**
 * The camera for a photo of this spot, or null. Faces the nearest piece within
 * PHOTO_MAX that isn't the one the spot sits at (a shadow tip's own piece is
 * 10–100 m off, so that one counts, as for bearings), and stands at least
 * PHOTO_MIN_TOP tall. In a round that gets
 * dark at any point, only a lit piece counts: a photo can render late (a Race
 * clue opens mid-round, a page reloads), and an unlit piece after dark is a
 * black picture. The lens is zoomed so the piece's top fills about
 * PHOTO_FILL of the frame's height. Null when the camera would
 * stand in the sea, out of bounds, on a pad, or behind a ridge.
 */
export function photoCam(l: TreasureLayout, s: Pick<CacheSpot, "x" | "z" | "source" | "shadowMin">, sky: HuntSky): PhotoCam | null {
  const night = darkWithin(sky.startMin, sky.minutes);
  let t: SetPiece | null = null;
  let best = PHOTO_MAX;
  for (const p of l.pieces) {
    if (s.shadowMin === undefined && p.id === s.source) continue;
    if (night && !lit(p)) continue;
    if (TEMPLATES[p.template].top(p.params) < PHOTO_MIN_TOP) continue;
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d > 0 && d <= best) {
      t = p;
      best = d;
    }
  }
  if (!t) return null;

  const x = r1(s.x + ((s.x - t.x) / best) * PHOTO_DIST);
  const z = r1(s.z + ((s.z - t.z) / best) * PHOTO_DIST);
  if (Math.abs(x) > CACHE_BOUND || Math.abs(z) > CACHE_BOUND) return null;
  const ground = macroHeight(l, x, z);
  if (ground < CACHE_MIN_HEIGHT) return null;
  if (l.pieces.some((p) => Math.hypot(x - p.x, z - p.z) <= p.padR)) return null;

  const eye = ground + PHOTO_EYE;
  const top = TEMPLATES[t.template].top(t.params);
  const aim = t.padY + top / 2;
  const dx = t.x - x;
  const dz = t.z - z;
  const len = Math.hypot(dx, dz);
  for (let d = PHOTO_SAMPLE; d < len; d += PHOTO_SAMPLE) {
    const f = d / len;
    if (eye + (aim - eye) * f < macroHeight(l, x + dx * f, z + dz * f) - PHOTO_DIP) return null;
  }
  // Vertical fov, as Godot's Camera3D (keep height) takes it: `top` spans PHOTO_FILL of the frame.
  const fov = Math.min(PHOTO_FOV_MAX, Math.max(PHOTO_FOV_MIN, (2 * Math.atan(top / PHOTO_FILL / 2 / len) * 180) / Math.PI));
  // Godot: forward is (−sin yaw, −cos yaw).
  return { x, z, yaw: r2(Math.atan2(-dx, -dz)), pitch: r2(Math.atan2(aim - eye, len)), fov: r1(fov), target: t.id };
}
