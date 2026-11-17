// Sick: a blanket and a small fire by the hurt traveller, and the others
// crouch round. With no one named, it plays by the middle of the caravan.
import { drawFire } from "../sprites.ts";
import { ell, ramp, targetX, ticks } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const shown = (h: Stagehand) => (h.loop ? 1 : ramp(h.t, 0.08, 0.25));

export const sick: EventScene = {
  still: 0.6,
  pose: (h) => ({ crouch: h.loop || (h.t > 0.2 && h.t < 0.85) }),
  back(h) {
    const { c, v } = h;
    const s = v.s;
    const a = shown(h);
    if (a <= 0) return;
    const x = targetX(h);
    c.save();
    c.globalAlpha *= a;
    ell(c, x, v.ground + 1 * s, 13 * s, 2.6 * s, "#a8432f");
    c.fillStyle = "#e2b04a";
    c.fillRect(x - 13 * s, v.ground + 0.5 * s, 26 * s, 0.9 * s);
    drawFire(c, x + 20 * s, v.ground - 3 * s, s * 0.8, ticks(h) / 4);
    c.restore();
  },
  front(h) {
    const { c, v } = h;
    const a = shown(h);
    if (a <= 0) return;
    // A bowl of water at their feet.
    const x = targetX(h) - 9 * v.s;
    c.save();
    c.globalAlpha *= a;
    ell(c, x, v.ground + 5 * v.s, 3.4 * v.s, 1.6 * v.s, "#7a5235");
    ell(c, x, v.ground + 4.4 * v.s, 2.6 * v.s, 0.8 * v.s, "#86c9da");
    c.restore();
  },
};
