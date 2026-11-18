// Storm: sand blows across the frame (snow in the mountains), the caravan
// crouches, then it clears. A situation shows the wind still blowing.
import { blow, cyc, env } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const strength = (h: Stagehand) => (h.loop ? 0.85 + 0.15 * cyc(h.t, 2) : env(h.t, 0.03, 0.2, 0.72, 0.95));

export const storm: EventScene = {
  still: 0.5,
  pose: (h) => ({ crouch: h.loop || (h.t > 0.15 && h.t < 0.8) }),
  back(h) {
    const snow = h.terrain === "mountain";
    blow(h, { n: 24, seed: 61, laps: 2, top: 0, bottom: h.v.ground, color: snow ? "#ffffff" : "#f1d8a8", a: strength(h) * 0.6, kind: snow ? "flake" : "streak" });
  },
  front(h) {
    const { c, v } = h;
    const snow = h.terrain === "mountain";
    const a = strength(h);
    if (a <= 0) return;
    c.save();
    c.globalAlpha *= a * (snow ? 0.4 : 0.5);
    c.fillStyle = snow ? "#eef2f5" : "#dcb57e";
    c.fillRect(0, 0, v.w, v.h);
    c.restore();
    blow(h, { n: 60, seed: 67, laps: 3, top: v.ground * 0.2, bottom: v.h, color: snow ? "#ffffff" : "#a87a45", a, kind: snow ? "flake" : "streak" });
  },
};
