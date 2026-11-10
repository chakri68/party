import type { SettingField } from "@games/game-core";

/** Plain-language rules for the lobby's Rules button. */
export const treasureHuntRules: string[] = [
  "You need a computer with a keyboard. It does not work on phones.",
  "Every round is a new map. Everyone starts at the same place.",
  "Move with W, A, S and D. Move the mouse to look. Hold Shift to run. Press Space to jump.",
  "Press E to get in or out of the buggy. R puts the buggy back on its wheels if it flips or gets stuck.",
  "Hidden caches are not in this version yet. For now, you can only explore.",
  "The host ends the round when everyone is done.",
];

/** No settings in M1. */
export function treasureHuntSettingFields(_raw: unknown, _players: number): SettingField[] {
  return [];
}
