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
  description: "Every player drives a car on the same road at the same time. The other cars are ghosts. Your car cannot hit a ghost car.",
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
  "Every player drives a car. All cars race on the same road at the same time.",
  "The other cars are ghosts. You can see a ghost car. Your car cannot hit a ghost car. Your car drives through it.",
  "You can follow another car. But that player may be lost too.",
  "On a laptop, use WASD or the arrow keys.",
  "On a phone, hold the phone sideways. Steer with your left thumb. Use the pedals with your right thumb.",
  "Pace notes are short notes about the next turns. The pace notes show at the top of the screen. Each note shows the metres left to that turn.",
  "A checkpoint is a marked point on the road. You must pass the checkpoints in order.",
  "Pass every checkpoint first. Then cross the finish line.",
  "If your car gets stuck, press R 2 times. You can also tap the Reset button 2 times.",
  "A reset takes your car back to the last checkpoint. A reset adds 5 seconds to your time.",
  "The host chooses the track, or every player votes. Each player gets 1 vote.",
  "If the vote is a tie, a coin toss decides. Everyone sees the result.",
  "If you lose connection, your clock stops. You get 30 seconds to connect again.",
  "After 30 seconds, you get a DNF. DNF means \"did not finish\".",
  `Up to ${MAX_TEAMS} cars can race. Other players watch. A watching player gets the next free car.`,
  "The player with the fastest time wins. Resets add to your time.",
  "If time runs out, every player still driving gets a DNF.",
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));
const CAMERA_LABELS: Record<CameraPolicy, string> = { free: "Any", topdown: "Top-down", chase: "Chase", bonnet: "Bonnet" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "Clear", patchy: "Some mist", murky: "Misty" };

export function rallySettingFields(raw: unknown, players: number): SettingField[] {
  const s = parseRallySettings(raw) ?? RALLY_DEFAULTS;
  const cars = Math.min(MAX_TEAMS, players);
  return [
    {
      key: "trackPick",
      label: "Track",
      selected: pickIndex(TRACK_PICKS, s.trackPick),
      options: [
        { label: "Host chooses", patch: { trackPick: "host" } },
        { label: "Everyone votes", patch: { trackPick: "ballot" } },
      ],
      hint: s.trackPick === "ballot" ? "Each car gets 1 vote. A coin toss decides a tie" : "The host chooses on the grid screen",
    },
    {
      key: "timeLimit",
      label: "Time limit",
      selected: pickIndex(TIME_LIMITS, s.timeLimit),
      options: TIME_LIMITS.map((m) => ({ label: `${m} min`, patch: { timeLimit: m } })),
      hint: players > MAX_TEAMS ? `${cars} cars race, ${players - cars} watch` : "Cars still driving then get a DNF",
    },
    {
      key: "camera",
      label: "Camera",
      selected: pickIndex(CAMERA_POLICIES, s.camera),
      options: CAMERA_POLICIES.map((c) => ({ label: CAMERA_LABELS[c], patch: { camera: c } })),
      hint: s.camera === "free" ? "Starts behind the car. Press Y to change the view" : `${CAMERA_LABELS[s.camera]} only`,
    },
    {
      key: "weather",
      label: "Weather",
      selected: pickIndex(WEATHERS, s.weather),
      options: WEATHERS.map((w) => ({ label: WEATHER_LABELS[w], patch: { weather: w } })),
      hint: s.weather === "clear" ? "You can see the whole road" : "Mist hides parts of the road. Everyone gets the same weather",
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
      value: track ? `${track.name}, ${ballot ? "chosen by vote" : "chosen by host"}${track.tie ? " (tie, so coin toss)" : ""}` : ballot ? "Everyone votes" : "The host chooses",
    },
    { label: "Stage", value: "Shared: 1 road, other cars are ghosts" },
    { label: "Time limit", value: `${s.timeLimit} min, then DNF` },
    { label: "Camera", value: s.camera === "free" ? "Any of the 3" : `${CAMERA_LABELS[s.camera]} only` },
    { label: "Weather", value: WEATHER_LABELS[s.weather] },
    { label: "Reset", value: `+${RESET_PENALTY_MS / 1000} s. The car goes back to the last checkpoint.` },
    { label: "Lost connection", value: `The clock stops. You get ${RACE_GRACE_MS / 1000} s to connect again.` },
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
    { label: "Steer", keys: [["A", "D"], ["←", "→"]], text: "Hold the phone sideways. Use the 2 pads under your left thumb." },
    { label: "Go", keys: [["W"], ["↑"]], text: "Hold the tall pad under your right thumb." },
    { label: "Brake", keys: [["S"], ["↓"]], text: "Hold the wide pad. Keep holding the pad after you stop. Then the car goes backwards." },
    { label: "Reset car", keys: [["R"]], text: `Press R 2 times, or tap Reset 2 times. The car goes back to the last checkpoint. You get ${RESET_PENALTY_MS / 1000} s added to your time.` },
    { label: "Pace notes", keys: [], text: "The top of the screen shows the next turns and the metres to each turn. The game counts from your last checkpoint. So the metres may be a little wrong." },
    s.camera === "free"
      ? { label: "Camera", keys: [["Y"]], text: "Changes the view: chase (behind the car), bonnet (on the car) or top-down." }
      : { label: "Camera", keys: [], text: `${CAMERA_LABELS[s.camera]} only in this race.` },
    { label: "Map", keys: [["M"]], text: "Opens the big map. You can also tap the small map. The map shows your car. The map does not show the ghost cars." },
    { label: "Sound", keys: [["N"]], text: "Turns the engine sound off or on." },
  ];
  return {
    title: "You drive your own car.",
    lead: "Every player drives on the same road at the same time. The other cars are ghosts. A ghost car cannot hit your car.",
    lines,
  };
}
