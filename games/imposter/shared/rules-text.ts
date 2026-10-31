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
  "Each round, 1 player is the Imposter. The other players are Innocents.",
  "The game does not say who the Imposter is.",
  "Typed clues mode is the normal mode.",
  "In Typed clues mode, the other players get a secret word and its category. The Imposter gets only the category.",
  "All players type 1 short clue at the same time.",
  "Show that you know the word. Do not say the word.",
  "The Imposter must pretend to know the word.",
  "The game shows all the clues together, mixed up. Then all players talk.",
  "In Spoken mode, the other players get a secret place. The Imposter gets nothing.",
  "Every screen shows the full list of places.",
  "In Spoken mode, nobody types. Players ask each other questions out loud. The host sets the time.",
  "The game chooses 1 player to ask first. After that, any player can ask.",
  "Answer so the others know you know the place. Do not tell the Imposter the place.",
  "Once each round, the Imposter can tap \"I know where we are\". This stops the clock.",
  "Then the Imposter chooses a place. If the Imposter is right, the Imposter wins the round. If the Imposter is wrong, the other players win the round.",
  "This button is on every screen. So the button proves nothing.",
  "Then all players vote for the Imposter. You cannot vote for yourself.",
  "If there is a tie, players vote again. This vote is only between the tied players.",
  "If there is still a tie, the game picks 1 of them at random. The game does the same if nobody votes.",
  "If the players catch the Imposter, the Imposter gets 1 guess. The Imposter guesses the word, or picks the place from the list.",
  "If the guess is right, the Imposter wins the round.",
  "If the players catch the Imposter and the guess is wrong, every Innocent gets 2 points.",
  "In every other case, the Imposter gets 2 points.",
  "The player with the most points after the last round wins.",
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
      key: "mode",
      label: "Mode",
      selected: Math.max(0, MODE_OPTIONS.indexOf(modeOf(settings))),
      options: MODE_OPTIONS.map((m) => ({ label: m === "spoken" ? "Spoken, places" : "Typed clues", patch: { mode: m } })),
      hint: spoken ? "Talk out loud. No typing." : "A word. Each player types 1 clue.",
    },
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
          hint: "The host can end it early",
        }
      : {
          key: "discussSeconds",
          label: "Talking time",
          selected: Math.max(0, DISCUSS_OPTIONS.indexOf(settings.discussSeconds)),
          options: DISCUSS_OPTIONS.map((n) => ({ label: `${n} s`, patch: { discussSeconds: n } })),
          hint: "The host can end it early",
        },
  ];
}
