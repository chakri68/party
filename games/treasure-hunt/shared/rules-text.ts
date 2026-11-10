import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, parseTHSettings } from "./types.ts";
import { TIMED_MINUTES } from "./world.ts";

/** Plain-language rules for the lobby's Rules button. */
export const treasureHuntRules: string[] = [
  "You need a computer with a keyboard. It does not work on phones.",
  "Every round is a new map. Everyone starts at the same place.",
  "You get a list of clues. Each clue points to one hidden cache. Find as many as you can before the time runs out.",
  "A clue names a place on the map, says the cache is between two places, or gives a distance and a direction from a place.",
  "Directions are in degrees. 0° is north, 90° is east. The strip at the top of the screen shows where you are facing.",
  "A cache shows up when you are close to it. Walk up to it and press E to pick it up. You must be on foot, not in the buggy.",
  "Move with W, A, S and D. Move the mouse to look. Hold Shift to run. Press Space to jump.",
  "Press E to get in or out of the buggy. R puts the buggy back on its wheels if it flips or gets stuck.",
  "The round ends when the time runs out, or when everyone has found all their caches. The host can also end it early.",
  "The player who finds the most caches wins. If two players find the same number, harder caches count more. If it is still a tie, the one who found their last cache first wins.",
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
