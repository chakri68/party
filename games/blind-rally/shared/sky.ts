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

export type RainSetting = "dry" | "rain" | "storm" | "clears" | "random";
export const RAINS: readonly RainSetting[] = ["dry", "rain", "storm", "clears", "random"];

export const RAIN_LABELS: Record<RainSetting, string> = {
  dry: "Dry", rain: "Rain", storm: "Rain starts", clears: "Rain stops", random: "Random",
};

export function rainHint(rain: RainSetting): string {
  if (rain === "rain") return "The road is wet. Cars slide more.";
  if (rain === "storm") return "Rain starts while you drive.";
  if (rain === "clears") return "The rain stops and the road dries.";
  if (rain === "random") return "A surprise. Everyone gets the same one.";
  return "The road is dry.";
}

export type Light = "day" | "dawn" | "dusk" | "night";

export interface SkyPlan {
  light: { from: Light; to: Light; atMs: number; overMs: number };
  rain: { from: number; to: number; atMs: number; overMs: number };
}

type TrackLen = { length: number; par_seconds: number | null };

const MS_PER_METRE = 50;
const RANDOM_PICKS = ["day", "dawn", "dusk", "night", "sunset"] as const;

/** How long a run is expected to take: par if the track has one, else 50 ms a metre. */
export function runMsOf(track: TrackLen): number {
  return track.par_seconds !== null ? track.par_seconds * 1000 : track.length * MS_PER_METRE;
}

const STORM_OVER_MS = 30000;
const CLEARS_OVER_MS = 20000;
const WET_LAG_UP_MS = 20000;
const WET_LAG_DOWN_MS = 40000;

function rainPlan(rain: RainSetting, seed: number, track: TrackLen): SkyPlan["rain"] {
  const pick = rain === "random" ? randomRain(seed) : rain;
  if (pick === "dry") return { from: 0, to: 0, atMs: 0, overMs: 0 };
  if (pick === "rain") return { from: 1, to: 1, atMs: 0, overMs: 0 };
  const atMs = Math.round(runMsOf(track) * (0.3 + 0.2 * ((stableHash(`${seed}:rainAt`) % 1000) / 1000)));
  return pick === "storm"
    ? { from: 0, to: 1, atMs, overMs: STORM_OVER_MS }
    : { from: 1, to: 0, atMs, overMs: CLEARS_OVER_MS };
}

function randomRain(seed: number): "dry" | "rain" | "storm" | "clears" {
  const n = stableHash(`${seed}:rain`) % 100;
  return n < 40 ? "dry" : n < 60 ? "rain" : n < 80 ? "storm" : "clears";
}

export function skyPlan(time: TimeSetting, rain: RainSetting, seed: number, track: TrackLen): SkyPlan {
  const pick = time === "random" ? RANDOM_PICKS[stableHash(`${seed}:time`) % RANDOM_PICKS.length]! : time;
  const r = rainPlan(rain, seed, track);
  if (pick === "sunset") {
    const run = runMsOf(track);
    return { light: { from: "day", to: "night", atMs: run * 0.25, overMs: run * 0.5 }, rain: r };
  }
  return { light: { from: pick, to: pick, atMs: 0, overMs: 0 }, rain: r };
}

/** Where the light sits between from and to at `ms`: k 0 is all from, 1 is all to. */
export function lightAt(plan: SkyPlan, ms: number): { from: Light; to: Light; k: number } {
  const { from, to, atMs, overMs } = plan.light;
  const k = overMs <= 0 ? 1 : Math.min(1, Math.max(0, (ms - atMs) / overMs));
  return { from, to, k };
}

function ramp(from: number, to: number, atMs: number, overMs: number, ms: number): number {
  if (from === to) return to;
  const k = overMs <= 0 ? 1 : Math.min(1, Math.max(0, (ms - atMs) / overMs));
  return from + (to - from) * k;
}

/** How hard it rains at `ms`, 0..1. */
export function rainAt(plan: SkyPlan, ms: number): number {
  const { from, to, atMs, overMs } = plan.rain;
  return ramp(from, to, atMs, overMs, ms);
}

/** How wet the road is at `ms`, 0..1. It lags the rain: slow to soak, slower to dry. */
export function wetnessAt(plan: SkyPlan, ms: number): number {
  const { from, to, atMs, overMs } = plan.rain;
  const lag = to > from ? WET_LAG_UP_MS : WET_LAG_DOWN_MS;
  return ramp(from, to, atMs, overMs + lag, ms);
}

const WORDS: Record<Light, string> = { day: "Day.", dawn: "Dawn.", dusk: "Dusk.", night: "Night." };

export const SNOW_TRACKS: readonly string[] = ["snowblind"];

export function skyWords(plan: SkyPlan, trackId: string): string {
  const { from, to } = plan.light;
  const light = from === to ? WORDS[from] : "Day into night. The sun goes down while you drive.";
  const noun = SNOW_TRACKS.includes(trackId) ? "Snow" : "Rain";
  const r = plan.rain;
  const phrase = r.from === r.to ? (r.to > 0 ? `${noun}.` : "") : r.to > r.from ? `${noun} starts during the run.` : `${noun} stops during the run.`;
  return phrase ? `${light} ${phrase}` : light;
}
