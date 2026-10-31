import type { SettingField } from "@games/game-core";
import { type BluffSettings, DEFAULT_SETTINGS, REVEAL_MS, ROUND_OPTIONS, type Variant, VOTE_MS, WRITE_MS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const fakeWordRules: string[] = [
  "Each round, you see the meaning of a real English word. You do not see the word.",
  "Make up a word for this meaning. Use 3 to 18 letters.",
  "You cannot use a real word. You cannot use a word very close to a real word.",
  "The game shows all the fake words and the real word together. The words are mixed up. No names are shown.",
  "Vote for the word you think is real. You cannot vote for your own word.",
  "If you choose the real word, you get 2 points.",
  "You also get 1 point for each player who chooses your fake word.",
  "The player with the most points after the last round wins.",
];

export const bluffDefinitionsRules: string[] = [
  "Each round, you see a real English word. Few people know this word. You do not see its meaning.",
  "Write a fake meaning for the word. Use 15 to 180 characters.",
  "The game shows all the fake meanings and the real meaning together. The meanings are mixed up. No names are shown.",
  "The game writes all the meanings in the same style.",
  "Vote for the meaning you think is real. You cannot vote for your own meaning.",
  "If you choose the real meaning, you get 2 points.",
  "You also get 1 point for each player who chooses your fake meaning.",
  "The player with the most points after the last round wins.",
];

function settingFields(variant: Variant, raw: unknown): SettingField[] {
  const settings: BluffSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<BluffSettings> | null) };
  // Writing, voting and a look at the reveal, at most.
  const minutes = Math.round((settings.rounds * (WRITE_MS[variant] + VOTE_MS + REVEAL_MS)) / 60_000);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUND_OPTIONS.indexOf(settings.rounds)),
      options: ROUND_OPTIONS.map((n) => ({ label: String(n), patch: { rounds: n } })),
      hint: `Up to ~${minutes} min`,
    },
  ];
}

export const fakeWordSettingFields = (raw: unknown): SettingField[] => settingFields("fake-word", raw);
export const bluffDefinitionsSettingFields = (raw: unknown): SettingField[] => settingFields("bluff-definitions", raw);
