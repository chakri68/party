// Fire: flames and smoke in the grass ahead, then black ground. The packs show
// a burnt bundle only if the outcome lost cargo or food. A situation shows the
// fire burning. Flames change shape three times a second at most.
import { burnt, ell, env, inBand, poly, puff, px, ramp, rnd, sack, ticks, wrap } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const where = (h: Stagehand) => inBand(h, h.caravan.x1 + 48 * h.v.s, 34 * h.v.s);
const size = (h: Stagehand) => (h.loop ? 0.75 : env(h.t, 0.05, 0.3, 0.55, 0.8));
const smoke = (h: Stagehand) => (h.loop ? 1 : env(h.t, 0.1, 0.3, 0.7, 1));

function flames(h: Stagehand, x: number, y: number, k: number): void {
  const { c, v } = h;
  if (k <= 0) return;
  const tick = ticks(h);
  for (let i = 0; i < 5; i++) {
    const fx = x + (i - 2) * 9 * v.s;
    const tall = (12 + 8 * rnd(i, tick + 71)) * k * v.s * (i % 2 ? 0.8 : 1);
    const lean = (rnd(i, tick + 72) - 0.5) * 4 * v.s;
    const w = 5 * k * v.s;
    poly(c, [[fx - w, y], [fx + lean, y - tall], [fx + w, y]], "#e8742b");
    poly(c, [[fx - w * 0.6, y], [fx + lean * 0.7, y - tall * 0.65], [fx + w * 0.6, y]], "#f7b23b");
    poly(c, [[fx - w * 0.3, y], [fx + lean * 0.4, y - tall * 0.3], [fx + w * 0.3, y]], "#ffe28a");
  }
}

export const fire: EventScene = {
  still: 0.3,
  pose: (h) => ({ dx: px(h.loop ? 0 : -8 * h.v.s * env(h.t, 0.1, 0.25, 0.7, 0.95)) }),
  back(h) {
    const { c, v } = h;
    const x = where(h);
    const y = v.ground - 6 * v.s;
    const black = h.loop ? 0 : ramp(h.t, 0.2, 0.6);
    if (black > 0) ell(c, x, y + 1 * v.s, 28 * v.s * black, 4.5 * v.s * black, "#3b302a");
    flames(h, x, y, size(h));
    const sm = smoke(h);
    for (let j = 0; j < 5; j++) {
      const p = wrap(h.t * 2 + j / 5, 1);
      puff(c, x + (j - 2) * 6 * v.s + p * 18 * v.s, y - 14 * v.s - p * 46 * v.s, (4 + p * 6) * v.s, "#6f6a66", (1 - p) * 0.55 * sm);
    }
  },
  front(h) {
    if (h.loop || !burnt(h.outcome)) return;
    // A burnt bundle set down by the caravan, still smoking a little.
    const { c, v } = h;
    const a = ramp(h.t, 0.55, 0.7);
    if (a <= 0) return;
    const x = h.caravan.x0 + 6 * v.s;
    const y = v.ground + 8 * v.s;
    c.save();
    c.globalAlpha *= a;
    sack(c, x, y, 5 * v.s, "#2f2723");
    ell(c, x + 2 * v.s, y - 5 * v.s, 2 * v.s, 1.4 * v.s, "#5a4436");
    c.restore();
    puff(c, x + 3 * v.s, y - 14 * v.s - ramp(h.t, 0.6, 1) * 8 * v.s, 3 * v.s, "#8a8580", a * 0.5 * (1 - ramp(h.t, 0.8, 1)));
  },
};
