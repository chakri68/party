// Visitor: someone walks up from the right, a small exchange, they walk off.
// A bundle passes to the caravan if it gained, or to the visitor if it gave.
// A situation shows the visitor waiting by the caravan.
import { drawTraveller } from "../sprites.ts";
import { gained, gave, inBand, lerp, ramp, sack, turned, walkFrame } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const ROBE = "#6d7f9a";

function walk(h: Stagehand): void {
  const { c, v } = h;
  const s = v.s;
  const stand = inBand(h, h.caravan.x1 + 24 * s, 20 * s);
  const away = v.w + 16 * s;
  const y = v.ground + 2 * s;
  let x = stand;
  let facing: 1 | -1 = -1;
  let moving = false;
  if (!h.loop && h.t < 0.3) [x, moving] = [lerp(away, stand, ramp(h.t, 0, 0.3)), true];
  if (!h.loop && h.t > 0.7) [x, facing, moving] = [lerp(stand, away, ramp(h.t, 0.7, 1)), 1, true];
  const frame = moving ? walkFrame(h) : 0.25;
  turned(c, x, facing, (ox) => {
    drawTraveller(c, ox, y, s, frame, { color: ROBE, health: 3, riding: false, alpha: 1 });
  });
  if (h.loop) return sack(c, x + 7 * s, y, 3.5 * s, "#8c6a44");
  // The exchange: one bundle, to the caravan if it gained, else to the visitor if it gave.
  const give = gained(h.outcome);
  if (!give && !gave(h.outcome)) return;
  const k = ramp(h.t, 0.4, 0.6);
  const hand = stand - 6 * s;
  const camp = h.caravan.x1 + 6 * s;
  if (k > 0 && k < 1) {
    sack(c, give ? lerp(hand, camp, k) : lerp(camp, hand, k), y - 10 * s - Math.sin(k * Math.PI) * 8 * s, 3.2 * s, "#8c6a44");
  } else if (give ? k <= 0 : k >= 1) {
    sack(c, x - 6 * s * facing, y - 10 * s, 3.2 * s, "#8c6a44");
  }
}

export const visitor: EventScene = {
  still: 0.5,
  front: walk,
};
