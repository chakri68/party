import type { SettingField } from "@games/game-core";
import {
  ASSIST_PRESETS,
  CAMERA_POLICIES,
  DEFAULT_SETTINGS,
  MAX_TEAMS,
  MODES,
  STAGE_MODES,
  TIME_LIMITS,
  TRACK_PICKS,
  WEATHERS,
  RACE_GRACE_MS,
  RESET_PENALTY_MS,
  effectiveAssists,
  effectiveTrackPick,
  type AssistPreset,
  type Assists,
  type BlindRallySettings,
  type CameraPolicy,
  type Role,
  type Weather,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const blindRallyRules: string[] = [
  "You race in pairs. The Driver has the pedals, the wheel, a speedo and a compass, and no idea where the road goes. The Navigator sees the course and the car, and can't touch a thing.",
  "Talk. Out loud, in the same room or on a call: \"left four, don't cut\", \"tree, TREE\", that sort of thing.",
  "After Start, pick your seats: up to four teams, one Driver and one Navigator each. The host can move people around. Ready up when you're sat down.",
  "Three, two, one, go. Every car starts at once and the clock is the room's, not yours.",
  "Stuck in a ditch? The Driver can reset to the last checkpoint. It costs 5 seconds, and the car sits still a moment first.",
  "Checkpoints count in order only, and the finish only counts after all of them.",
  "Lose a phone mid-race and your team's clock stops for up to 30 seconds while you reconnect. After that it's a DNF.",
  "Assists: the host picks how much the Navigator gets. A live car marker on the map, a trip meter, printed pace notes, the 3D view itself. Classic is no marker, the rest on. Nightmare is all off: the Navigator gets a map and their wits.",
  "The track: the host picks it, or the teams vote, one vote per car, cast by its captain. A tie goes to a coin flip, and everyone sees it was one. Changing the track un-readies the Navigators, since their course loads when they ready up.",
  "Solo stage: every car has its own copy of the road. Shared stage: one road, and Navigators see the other cars as ghosts that can't hit you. Following a rival is allowed. Following a lost rival is a choice.",
  "Each team has a colour, a shape and a number, on its car and its seats.",
  "Fastest time wins. Anyone still out there when the time runs out is DNF.",
  "Practice is one pair, no rivals, same clock.",
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));

const CAMERA_LABELS: Record<CameraPolicy, string> = { free: "Any", topdown: "Top-down", chase: "Chase", bonnet: "Bonnet" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "Clear", patchy: "Patchy cloud", murky: "Murky" };
const PRESET_LABELS: Record<AssistPreset, string> = { beginner: "Beginner", classic: "Classic", nightmare: "Nightmare", custom: "Custom" };
const ASSIST_LABELS: Record<keyof Assists, string> = { liveMarker: "Live car marker", tripMeter: "Trip meter", paceNotes: "Pace notes", camera3d: "3D camera" };
const ASSIST_KEYS = Object.keys(ASSIST_LABELS) as (keyof Assists)[];
const bool = (v: unknown) => typeof v === "boolean";

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
    STAGE_MODES.includes(s.stageMode) &&
    TRACK_PICKS.includes(s.trackPick) &&
    ASSIST_PRESETS.includes(s.assists) &&
    ASSIST_KEYS.every((k) => bool(s[k]));
  if (!ok) return null;
  const { mode, timeLimit, camera, weather, stageMode, trackPick, assists, liveMarker, tripMeter, paceNotes, camera3d } = s;
  return { mode, timeLimit, camera, weather, stageMode, trackPick, assists, liveMarker, tripMeter, paceNotes, camera3d };
}

/** Mid-sentence: "Live car marker" reads "live car marker", "3D camera" stays as it is. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const onOff = (a: Assists) => ASSIST_KEYS.map((k) => `${a[k] ? "" : "no "}${lower(ASSIST_LABELS[k])}`).join(", ");

/** The game's word on the track, once there's a game: its name, and whether a coin flip picked it. */
export interface TrackLine {
  name: string;
  tie: boolean;
}

/**
 * The rules as they'll be, in short lines: the preview everyone sees before
 * ready-up (spec §4.3, §7.4). Plain settings only, nothing about the road
 * but its name. Without `track` (the lobby, before a game) it says how the
 * track will be chosen.
 */
export function rulesPreview(raw: unknown, track?: TrackLine): { label: string; value: string }[] {
  const s = parseSettings(raw) ?? DEFAULT_SETTINGS;
  const a = effectiveAssists(s);
  const ballot = effectiveTrackPick(s) === "ballot";
  const how = ballot ? "team vote" : "host's pick";
  return [
    {
      label: "Track",
      value: track
        ? `${track.name}, ${how}${track.tie ? " (tie: picked by coin flip)" : ""}`
        : ballot ? "Team vote, one per car" : "The host picks",
    },
    { label: "Stage", value: s.mode === "practice" ? "Practice, one pair" : s.stageMode === "shared" ? "Shared: one road, rivals as ghosts" : "Solo: a road each" },
    { label: "Time limit", value: `${s.timeLimit} min, then DNF` },
    { label: "Assists", value: `${PRESET_LABELS[s.assists]}: ${onOff(a)}` },
    { label: "Navigator camera", value: !a.camera3d ? "None: map only" : s.camera === "free" ? "Any of the three" : `${CAMERA_LABELS[s.camera]} only` },
    { label: "Weather", value: WEATHER_LABELS[s.weather] },
    { label: "Reset", value: `+${RESET_PENALTY_MS / 1000} s, back to the last checkpoint` },
    { label: "Drop-outs", value: `Clock stops, ${RACE_GRACE_MS / 1000} s to get back` },
  ];
}

/** One thing you can do in your seat: the keys for it (alternatives, each a chord of chips), and what it does. */
export interface BriefingLine {
  label: string;
  /** [["A", "D"], ["←", "→"]] reads "A D or ← →". Empty: touch only. */
  keys: string[][];
  text: string;
}

export interface Briefing {
  title: string;
  lead: string;
  lines: BriefingLine[];
}

/**
 * The pre-race card for one seat: the job, then every control it has, under
 * this race's settings (spec §4.1, §4.2). The keys are the real bindings:
 * driver/input.ts for the Driver, Godot's main.gd `_unhandled_key_input` and
 * map_controller.gd for the Navigator. Change one there, change it here.
 */
export function roleBriefing(role: Role, raw: unknown): Briefing {
  const s = parseSettings(raw) ?? DEFAULT_SETTINGS;
  const a = effectiveAssists(s);
  if (role === "driver") {
    return {
      title: "You drive. Blind.",
      lead: "You can't see the road. Your Navigator can: listen to them, and tell them what you're doing.",
      lines: [
        { label: "Steer", keys: [["A", "D"], ["←", "→"]], text: "Hold Left or Right, the pads under your left thumb." },
        { label: "Gas", keys: [["W"], ["↑"]], text: "The tall pad under your right thumb." },
        { label: "Brake", keys: [["S"], ["↓"]], text: "The wide pad. Keep holding once you've stopped and you reverse." },
        { label: "Reset car", keys: [], text: `Tap twice: back to the last checkpoint, +${RESET_PENALTY_MS / 1000} s.` },
        { label: "Compass", keys: [], text: "Which way the bonnet points, like 042° NE. “Head north” is a call your Navigator can make." },
        { label: "Speedo", keys: [], text: "Your speed, and D or R for the way you're going." },
      ],
    };
  }
  const lines: BriefingLine[] = [];
  if (a.camera3d) {
    lines.push(
      s.camera === "free"
        ? { label: "Camera", keys: [["Y"]], text: "Cycles top-down, chase and bonnet." }
        : { label: "Camera", keys: [], text: `${CAMERA_LABELS[s.camera]} only, this race.` },
      { label: "Zoom", keys: [["−", "="]], text: "Out and in." },
      { label: "Rotate", keys: [["C"]], text: "Turns the view with the car, or back to north up." },
      { label: "Map", keys: [["M"]], text: "Opens the big map, or tap the corner map. Esc, or a tap outside it, closes it." },
      { label: "Guess pin", keys: [], text: "On the big map, tap where you think the car is. A long press clears it. Your closest guess makes the results." },
    );
  } else {
    lines.push(
      { label: "Map", keys: [], text: "No camera this race: the map is your whole view." },
      { label: "Guess pin", keys: [], text: "Tap the map where you think the car is. A long press clears it. Your closest guess makes the results." },
    );
  }
  if (a.liveMarker) lines.push({ label: "GPS", keys: [["G"]], text: "The car's live dot on the map. G hides or shows it." });
  if (a.tripMeter) lines.push({ label: "Trip meter", keys: [], text: "Metres driven, top bar. Wrong turns count too." });
  if (a.paceNotes) lines.push({ label: "Pace notes", keys: [], text: "Notes, top bar: the stage's notes in order. Tap a line to keep your place." });
  lines.push(
    { label: "Sound", keys: [["N"]], text: "Mutes the engine." },
    { label: "Pause", keys: [], text: `There isn't one. If a phone drops, your clock stops for up to ${RACE_GRACE_MS / 1000} s while it reconnects.` },
  );
  return {
    title: "You see it all. Touch nothing.",
    lead: "Your Driver has pedals and a compass and no road. Call the corners early; say what's coming, not what just went by.",
    lines,
  };
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
    // Practice has one car and nobody to outvote: the host picks, no field.
    ...(s.mode === "practice"
      ? []
      : [{
          key: "trackPick",
          label: "Track",
          selected: pickIndex(TRACK_PICKS, s.trackPick),
          options: [
            { label: "Host picks", patch: { trackPick: "host" } },
            { label: "Team vote", patch: { trackPick: "ballot" } },
          ],
          hint: s.trackPick === "ballot"
            ? "One vote per car, by its captain; a tie goes to a coin flip"
            : "Picked on the teams screen, before ready-up",
        } satisfies SettingField]),
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
      key: "assists",
      label: "Assists",
      selected: pickIndex(ASSIST_PRESETS, s.assists),
      // Custom starts from whatever's in force now, so it's a tweak, not a reset.
      options: ASSIST_PRESETS.map((p) => ({ label: PRESET_LABELS[p], patch: p === "custom" ? { assists: p, ...effectiveAssists(s) } : { assists: p } })),
      hint: onOff(effectiveAssists(s)),
    },
    ...(s.assists === "custom"
      ? ASSIST_KEYS.map((k): SettingField => ({
          key: k,
          label: ASSIST_LABELS[k],
          selected: s[k] ? 0 : 1,
          options: [
            { label: "On", patch: { [k]: true } },
            { label: "Off", patch: { [k]: false } },
          ],
          ...(k === "liveMarker" && { hint: s[k] ? "The Navigator's map shows the car" : "The map never moves: find yourselves" }),
          ...(k === "tripMeter" && { hint: "Metres driven, detours and all" }),
          ...(k === "camera3d" && { hint: s[k] ? "The Navigator sees the car and the road" : "Map only. Punishing, on purpose" }),
        }))
      : []),
    {
      key: "weather",
      label: "Weather",
      selected: pickIndex(WEATHERS, s.weather),
      options: WEATHERS.map((w) => ({ label: WEATHER_LABELS[w], patch: { weather: w } })),
      hint: s.weather === "clear" ? "Nothing in the way" : "Mist hides bits of road; same sky for every team",
    },
  ];
}
