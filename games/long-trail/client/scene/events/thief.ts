// Thief: night at the camp. A shadow slips past the tent and away, with a
// bundle only if the outcome lost something. A situation shows the shadow
// waiting by the tent. The fire changes shape three times a second at most.
import { drawFire, drawTent } from "../sprites.ts";
import { cyc, ell, gave, inBand, lerp, line, lostCargo, ramp, sack, ticks, walkFrame } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const SHADOW = "#1b1828";
const tentX = (h: Stagehand) => inBand(h, h.caravan.x1 + 52 * h.v.s, 26 * h.v.s);

/** A crouched dark figure creeping right. */
function shadow(h: Stagehand, x: number, y: number, frame: number, loot: boolean): void {
  const { c, v } = h;
  const s = v.s;
  const sw = Math.sin(frame * Math.PI * 2) * 2.5 * s;
  line(c, x - 1.5 * s, y - 7 * s, x - 1.5 * s - sw, y, 2.4 * s, SHADOW);
  line(c, x + 1.5 * s, y - 7 * s, x + 1.5 * s + sw, y, 2.4 * s, SHADOW);
  ell(c, x + 1 * s, y - 12 * s, 6 * s, 5 * s, SHADOW, 0.5);
  ell(c, x + 6 * s, y - 17 * s, 3.4 * s, 3.4 * s, SHADOW);
  if (loot) sack(c, x - 3 * s, y - 13 * s, 4 * s, "#2c2638");
}

export const thief: EventScene = {
  still: 0.55,
  pose: () => ({ night: true }),
  back(h) {
    const { c, v } = h;
    const s = v.s;
    const tx = tentX(h);
    const y = v.ground - 7 * s;
    if (h.loop) shadow(h, tx + 15 * s + cyc(h.t) * 4 * s, y, 0, false);
    drawTent(c, tx, y, s);
    drawFire(c, h.caravan.x1 + 26 * s, v.ground - 1 * s, s * 0.9, ticks(h) / 4);
    if (h.loop) return;
    const x = lerp(-20 * s, v.w + 20 * s, ramp(h.t, 0.1, 0.9));
    const loot = (lostCargo(h.outcome) || gave(h.outcome)) && x > tx;
    shadow(h, x, y, walkFrame(h, 1.2), loot);
  },
};
