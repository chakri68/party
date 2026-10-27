import type { SettingField } from "@games/game-core";
import { type BluffSettings, DEFAULT_SETTINGS, REVEAL_MS, ROUND_OPTIONS, type Variant, VOTE_MS, WRITE_MS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const fakeWordRules: string[] = [
  "Every round, you get the meaning of a real, uncommon English word. Not the word.",
  "Make up a word that could mean it: 3 to 18 letters. Real words and near misses are turned away.",
  "Your fakes go up with the real word, shuffled, no names.",
  "Vote for the one you think is real. Not your own.",
  "Find the real one: 2 points. Each player your fake fools: 1 point to you.",
  "Most points after the last round wins.",
];

export const bluffDefinitionsRules: string[] = [
  "Every round, you get a real, uncommon English word. Not its meaning.",
  "Write a meaning that could pass for the real one: 15 to 180 characters.",
  "Your fakes go up with the real meaning, shuffled, no names, all in the same style.",
  "Vote for the one you think is real. Not your own.",
  "Find the real one: 2 points. Each player your fake fools: 1 point to you.",
  "Most points after the last round wins.",
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
