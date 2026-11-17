// Sick: the hurt traveller lies down by a small fire under a blanket, and the
// others crouch round. With no one hurt (or in a situation), the caravan only
// rests by the fire: no blanket, no one lying down.
import { drawFire, TRAVELLER } from "../sprites.ts";
import { ell, hurt, ramp, ticks } from "./fx.ts";
import type { EventScene, Stagehand } from "./index.ts";

const LIE = 0.18; // lies down from here
const UP = 0.88; // gets up again, so the beat ends with them standing
/** The blanket and bowl were laid out for travellers at 1.15; they grow with the sprite. */
const fit = (h: Stagehand) => (h.v.s * TRAVELLER) / 1.15;
const shown = (h: Stagehand) => (h.loop ? 1 : ramp(h.t, 0.05, 0.2));

/** The fire: on the near side by the hurt traveller's head, else ahead of the caravan. */
function fire(h: Stagehand, near: boolean): void {
  const who = hurt(h);
  if (!!who !== near) return;
  const { c, v } = h;
  const a = shown(h);
  if (a <= 0) return;
  const x = who ? who.x + 18 * fit(h) : h.caravan.x1 + 26 * v.s;
  c.save();
  c.globalAlpha *= a;
  drawFire(c, x, v.ground + (who ? 9 : -1) * v.s, v.s * 0.9, ticks(h) / 4);
  c.restore();
}

export const sick: EventScene = {
  still: 0.6,
  pose(h) {
    const who = hurt(h);
    if (!who || h.t < LIE || h.t >= UP) return {};
    return { down: who.id, crouch: h.t > 0.25 && h.t < 0.85 };
  },
  back: (h) => fire(h, false),
  front(h) {
    fire(h, true);
    const who = hurt(h);
    if (!who) return;
    const { c, v } = h;
    const s = fit(h);
    const a = Math.min(ramp(h.t, LIE, LIE + 0.1), 1 - ramp(h.t, UP - 0.06, UP));
    if (a <= 0) return;
    // A striped blanket over the body, the head left out; a bowl of water by them.
    const x = who.x;
    c.save();
    c.globalAlpha *= a;
    c.fillStyle = "#a8432f";
    c.beginPath();
    c.moveTo(x - 15 * s, v.ground + 1 * s);
    c.lineTo(x - 14 * s, v.ground - 6 * s);
    c.quadraticCurveTo(x - 4 * s, v.ground - 10 * s, x + 8 * s, v.ground - 8 * s);
    c.lineTo(x + 9 * s, v.ground + 1 * s);
    c.closePath();
    c.fill();
    c.fillStyle = "#e2b04a";
    for (const dx of [-10, -4, 2]) c.fillRect(x + dx * s, v.ground - 8.5 * s, 1.6 * s, 9.5 * s);
    ell(c, x - 18 * s, v.ground + 5 * s, 3.4 * s, 1.6 * s, "#7a5235");
    ell(c, x - 18 * s, v.ground + 4.4 * s, 2.6 * s, 0.8 * s, "#86c9da");
    c.restore();
  },
};
