// Leak: a water bag on the rear camel drips a trail on the path. The
// traveller nearest the bag walks back, ties it, and walks back to their
// place; the drips stop. A situation shows it still dripping.
import { ell, lerp, line, ramp, wrap } from "./fx.ts";
import type { EventScene, Pose, Stagehand } from "./index.ts";

const GO: [number, number] = [0.28, 0.45]; // walk to the bag
const TIED = 0.62; // tying from GO[1] to here
const BACK: [number, number] = [0.66, 0.86]; // walk back

function bag(h: Stagehand): { x: number; y: number } {
  const rear = h.camelX?.length ? h.camelX[h.camelX.length - 1]! : h.caravan.x0;
  return { x: rear - 10 * h.v.s, y: h.v.ground - 22 * h.v.s };
}

/** The traveller on foot nearest the bag. */
function helper(h: Stagehand): { id: string; x: number } | null {
  const b = bag(h).x;
  let best: { id: string; x: number } | null = null;
  for (const w of h.walkers ?? []) if (!best || Math.abs(w.x - b) < Math.abs(best.x - b)) best = w;
  return best;
}

export const leak: EventScene = {
  still: 0.55,
  pose(h): Pose {
    const who = helper(h);
    if (h.loop || !who || h.t <= GO[0] || h.t >= BACK[1]) return {};
    const spot = bag(h).x + 6 * h.v.s;
    if (h.t < TIED) return { move: { id: who.id, x: lerp(who.x, spot, ramp(h.t, GO[0], GO[1])), facing: -1, crouch: h.t > GO[1] } };
    return { move: { id: who.id, x: lerp(spot, who.x, ramp(h.t, BACK[0], BACK[1])), facing: h.t < BACK[0] ? -1 : 1, crouch: false } };
  },
  back(h) {
    const { c, v } = h;
    const s = v.s;
    const b = bag(h);
    // The wet trail behind.
    for (let i = 0; i < 6; i++) ell(c, b.x - i * 8 * s, v.ground + (i % 2 ? 1 : -1) * s, (3 - i * 0.3) * s, 1 * s, "rgba(40,60,80,0.35)");
  },
  front(h) {
    const { c, v } = h;
    const s = v.s;
    const b = bag(h);
    if (h.loop || h.t < TIED) {
      for (let j = 0; j < 3; j++) {
        const p = wrap(h.t * (h.loop ? 4 : 6) + j / 3, 1);
        ell(c, b.x, b.y + p * (v.ground - b.y), 1.5 * s, 2.2 * s, "#3f8fb0");
      }
    }
    const tie = h.loop ? 0 : ramp(h.t, GO[1], TIED);
    if (tie > 0) line(c, b.x - 3.5 * s * tie, b.y - 3 * s, b.x + 3.5 * s * tie, b.y - 3 * s, 1.4 * s, "#e2b04a");
  },
};
