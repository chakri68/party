import { stableHash } from "@games/game-core";

// The sky clock. Server, client and Godot (day_clock.gd copies these numbers) all follow it.

export type TimeSetting = "day" | "dusk" | "night" | "random";
export const TIMES: readonly TimeSetting[] = ["day", "dusk", "night", "random"];
export const TIME_LABELS: Record<TimeSetting, string> = { day: "Day", dusk: "Dusk", night: "Night", random: "Random" };

const HINTS: Record<TimeSetting, string> = {
  day: "It stays light.",
  dusk: "The sun sets during the round. A long round ends in the dark.",
  night: "It is dark. Press F for your torch. Buggy lights come on by themselves.",
  random: "A surprise. Everyone gets the same one.",
};
export function timeHint(t: TimeSetting): string {
  return HINTS[t];
}

export const START_MIN = { day: 600, dusk: 1060, night: 1320 } as const;
export const SUNRISE = 360;
export const SUNSET = 1080;
export const SUN_MAX_EL = 55;
export const DARK_LIGHT_EL = 6;
export const DARK_FULL_EL = -6;
export const SHADOW_MIN_EL = 15;
export const SHADOW_MAX = 100;
export const SHADOW_STEP = 10;
export const LAMP_ON = 0.3;
export const LAMP_CLUE_DARK = 0.5;
export const LAMP_REACH = 3;
export const PHOTO_DIST = 5;
export const PHOTO_EYE = 1.7;
export const PHOTO_MAX = 250;
export const PHOTO_TARGET = 3;
export const LIGHT_TARGET = 2;
export const PHOTO_W = 480;
export const PHOTO_H = 270;
export const PHOTO_Q = 0.75;
export const TORCH_RANGE = 18;
export const TORCH_ANGLE = 35;
export const HEAD_RANGE = 60;
export const HEAD_ANGLE = 18;
export const GLINT_RANGE = 8;

const DAY = 1440;
const wrap = (min: number) => ((min % DAY) + DAY) % DAY;
const RAD = Math.PI / 180;

export function startMinOf(t: TimeSetting, seed: number): number {
  if (t !== "random") return START_MIN[t];
  const pick = (["day", "dusk", "night"] as const)[stableHash(`${seed}:time`) % 3]!;
  return START_MIN[pick];
}

/** az is a compass bearing: 0 north (-Z), 90 east (+X). el is degrees above the horizon, negative at night. */
export function sunAt(min: number): { az: number; el: number } {
  // t runs 0 at sunrise to 1 at sunset; outside that the sun is below the horizon.
  const t = (wrap(min) - SUNRISE) / (SUNSET - SUNRISE);
  const el = SUN_MAX_EL * Math.sin(Math.PI * t);
  const az = (((90 + 180 * t) % 360) + 360) % 360;
  return { az, el };
}

/** 0 in full light, 1 in full dark. Smoothstep on sun elevation. */
export function darkAt(min: number): number {
  const { el } = sunAt(min);
  const x = Math.min(1, Math.max(0, (DARK_LIGHT_EL - el) / (DARK_LIGHT_EL - DARK_FULL_EL)));
  return x * x * (3 - 2 * x);
}

/** True when darkness reaches LAMP_CLUE_DARK on any whole minute of [startMin, startMin + minutes]. */
export function darkWithin(startMin: number, minutes: number): boolean {
  for (let m = 0; m <= minutes; m++) if (darkAt(startMin + m) >= LAMP_CLUE_DARK) return true;
  return false;
}

export function clockText(min: number): string {
  const m = Math.floor(wrap(min));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Where the shadow of something `top` metres tall ends, or null when the sun is too low or the shadow too long. */
export function shadowTip(at: { x: number; z: number }, top: number, min: number): { x: number; z: number } | null {
  const { az, el } = sunAt(min);
  if (el < SHADOW_MIN_EL) return null;
  const len = top / Math.tan(el * RAD);
  if (len > SHADOW_MAX) return null;
  return { x: at.x - len * Math.sin(az * RAD), z: at.z + len * Math.cos(az * RAD) };
}
