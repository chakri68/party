import type { SettingField } from "@games/game-core";
import {
  DEFAULT_SETTINGS,
  DISCUSS_OPTIONS,
  type ImposterSettings,
  MODE_OPTIONS,
  modeOf,
  ROUND_OPTIONS,
  TALK_OPTIONS,
  talkMinutesOf,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). Both modes. */
export const imposterRules: string[] = [
  "Every round, one of you is the Imposter. Nobody's told who.",
  "Typed clues (the default): everyone else gets a secret word and its category; the Imposter only gets the category.",
  "Everyone types one short clue at once. Prove you know the word without giving it away. The Imposter bluffs. The clues go up together, shuffled, then you talk it over.",
  "Spoken: everyone else gets a secret place; the Imposter gets nothing. Every screen shows the full list of places.",
  "Nobody types. Ask each other questions out loud, for the host's few minutes. Someone's suggested to ask first; after that, anyone. Answer so the others know you've been there, without telling the Imposter where.",
  "Once a round, the Imposter can tap \"I know where we are\" to stop the clock and pick a place. Right takes the round; wrong hands it to everyone else. The button's on every screen, so having it proves nothing.",
  "Then vote for who you think the Imposter is. Not yourself. A tie goes to a runoff between the leaders.",
  "Catch the Imposter and they get one guess at the word (or the place, off the list). Right, and they steal the round.",
  "A catch that sticks: 2 points to every innocent. Anything else: 2 to the Imposter.",
  "Most points after the last round wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function imposterSettingFields(raw: unknown): SettingField[] {
  const settings: ImposterSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<ImposterSettings> | null) };
  const spoken = modeOf(settings) === "spoken";
  // Reveal, clues, voting and the result add about two minutes to the talking;
  // spoken mode skips the clues.
  const talk = spoken ? talkMinutesOf(settings) * 60 + 60 : settings.discussSeconds + 120;
  const minutes = Math.round((settings.rounds * talk) / 60);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUND_OPTIONS.indexOf(settings.rounds)),
      options: ROUND_OPTIONS.map((n) => ({ label: String(n), patch: { rounds: n } })),
      hint: `Up to ~${minutes} min`,
    },
    spoken
      ? {
          key: "talkMinutes",
          label: "Talking time",
          selected: Math.max(0, TALK_OPTIONS.indexOf(talkMinutesOf(settings))),
          options: TALK_OPTIONS.map((n) => ({ label: `${n} min`, patch: { talkMinutes: n } })),
          hint: "The host can cut it short",
        }
      : {
          key: "discussSeconds",
          label: "Talking time",
          selected: Math.max(0, DISCUSS_OPTIONS.indexOf(settings.discussSeconds)),
          options: DISCUSS_OPTIONS.map((n) => ({ label: `${n} s`, patch: { discussSeconds: n } })),
          hint: "The host can cut it short",
        },
    {
      key: "mode",
      label: "Mode",
      selected: Math.max(0, MODE_OPTIONS.indexOf(modeOf(settings))),
      options: MODE_OPTIONS.map((m) => ({ label: m === "spoken" ? "Spoken, places" : "Typed clues", patch: { mode: m } })),
      hint: spoken ? "Talk out loud; no typing" : "A word, one typed clue each",
    },
  ];
}
