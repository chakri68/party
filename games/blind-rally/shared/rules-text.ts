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
  "You play in teams of 2. One player is the Driver. The other player is the Navigator.",
  "The Driver controls the car. The Driver cannot see the road.",
  "The Navigator sees the road and the car. The Navigator cannot control the car.",
  "Talk out loud to each other. Sit in the same room, or use a phone call.",
  "The Navigator tells the Driver what to do. For example: \"Turn left now.\" \"Stop, tree ahead!\"",
  "The host presses Start. Then each player chooses a seat.",
  "There can be up to 4 teams. Each team has 1 Driver and 1 Navigator.",
  "The host can move players to other seats.",
  "Press Ready when you are in your seat.",
  "The game counts down: 3, 2, 1, go. All cars start at the same time. All teams use one clock.",
  "A checkpoint is a marked point on the road. You must pass the checkpoints in order.",
  "Pass every checkpoint first. Then cross the finish line.",
  "If the car gets stuck, the Driver can reset the car. The car goes back to the last checkpoint.",
  "A reset adds 5 seconds to your time. The car waits a moment before it can move.",
  "If a phone loses connection, your team's clock stops. Your team gets 30 seconds to connect again.",
  "After 30 seconds, your team gets a DNF. DNF means \"did not finish\".",
  "Assists give the Navigator extra help. The host chooses the assists.",
  "Live car marker: the map shows the car as a dot.",
  "Trip meter: the Navigator sees how far the car has gone.",
  "Pace notes: the Navigator gets written notes about each turn.",
  "3D camera: the Navigator sees the car and the road.",
  "Classic: the live car marker is off. The other assists are on.",
  "Nightmare: every assist is off. The Navigator only gets a map.",
  "The host chooses the track, or the teams vote. Each team gets 1 vote. The team captain gives the vote.",
  "If the vote is a tie, a coin toss decides. Everyone sees the result.",
  "If the host changes the track, each Navigator must press Ready again. The new track loads when the Navigator presses Ready.",
  "Solo stage: each car drives on its own copy of the road.",
  "Shared stage: all cars drive on one road. Navigators see the other cars as ghosts. A ghost car cannot hit your car.",
  "You can follow another team's car. But that team may be lost too.",
  "Each team has a colour, a shape and a number. The team's car and seats show these.",
  "The team with the fastest time wins.",
  "If time runs out, every team still driving gets a DNF.",
  "Practice is for 1 team. There are no other cars. The clock rules are the same.",
];

const pickIndex = <T>(options: readonly T[], value: T) => Math.max(0, options.indexOf(value));

const CAMERA_LABELS: Record<CameraPolicy, string> = { free: "Any", topdown: "Top-down", chase: "Chase", bonnet: "Bonnet" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "Clear", patchy: "Some mist", murky: "Misty" };
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
  const how = ballot ? "chosen by vote" : "chosen by host";
  return [
    {
      label: "Track",
      value: track
        ? `${track.name}, ${how}${track.tie ? " (tie, so coin toss)" : ""}`
        : ballot ? "Teams vote, 1 vote per car" : "The host chooses",
    },
    { label: "Stage", value: s.mode === "practice" ? "Practice, 1 team" : s.stageMode === "shared" ? "Shared: 1 road, other cars are ghosts" : "Solo: each car has its own road" },
    { label: "Time limit", value: `${s.timeLimit} min, then DNF` },
    { label: "Assists", value: `${PRESET_LABELS[s.assists]}: ${onOff(a)}` },
    { label: "Navigator camera", value: !a.camera3d ? "None, only the map" : s.camera === "free" ? "Any of the 3" : `${CAMERA_LABELS[s.camera]} only` },
    { label: "Weather", value: WEATHER_LABELS[s.weather] },
    { label: "Reset", value: `+${RESET_PENALTY_MS / 1000} s. The car goes back to the last checkpoint.` },
    { label: "Lost connection", value: `The clock stops. You get ${RACE_GRACE_MS / 1000} s to connect again.` },
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
      title: "You drive, but you cannot see.",
      lead: "You cannot see the road. Your Navigator can see the road. Listen to your Navigator. Tell your Navigator what you are doing.",
      lines: [
        { label: "Steer", keys: [["A", "D"], ["←", "→"]], text: "Hold Left or Right. These pads are under your left thumb." },
        { label: "Go", keys: [["W"], ["↑"]], text: "Hold the tall pad under your right thumb." },
        { label: "Brake", keys: [["S"], ["↓"]], text: "Hold the wide pad. Keep holding the pad after you stop. Then the car goes backwards." },
        { label: "Reset car", keys: [], text: `Tap twice. The car goes back to the last checkpoint. You get ${RESET_PENALTY_MS / 1000} s added to your time.` },
        { label: "Compass", keys: [], text: "The compass shows which way the car faces, like 042° NE. Your Navigator can say “go north”." },
        { label: "Speedometer", keys: [], text: "The speedometer shows your speed. D means forward. R means backwards." },
      ],
    };
  }
  const lines: BriefingLine[] = [];
  if (a.camera3d) {
    lines.push(
      s.camera === "free"
        ? { label: "Camera", keys: [["Y"]], text: "Changes the view: top-down, chase (behind the car) or bonnet (on the car)." }
        : { label: "Camera", keys: [], text: `${CAMERA_LABELS[s.camera]} only in this race.` },
      { label: "Zoom", keys: [["−", "="]], text: "Makes the view bigger or smaller." },
      { label: "Rotate", keys: [["C"]], text: "Turns the map with the car. Press C again to keep north at the top." },
      { label: "Map", keys: [["M"]], text: "Opens the big map. You can also tap the small map. Press Esc or tap outside the map to close the map." },
      { label: "Guess pin", keys: [], text: "On the big map, tap where you think the car is. Press and hold to remove the pin. The results show your closest guess." },
    );
  } else {
    lines.push(
      { label: "Map", keys: [], text: "This race has no camera. You only have the map." },
      { label: "Guess pin", keys: [], text: "Tap the map where you think the car is. Press and hold to remove the pin. The results show your closest guess." },
    );
  }
  if (a.liveMarker) lines.push({ label: "GPS", keys: [["G"]], text: "The map shows the car as a dot. Press G to hide or show the dot." });
  if (a.tripMeter) lines.push({ label: "Trip meter", keys: [], text: "The top bar shows how many metres the car has gone. Wrong turns count too." });
  if (a.paceNotes) lines.push({ label: "Pace notes", keys: [], text: "Tap Notes in the top bar. You see a note for each turn, in order. Tap a line to mark your place." });
  lines.push(
    { label: "Sound", keys: [["N"]], text: "Turns the engine sound off or on." },
    { label: "Pause", keys: [], text: `You cannot pause. If a phone loses connection, your clock stops. The clock waits up to ${RACE_GRACE_MS / 1000} s.` },
  );
  return {
    title: "You see everything. You cannot drive.",
    lead: "Your Driver cannot see the road. Tell your Driver about each turn early. Say what is coming next.",
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
        ? "1 team, no other cars"
        : cars >= 2 ? `Up to ${cars} cars can race` : "1 team races the clock. 2 or more teams race each other",
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
        ? "All cars use 1 road. Other cars are ghosts"
        : "Each car has its own road",
    },
    // Practice has one car and nobody to outvote: the host picks, no field.
    ...(s.mode === "practice"
      ? []
      : [{
          key: "trackPick",
          label: "Track",
          selected: pickIndex(TRACK_PICKS, s.trackPick),
          options: [
            { label: "Host chooses", patch: { trackPick: "host" } },
            { label: "Team vote", patch: { trackPick: "ballot" } },
          ],
          hint: s.trackPick === "ballot"
            ? "Each team captain gives 1 vote. A coin toss decides a tie"
            : "The host chooses on the teams screen",
        } satisfies SettingField]),
    {
      key: "timeLimit",
      label: "Time limit",
      selected: pickIndex(TIME_LIMITS, s.timeLimit),
      options: TIME_LIMITS.map((m) => ({ label: `${m} min`, patch: { timeLimit: m } })),
      hint: "Cars still driving then get a DNF",
    },
    {
      key: "camera",
      label: "Navigator camera",
      selected: pickIndex(CAMERA_POLICIES, s.camera),
      options: CAMERA_POLICIES.map((c) => ({ label: CAMERA_LABELS[c], patch: { camera: c } })),
      hint: s.camera === "free" ? "The Navigator chooses top-down, chase or bonnet" : `${CAMERA_LABELS[s.camera]} only`,
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
          ...(k === "liveMarker" && { hint: s[k] ? "The Navigator's map shows the car" : "The map does not show the car" }),
          ...(k === "tripMeter" && { hint: "Shows metres driven. Wrong turns count too" }),
          ...(k === "camera3d" && { hint: s[k] ? "The Navigator sees the car and the road" : "The Navigator only gets the map. This is very hard" }),
        }))
      : []),
    {
      key: "weather",
      label: "Weather",
      selected: pickIndex(WEATHERS, s.weather),
      options: WEATHERS.map((w) => ({ label: WEATHER_LABELS[w], patch: { weather: w } })),
      hint: s.weather === "clear" ? "You can see the whole road" : "Mist hides parts of the road. All teams get the same weather",
    },
  ];
}
