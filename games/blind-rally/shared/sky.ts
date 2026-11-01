import { stableHash } from "@games/game-core";

// The sky for one run, decided once from the room's setting and the seed.
// Server and client both read it, so everyone sees the same light at the
// same moment. Times are ms from GO.

export type TimeSetting = "day" | "dawn" | "dusk" | "night" | "sunset" | "random";
export const TIMES: readonly TimeSetting[] = ["day", "dawn", "dusk", "night", "sunset", "random"];

export const TIME_LABELS: Record<TimeSetting, string> = {
  day: "Day", dawn: "Dawn", dusk: "Dusk", night: "Night", sunset: "Day into night", random: "Random",
};

export function timeHint(time: TimeSetting): string {
  if (time === "night") return "It's dark. Your lights show the road ahead.";
  if (time === "sunset") return "The sun goes down while you drive.";
  if (time === "random") return "A surprise. Everyone gets the same one.";
  return "Everyone gets the same light.";
}

export type Light = "day" | "dawn" | "dusk" | "night";

export interface SkyPlan {
  light: { from: Light; to: Light; atMs: number; overMs: number };
}

type TrackLen = { length: number; par_seconds: number | null };

const MS_PER_METRE = 50;
const RANDOM_PICKS = ["day", "dawn", "dusk", "night", "sunset"] as const;

/** How long a run is expected to take: par if the track has one, else 50 ms a metre. */
export function runMsOf(track: TrackLen): number {
  return track.par_seconds !== null ? track.par_seconds * 1000 : track.length * MS_PER_METRE;
}

export function skyPlan(time: TimeSetting, seed: number, track: TrackLen): SkyPlan {
  const pick = time === "random" ? RANDOM_PICKS[stableHash(`${seed}:time`) % RANDOM_PICKS.length]! : time;
  if (pick === "sunset") {
    const run = runMsOf(track);
    return { light: { from: "day", to: "night", atMs: run * 0.25, overMs: run * 0.5 } };
  }
  return { light: { from: pick, to: pick, atMs: 0, overMs: 0 } };
}

/** Where the light sits between from and to at `ms`: k 0 is all from, 1 is all to. */
export function lightAt(plan: SkyPlan, ms: number): { from: Light; to: Light; k: number } {
  const { from, to, atMs, overMs } = plan.light;
  const k = overMs <= 0 ? 1 : Math.min(1, Math.max(0, (ms - atMs) / overMs));
  return { from, to, k };
}

const WORDS: Record<Light, string> = { day: "Day.", dawn: "Dawn.", dusk: "Dusk.", night: "Night." };

export function skyWords(plan: SkyPlan): string {
  const { from, to } = plan.light;
  if (from === to) return WORDS[from];
  return "Day into night. The sun goes down while you drive.";
}
