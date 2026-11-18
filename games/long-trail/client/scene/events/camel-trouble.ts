// Camel trouble: the lead camel slips into mud (or off a ledge in the
// mountains). The others pull it out with a rope, or, if the outcome lost an
// animal, it is gone. The camel walks out from its place in line to the spot,
// and back again when it is saved. A situation shows the camel stuck.
import { drawCamel } from "../sprites.ts";
import { cyc, ell, inBand, lerp, line, lostAnimal, px, ramp, walkFrame } from "./fx.ts";
import type { EventScene, Pose, Stagehand } from "./index.ts";

const PULL: [number, number] = [0.25, 0.7];
const hasCamel = (h: Stagehand) => (h.camels ?? 1) > 0;
const where = (h: Stagehand) => inBand(h, h.caravan.x1 + 34 * h.v.s, 30 * h.v.s);
const pulling = (h: Stagehand) => !h.loop && h.t > PULL[0] && h.t < PULL[1];

const OUT: [number, number] = [0, 0.14]; // walks out to the spot
const HOME: [number, number] = [0.82, 1]; // saved: walks back to its place

/** Where the camel is, how deep (px at s = 1), its tilt, how much of it shows, and if it walks. */
function state(h: Stagehand): { x: number; sink: number; tilt: number; a: number; walking: boolean } {
  const spot = where(h);
  if (h.loop) return { x: spot, sink: 8 + cyc(h.t, 2) * 1.5, tilt: 0.2, a: 1, walking: false };
  const home = h.camelX?.[0] ?? spot;
  const down = ramp(h.t, 0.12, 0.25);
  const x = lerp(home, spot, ramp(h.t, OUT[0], OUT[1]));
  if (lostAnimal(h.outcome)) {
    const gone = ramp(h.t, 0.7, 0.95);
    return { x, sink: 9 * down + 14 * gone, tilt: 0.22 * down + 0.2 * gone, a: 1 - gone, walking: h.t < OUT[1] };
  }
  const up = ramp(h.t, 0.6, 0.8);
  const back = lerp(x, home, ramp(h.t, HOME[0], HOME[1]));
  return { x: back, sink: 9 * down * (1 - up), tilt: 0.22 * down * (1 - up), a: 1, walking: h.t < OUT[1] || h.t > HOME[0] };
}

export const camelTrouble: EventScene = {
  still: 0.82,
  pose(h) {
    const p: Pose = {};
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
      c.translate(st.x, v.ground + st.sink * s);
      c.rotate(-st.tilt);
      drawCamel(c, 0, 0, s, st.walking ? walkFrame(h) : 0, "normal");
      c.restore();
    }
    // The lip of the mud, over the camel's legs.
    ell(c, x, v.ground + 4 * s, 28 * s, 5 * s, mud);
    if (pulling(h)) line(c, h.caravan.x1 + 4 * s, v.ground - 14 * s, st.x - 8 * s, v.ground - 26 * s + st.sink * s, 1.2 * s, "#7a5235");
  },
};
