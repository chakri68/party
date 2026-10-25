import type { SettingField } from "@games/game-core";
import {
  CAMERA_POLICIES,
  DEFAULT_SETTINGS,
  MAX_TEAMS,
  MODES,
  STAGE_MODES,
  TIME_LIMITS,
  WEATHERS,
  type BlindRallySettings,
  type CameraPolicy,
  type Weather,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const blindRallyRules: string[] = [
  "You race in pairs. The Driver has the pedals and the wheel and no idea where the road goes. The Navigator sees the course and the car, and can't touch a thing.",
  "Talk. Out loud, in the same room or on a call: \"left four, don't cut\", \"tree, TREE\", that sort of thing.",
  "After Start, pick your seats: up to four teams, one Driver and one Navigator each. The host can move people around. Ready up when you're sat down.",
  "Three, two, one, go. Every car starts at once and the clock is the room's, not yours.",
  "Stuck in a ditch? The Driver can reset to the last checkpoint. It costs 5 seconds.",
  "Solo stage: every car has its own copy of the road. Shared stage: one road, and Navigators see the other cars as ghosts that can't hit you. Following a rival is allowed. Following a lost rival is a choice.",
  "Each team has a colour, a shape and a number, on its car and its seats.",
  "Fastest time wins. Anyone still out there when the time runs out is DNF.",
  "Practice is one pair, no rivals, same clock.",
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));

const CAMERA_LABELS: Record<CameraPolicy, string> = { free: "Any", topdown: "Top-down", chase: "Chase", bonnet: "Bonnet" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "Clear", patchy: "Patchy cloud", murky: "Murky" };

export function parseSettings(input: unknown): BlindRallySettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<BlindRallySettings>) };
  const ok =
    MODES.includes(s.mode) &&
    TIME_LIMITS.includes(s.timeLimit) &&
    CAMERA_POLICIES.includes(s.camera) &&
    WEATHERS.includes(s.weather) &&
    // Shared needs one track for everyone. Fair Race always has that; Chaos Cup (M3) checks its vote.
    STAGE_MODES.includes(s.stageMode);
  return ok ? { mode: s.mode, timeLimit: s.timeLimit, camera: s.camera, weather: s.weather, stageMode: s.stageMode } : null;
}

/** What the lobby shows (and the host can change) before a game. */
export function blindRallySettingFields(raw: unknown, players: number): SettingField[] {
  const s = parseSettings(raw) ?? DEFAULT_SETTINGS;
  const cars = Math.min(MAX_TEAMS, Math.floor(players / 2));
  return [
    {
      key: "mode",
      label: "Mode",
      selected: pickIndex(MODES, s.mode),
      options: [
        { label: "Race", patch: { mode: "race" } },
        { label: "Practice", patch: { mode: "practice" } },
      ],
      hint: s.mode === "practice"
        ? "One pair, no rivals"
        : cars >= 2 ? `Up to ${cars} cars with this many` : "One pair races the clock; two or more race each other",
    },
    {
      key: "stageMode",
      label: "Stage",
      selected: pickIndex(STAGE_MODES, s.stageMode),
      options: [
        { label: "Solo", patch: { stageMode: "solo" } },
        { label: "Shared", patch: { stageMode: "shared" } },
      ],
      hint: s.stageMode === "shared"
        ? "One road for everyone; Navigators see rival cars as ghosts"
        : "Every car has the road to itself",
    },
    {
      key: "timeLimit",
      label: "Time limit",
      selected: pickIndex(TIME_LIMITS, s.timeLimit),
      options: TIME_LIMITS.map((m) => ({ label: `${m} min`, patch: { timeLimit: m } })),
      hint: "Still out there after that: DNF",
    },
    {
      key: "camera",
      label: "Navigator camera",
      selected: pickIndex(CAMERA_POLICIES, s.camera),
      options: CAMERA_POLICIES.map((c) => ({ label: CAMERA_LABELS[c], patch: { camera: c } })),
      hint: s.camera === "free" ? "Top-down, chase or bonnet, their pick" : `${CAMERA_LABELS[s.camera]} only`,
    },
    {
      key: "weather",
      label: "Weather",
      selected: pickIndex(WEATHERS, s.weather),
      options: WEATHERS.map((w) => ({ label: WEATHER_LABELS[w], patch: { weather: w } })),
      hint: s.weather === "clear" ? "Nothing in the way" : "Mist hides bits of road; same sky for every team",
    },
  ];
}
