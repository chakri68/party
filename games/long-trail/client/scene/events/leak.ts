// Leak: a water bag on the rear camel drips a trail on the path. A traveller
// bends to tie it and the drips stop. A situation shows it still dripping.
import { ell, line, ramp, wrap } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const TIED = 0.62;
const bag = (h: Stagehand) => ({ x: h.caravan.x0 - 10 * h.v.s, y: h.v.ground - 22 * h.v.s });

export const leak: EventScene = {
  still: 0.3,
  pose: (h) => ({ crouch: !h.loop && h.t > 0.45 && h.t < TIED + 0.05 }),
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
    const tie = h.loop ? 0 : ramp(h.t, 0.5, TIED);
    if (tie > 0) line(c, b.x - 3.5 * s * tie, b.y - 3 * s, b.x + 3.5 * s * tie, b.y - 3 * s, 1.4 * s, "#e2b04a");
  },
};
