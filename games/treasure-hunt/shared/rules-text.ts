import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, parseTHSettings } from "./types.ts";
import { TIMED_MINUTES } from "./world.ts";

/** Plain-language rules for the lobby's Rules button. */
export const treasureHuntRules: string[] = [
  "You need a computer with a keyboard. It does not work on phones.",
  "Every round is a new map. Everyone starts at the same place.",
  "Move with W, A, S and D. Move the mouse to look. Hold Shift to run. Press Space to jump.",
  "Press E to get in or out of the buggy. R puts the buggy back on its wheels if it flips or gets stuck.",
  "Hidden caches are not in this version yet. For now, you can only explore.",
  "The host ends the round when everyone is done.",
];

/** What the lobby shows (and the host can change) before a game. */
export function treasureHuntSettingFields(raw: unknown, _players: number): SettingField[] {
  const s = parseTHSettings(raw) ?? DEFAULT_SETTINGS;
  return [
    {
      key: "minutes",
      label: "Round length",
      selected: Math.max(0, TIMED_MINUTES.indexOf(s.minutes)),
      options: TIMED_MINUTES.map((m) => ({ label: `${m} minutes`, patch: { minutes: m } })),
    },
  ];
}
