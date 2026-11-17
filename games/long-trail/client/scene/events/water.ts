// Water: the river rises over the ground and the path, a wave hits the hurt
// traveller, then it falls back. Off a river leg, a river is drawn in the
// ground layer. A situation shows the river running high.
import { ell, env, hurt, line, rnd, ticks, wrap } from "./fx.ts";
import type { EventScene, Pose, Stagehand } from "./index.ts";

const WATER = "#4f9fb8";
const LIGHT = "#86c9da";
const FOAM = "#eef7f8";
const rise = (h: Stagehand) => (h.loop ? 0.55 : env(h.t, 0.1, 0.35, 0.65, 0.9));

function river(h: Stagehand): void {
  const { c, v } = h;
  const s = v.s;
  const top = v.ground - (h.terrain === "river" ? 26 : 16) * s;
  const bottom = v.ground - 9 * s + rise(h) * 22 * s;
  c.fillStyle = WATER;
  c.fillRect(0, top, v.w, bottom - top);
  c.fillStyle = LIGHT;
  const gap = 30 * s;
  for (let i = 0; i * gap < v.w + gap; i++) {
    // A loop moves a whole wrap, so it meets itself at t = 1.
    const x = wrap(i * gap + rnd(i, 81) * gap + h.t * (h.loop ? v.w + gap : 2 * gap), v.w + gap) - gap;
    c.fillRect(x, top + (0.2 + rnd(i, 82) * 0.6) * (bottom - top), (6 + rnd(i, 83) * 8) * s, 1.2 * s);
  }
}

export const water: EventScene = {
  still: 0.48,
  pose(h) {
    const who = hurt(h);
    const p: Pose = { crouch: !h.loop && h.t > 0.35 && h.t < 0.62 };
    if (who && h.t > 0.42 && h.t < 0.75) p.down = who.id; // knocked down by the wave, then up again
    return p;
  },
  back: river,
  front(h) {
    const { c, v } = h;
    const s = v.s;
    const r = rise(h);
    // Shallow water over the feet when the river is up.
    const deep = Math.max(0, (r - 0.4) / 0.6);
    if (deep > 0) {
      c.save();
      c.globalAlpha *= 0.6;
      c.fillStyle = WATER;
      c.fillRect(0, v.ground - 2 * s, v.w, deep * 8 * s);
      c.restore();
    }
    const who = hurt(h);
    if (!who) return;
    // The wave that knocks the traveller down.
    const a = env(h.t, 0.3, 0.38, 0.52, 0.62);
    if (a <= 0) return;
    const x = who.x;
    const k = 0.8 + 0.2 * (ticks(h) % 2);
    c.save();
    c.globalAlpha *= a;
    ell(c, x, v.ground - 6 * s, 12 * s * k, 9 * s * k, LIGHT);
    for (let i = 0; i < 5; i++) line(c, x - 10 * s + i * 5 * s, v.ground - 12 * s, x - 12 * s + i * 6 * s, v.ground - 20 * s * k, 1.6 * s, FOAM);
    c.restore();
  },
};
