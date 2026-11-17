// Robbers: riders come in fast from the right, circle the camels, and ride
// out, with a pack only if the outcome lost cargo or coins. A situation shows
// them waiting on the ridge.
import { drawRider } from "../sprites.ts";
import { cyc, lerp, lostCargo, ramp, sack, walkFrame } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const RIDERS = 3;
const IN = 0.3; // in by here
const OUT = 0.62; // circling until here
interface Spot { x: number; y: number; facing: 1 | -1; near: boolean; k: number }

function spot(h: Stagehand, i: number): Spot {
  const { v, t, caravan } = h;
  const s = v.s;
  const cx = lerp(caravan.x0, caravan.x1, 0.35);
  const at = (th: number) => ({ x: cx + 34 * s * Math.cos(th), near: Math.sin(th) > 0, y: v.ground + Math.sin(th) * 8 * s });
  const th0 = -Math.PI / 2 + (i * Math.PI * 2) / RIDERS;
  const start = at(th0);
  const off = v.w + (30 + i * 22) * s;
  const k = start.near ? 1.05 : 0.95;
  if (t < IN) {
    const u = ramp(t, i * 0.04, IN);
    return { x: lerp(off, start.x, u), y: start.y, facing: -1, near: start.near, k };
  }
  if (t < OUT) {
    const th = th0 + ((t - IN) / (OUT - IN)) * Math.PI * 2;
    const p = at(th);
    return { ...p, facing: -Math.sin(th) >= 0 ? 1 : -1, k: p.near ? 1.05 : 0.95 };
  }
  return { x: lerp(start.x, off + 20 * s, ramp(t, OUT + i * 0.03, 1)), y: start.y, facing: 1, near: start.near, k };
}

function ride(h: Stagehand, near: boolean): void {
  const { c, v } = h;
  if (h.loop) {
    if (near) return;
    // Waiting on the ridge, small and far.
    for (let i = 0; i < RIDERS; i++) {
      const x = v.w - (34 + i * 20) * v.s + cyc(h.t + i / 3) * 1.5 * v.s;
      drawRider(c, x, v.ground - (20 + (i % 2) * 3) * v.s, v.s * 0.62, 0, -1);
    }
    return;
  }
  const frame = walkFrame(h, 2.6);
  const loot = lostCargo(h.outcome);
  for (let i = 0; i < RIDERS; i++) {
    const p = spot(h, i);
    if (p.near !== near) continue;
    drawRider(c, p.x, p.y, v.s * p.k, frame + i * 0.3, p.facing);
    if (loot && i === 0 && h.t >= OUT) sack(c, p.x - 9 * v.s, p.y - 22 * v.s, 4.5 * v.s, "#7a5a3a");
  }
}

export const robbers: EventScene = {
  still: 0.75,
  pose: (h) => ({ crouch: !h.loop && h.t > IN - 0.02 && h.t < OUT }),
  back: (h) => ride(h, false),
  front: (h) => ride(h, true),
};
