// Calm: a clear sky, birds go over, the camels trot a little.
import { cyc, env, line, px, rnd, walkFrame, wrap } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

function birds(h: Stagehand): void {
  const { c, v } = h;
  const span = v.w + 60 * v.s;
  const flap = walkFrame(h, 1.2);
  for (let i = 0; i < 3; i++) {
    const x = wrap(rnd(i, 51) * span + h.t * (h.loop ? 1 : 0.6) * span, span) - 30 * v.s;
    const y = v.ground * (0.18 + rnd(i, 52) * 0.2) + cyc(h.t + i / 3) * 2 * v.s;
    const up = (cyc(flap + i / 4) * 2.5 + 1) * v.s;
    const w = 4 * v.s;
    line(c, x - w, y - up, x, y, 1.1 * v.s, "#5a4436");
    line(c, x, y, x + w, y - up, 1.1 * v.s, "#5a4436");
  }
}

export const calm: EventScene = {
  still: 0.5,
  pose: (h) => ({
    dx: px(h.loop ? 3 * h.v.s * (1 - Math.cos(h.t * Math.PI * 2)) / 2 : 6 * h.v.s * env(h.t, 0.1, 0.45, 0.6, 0.95)),
  }),
  back: birds,
};
