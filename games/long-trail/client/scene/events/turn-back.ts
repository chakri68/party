// Turn back: the caravan stops, turns round, walks back a little, turns
// again and goes on. A situation shows it stopped, looking back and forth.
import { px, ramp } from "./fx.ts";
import type { EventScene } from "./index.ts";

export const turnBack: EventScene = {
  still: 0.35,
  pose(h) {
    const t = h.t;
    if (h.loop) return { facing: t >= 0.35 && t < 0.75 ? -1 : 1 };
    const back = 24 * h.v.s;
    const dx = t < 0.55 ? -back * ramp(t, 0.18, 0.5) : back * (ramp(t, 0.62, 0.98) - 1);
    return { facing: t >= 0.15 && t < 0.6 ? -1 : 1, dx: px(dx) };
  },
};
