// Camel trouble: the lead camel slips into mud (or off a ledge in the
// mountains). The others pull it out with a rope, or, if the outcome lost an
// animal, it is gone. A situation shows the camel stuck.
import { drawCamel } from "../sprites.ts";
import { cyc, ell, inBand, line, lostAnimal, px, ramp } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const PULL: [number, number] = [0.25, 0.7];
const hasCamel = (h: Stagehand) => (h.camels ?? 1) > 0;
const where = (h: Stagehand) => inBand(h, h.caravan.x1 + 34 * h.v.s, 30 * h.v.s);
const pulling = (h: Stagehand) => !h.loop && h.t > PULL[0] && h.t < PULL[1];

/** How deep the camel is (px at s = 1), its tilt, and how much of it shows. */
function state(h: Stagehand): { sink: number; tilt: number; a: number } {
  if (h.loop) return { sink: 8 + cyc(h.t, 2) * 1.5, tilt: 0.2, a: 1 };
  const down = ramp(h.t, 0.05, 0.25);
  if (lostAnimal(h.outcome)) {
    const gone = ramp(h.t, 0.7, 0.95);
    return { sink: 9 * down + 14 * gone, tilt: 0.22 * down + 0.2 * gone, a: 1 - gone };
  }
  const out = ramp(h.t, 0.6, 0.85);
  return { sink: 9 * down * (1 - out), tilt: 0.22 * down * (1 - out), a: 1 };
}

export const camelTrouble: EventScene = {
  still: 0.4,
  pose(h) {
    const p: { hideCamel?: number; crouch?: boolean; dx?: number } = {};
    if (hasCamel(h) && (h.loop || h.t < 1 || lostAnimal(h.outcome))) p.hideCamel = 0;
    if (pulling(h)) {
      p.crouch = true;
      p.dx = px(-3 * h.v.s * (1 - Math.cos(((h.t - PULL[0]) / (PULL[1] - PULL[0])) * Math.PI * 6)) / 2);
    }
    return p;
  },
  back(h) {
    const { c, v } = h;
    const s = v.s;
    const x = where(h);
    const mud = h.terrain === "mountain" ? "#5b4f48" : "#6b4f36";
    ell(c, x, v.ground, 26 * s, 4 * s, mud);
    if (!hasCamel(h)) return;
    const st = state(h);
    if (st.a > 0) {
      c.save();
      c.globalAlpha *= st.a;
      c.translate(x, v.ground + st.sink * s);
      c.rotate(-st.tilt);
      drawCamel(c, 0, 0, s, 0, "normal");
      c.restore();
    }
    // The lip of the mud, over the camel's legs.
    ell(c, x, v.ground + 4 * s, 28 * s, 5 * s, mud);
    if (pulling(h)) line(c, h.caravan.x1 + 4 * s, v.ground - 14 * s, x - 8 * s, v.ground - 26 * s + st.sink * s, 1.2 * s, "#7a5235");
  },
};
