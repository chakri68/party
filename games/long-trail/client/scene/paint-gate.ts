// When the stage draws a frame. While a beat plays or the caravan walks it draws
// every frame. Standing still with no beat left (halted at a stop, or the day
// report over) it draws only after a change, and at camp only when the fire
// changes shape, so a still band does not use the battery.

/** The camp fire changes shape once in this many ms: 3 times a second. */
export const FIRE_MS = 333;

export interface PaintGate {
  running: boolean; // a beat is playing: a finite one not yet over, or a situation loop
  speed: number; // the caravan's walking speed, 0 = standing
  camp: boolean;
  dirty: boolean; // the model, the size or the art changed since the last frame
  now: number; // ms
  last: number; // when the last frame was drawn, 0 = none since the loop began
}

/** Whether to draw the frame at `now`. */
export function needsPaint(g: PaintGate): boolean {
  if (g.dirty || !g.last || g.running || g.speed > 0) return true;
  return g.camp && Math.floor(g.now / FIRE_MS) !== Math.floor(g.last / FIRE_MS);
}

/** How long to wait before the next frame: 0 for the next one, Infinity until something changes. */
export function sleepMs(g: Pick<PaintGate, "running" | "speed" | "camp" | "now">): number {
  if (g.running || g.speed > 0) return 0;
  if (!g.camp) return Infinity;
  return (Math.floor(g.now / FIRE_MS) + 1) * FIRE_MS - g.now + 1;
}
