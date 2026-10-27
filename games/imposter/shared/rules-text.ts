import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, DISCUSS_OPTIONS, type ImposterSettings, ROUND_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const imposterRules: string[] = [
  "Every round, one of you is the Imposter. Nobody's told who.",
  "Everyone else gets a secret word and its category. The Imposter only gets the category.",
  "Everyone types one short clue at once. Prove you know the word without giving it away. The Imposter bluffs.",
  "The clues go up together, in a shuffled order. Then talk it over.",
  "Vote for who you think the Imposter is. Not yourself. A tie goes to a runoff between the leaders.",
  "Catch the Imposter and they get one guess at the word. Right, and they steal the round.",
  "A catch that sticks: 2 points to every innocent. Anything else: 2 to the Imposter.",
  "Most points after the last round wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function imposterSettingFields(raw: unknown): SettingField[] {
  const settings: ImposterSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<ImposterSettings> | null) };
  // Reveal, clues, voting and the result add about two minutes to the talking.
  const minutes = Math.round((settings.rounds * (settings.discussSeconds + 120)) / 60);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUND_OPTIONS.indexOf(settings.rounds)),
      options: ROUND_OPTIONS.map((n) => ({ label: String(n), patch: { rounds: n } })),
      hint: `Up to ~${minutes} min`,
    },
    {
      key: "discussSeconds",
      label: "Talking time",
      selected: Math.max(0, DISCUSS_OPTIONS.indexOf(settings.discussSeconds)),
      options: DISCUSS_OPTIONS.map((n) => ({ label: `${n} s`, patch: { discussSeconds: n } })),
      hint: "The host can cut it short",
    },
  ];
}
