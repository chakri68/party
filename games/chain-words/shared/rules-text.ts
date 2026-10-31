import type { SettingField } from "@games/game-core";
import { type ChainWordsSettings, DEFAULT_SETTINGS, LIVES_OPTIONS, TURN_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const chainWordsRules: string[] = [
  "Players take turns. Each player adds 1 word to a chain of words.",
  "Your word must start with the last letter of the word before.",
  "For example: ROCKET, then TIGER, then RIVER.",
  "Use real English words only.",
  "Each word must have 3 letters or more.",
  "You can use each word only once in a game.",
  "If the game rejects your word, try another word. The clock keeps running.",
  "If your time runs out, you lose 1 life.",
  "After that, the next player gets the same letter.",
  "If you lose all your lives, you are out of the game.",
  "Sometimes no words are left for a letter. Then the game gives a new letter. Nobody loses a life for this.",
  "The last player in the game wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function chainWordsSettingFields(raw: unknown): SettingField[] {
  const settings: ChainWordsSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<ChainWordsSettings> | null) };
  return [
    {
      key: "turnSeconds",
      label: "Clock",
      selected: Math.max(0, TURN_OPTIONS.indexOf(settings.turnSeconds)),
      options: TURN_OPTIONS.map((n) => ({ label: `${n} s`, patch: { turnSeconds: n } })),
      hint: settings.turnSeconds <= 5 ? "No time to think" : settings.turnSeconds >= 12 ? "Some time to think" : "A few seconds for each word",
    },
    {
      key: "lives",
      label: "Lives",
      selected: Math.max(0, LIVES_OPTIONS.indexOf(settings.lives)),
      options: LIVES_OPTIONS.map((n) => ({ label: String(n), patch: { lives: n } })),
      hint: settings.lives === 1 ? "One slow turn and you are out" : `You are out after ${settings.lives} slow turns`,
    },
  ];
}
