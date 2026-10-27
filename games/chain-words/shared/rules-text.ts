import type { SettingField } from "@games/game-core";
import { type ChainWordsSettings, DEFAULT_SETTINGS, LIVES_OPTIONS, TURN_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const chainWordsRules: string[] = [
  "One chain of words, built by everyone in turn.",
  "Each word starts with the last letter of the one before: ROCKET, TIGER, RIVER.",
  "Real English words, three letters at least. No word twice in a game, by anyone.",
  "Wrong word? It bounces. Try again, the clock's still going.",
  "Run out of time and you lose a life, and the next player takes the same letter. Lose them all and you're out.",
  "If a letter has no words left, it gets swapped for another. Nobody pays for that.",
  "Last one standing wins.",
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
      hint: settings.turnSeconds <= 5 ? "No time to think" : settings.turnSeconds >= 12 ? "Time to think, a bit" : "A word every few seconds",
    },
    {
      key: "lives",
      label: "Lives",
      selected: Math.max(0, LIVES_OPTIONS.indexOf(settings.lives)),
      options: LIVES_OPTIONS.map((n) => ({ label: String(n), patch: { lives: n } })),
      hint: settings.lives === 1 ? "One slow turn and you're out" : `Out on your ${settings.lives === 2 ? "second" : "third"} slow turn`,
    },
  ];
}
