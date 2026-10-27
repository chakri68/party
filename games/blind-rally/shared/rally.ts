import type { GameManifest, SettingField } from "@games/game-core";
import type { Briefing, BriefingLine, TrackLine } from "./rules-text.ts";
import {
  CAMERA_POLICIES,
  MAX_TEAMS,
  PRESET_ASSISTS,
  RACE_GRACE_MS,
  RESET_PENALTY_MS,
  TIME_LIMITS,
  TRACK_PICKS,
  WEATHERS,
  type BlindRallySettings,
  type CameraPolicy,
  type Weather,
} from "./types.ts";

// Rally (rally-spec.md): Blind Rally's road, car and server with the
// blindfold off. Same package, same state, same race code; this file is its
// lobby half: manifest, rules, settings and the briefing card. Like the rest
// of shared/, it's bundled eagerly, so no coordinates and no notes.

export const rallyManifest: GameManifest = {
  id: "rally",
  name: "Rally",
  description: "Everyone drives their own car down the same stage at once. Rivals are ghosts: no contact, just shame.",
  // One is a time trial. Four cars; anyone past that watches until one frees up.
  minPlayers: 1,
  maxPlayers: 8,
  icon: "car",
  lateJoin: true,
};

/**
 * Rally's settings are Blind Rally's with four of them free and the rest
 * pinned: always a race, always one shared stage, and every assist on, since
 * the person reading the map is the one driving.
 */
const FIXED = {
  mode: "race",
  stageMode: "shared",
  assists: "beginner",
  ...PRESET_ASSISTS.beginner,
} as const satisfies Partial<BlindRallySettings>;

export const RALLY_DEFAULTS: BlindRallySettings = {
  timeLimit: 5,
  camera: "free",
  weather: "patchy",
  trackPick: "host",
  ...FIXED,
};

/** Untrusted settings → Rally's. Only the four free fields are read; the rest are pinned whatever arrives. */
export function parseRallySettings(input: unknown): BlindRallySettings | null {
  if (input === undefined || input === null) return { ...RALLY_DEFAULTS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...RALLY_DEFAULTS, ...(input as Partial<BlindRallySettings>) };
  if (!TIME_LIMITS.includes(s.timeLimit) || !CAMERA_POLICIES.includes(s.camera) || !WEATHERS.includes(s.weather) || !TRACK_PICKS.includes(s.trackPick)) return null;
  return { timeLimit: s.timeLimit, camera: s.camera, weather: s.weather, trackPick: s.trackPick, ...FIXED };
}

export const rallyRules: string[] = [
  "Everyone drives. One car each, all on the same stage at the same time.",
  "The other cars are ghosts: you see them, you can't hit them. Drive through a rival if you like. Following one is allowed, and as good an idea as they are.",
  "Laptop: WASD or the arrow keys. Phone: hold it sideways, steer with the left thumb, pedals under the right.",
  "Your pace notes are your co-driver: the next calls sit along the top, counting down the metres.",
  "Stuck in a ditch? Reset (R twice, or the Reset button twice) puts you back at the last checkpoint. It costs 5 seconds.",
  "Checkpoints count in order only, and the finish only counts after all of them.",
  "The track: the host picks it, or everyone gets one vote. A tie goes to a coin flip, and everyone sees it was one.",
  "Lose your connection mid-race and your clock stops for up to 30 seconds while you get back. After that it's a DNF.",
  `Up to ${MAX_TEAMS} cars. Anyone else watches, and gets the next free car.`,
  "Fastest time wins, resets included. Anyone still out there when the time runs out is DNF.",
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));
const CAMERA_LABELS: Record<CameraPolicy, string> = { free: "Any", topdown: "Top-down", chase: "Chase", bonnet: "Bonnet" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "Clear", patchy: "Patchy cloud", murky: "Murky" };

export function rallySettingFields(raw: unknown, players: number): SettingField[] {
  const s = parseRallySettings(raw) ?? RALLY_DEFAULTS;
  const cars = Math.min(MAX_TEAMS, players);
  return [
    {
      key: "trackPick",
      label: "Track",
      selected: pickIndex(TRACK_PICKS, s.trackPick),
      options: [
        { label: "Host picks", patch: { trackPick: "host" } },
        { label: "Everyone votes", patch: { trackPick: "ballot" } },
      ],
      hint: s.trackPick === "ballot" ? "One vote per car; a tie goes to a coin flip" : "Picked on the grid, before ready-up",
    },
    {
      key: "timeLimit",
      label: "Time limit",
      selected: pickIndex(TIME_LIMITS, s.timeLimit),
      options: TIME_LIMITS.map((m) => ({ label: `${m} min`, patch: { timeLimit: m } })),
      hint: players > MAX_TEAMS ? `${cars} cars race, ${players - cars} watch` : "Still out there after that: DNF",
    },
    {
      key: "camera",
      label: "Camera",
      selected: pickIndex(CAMERA_POLICIES, s.camera),
      options: CAMERA_POLICIES.map((c) => ({ label: CAMERA_LABELS[c], patch: { camera: c } })),
      hint: s.camera === "free" ? "Starts in chase; Y cycles chase, bonnet, top-down" : `${CAMERA_LABELS[s.camera]} only`,
    },
    {
      key: "weather",
      label: "Weather",
      selected: pickIndex(WEATHERS, s.weather),
      options: WEATHERS.map((w) => ({ label: WEATHER_LABELS[w], patch: { weather: w } })),
      hint: s.weather === "clear" ? "Nothing in the way" : "Mist hides bits of road; same sky for everyone",
    },
  ];
}

/** The rules as they'll be, before ready-up. Same shape as rulesPreview. */
export function rallyPreview(raw: unknown, track?: TrackLine): { label: string; value: string }[] {
  const s = parseRallySettings(raw) ?? RALLY_DEFAULTS;
  const ballot = s.trackPick === "ballot";
  return [
    {
      label: "Track",
      value: track ? `${track.name}, ${ballot ? "vote" : "host's pick"}${track.tie ? " (tie: picked by coin flip)" : ""}` : ballot ? "Everyone votes" : "The host picks",
    },
    { label: "Stage", value: "Shared: one road, rivals as ghosts" },
    { label: "Time limit", value: `${s.timeLimit} min, then DNF` },
    { label: "Camera", value: s.camera === "free" ? "Any of the three" : `${CAMERA_LABELS[s.camera]} only` },
    { label: "Weather", value: WEATHER_LABELS[s.weather] },
    { label: "Reset", value: `+${RESET_PENALTY_MS / 1000} s, back to the last checkpoint` },
    { label: "Drop-outs", value: `Clock stops, ${RACE_GRACE_MS / 1000} s to get back` },
  ];
}

/**
 * Rally's pre-race card: you drive and you read the road, so it's the
 * Driver's pedals plus the Navigator's view keys. The bindings are the real
 * ones: driver/input.ts (KEYS) for driving, client/rally/drive.ts for R,
 * Godot's main.gd for the view. Change one there, change it here.
 */
export function rallyBriefing(raw: unknown): Briefing {
  const s = parseRallySettings(raw) ?? RALLY_DEFAULTS;
  const lines: BriefingLine[] = [
    { label: "Steer", keys: [["A", "D"], ["←", "→"]], text: "On a phone held sideways: the two pads under your left thumb." },
    { label: "Gas", keys: [["W"], ["↑"]], text: "The tall pad under your right thumb." },
    { label: "Brake", keys: [["S"], ["↓"]], text: "The wide pad. Keep holding once you've stopped and you reverse." },
    { label: "Reset car", keys: [["R"]], text: `Twice, or the Reset button twice: back to the last checkpoint, +${RESET_PENALTY_MS / 1000} s.` },
    { label: "Co-driver", keys: [], text: "The next pace notes, along the top, with the metres to go. They're a guess from the last checkpoint, like a real co-driver's." },
    s.camera === "free"
      ? { label: "Camera", keys: [["Y"]], text: "Cycles chase, bonnet and top-down." }
      : { label: "Camera", keys: [], text: `${CAMERA_LABELS[s.camera]} only, this race.` },
    { label: "Map", keys: [["M"]], text: "The big map, or tap the corner map. Your dot's on it; the ghosts never are." },
    { label: "Sound", keys: [["N"]], text: "Mutes the engine." },
  ];
  return {
    title: "Your car. Your road.",
    lead: "Everyone's on the same stage at once. The other cars are ghosts: they can't hit you, and you can't push them off.",
    lines,
  };
}
