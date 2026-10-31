import type { SettingField } from "@games/game-core";
import { ANSWER_SECONDS_OPTIONS, DEFAULT_SETTINGS, ROUNDS_OPTIONS, TIDY_MS, type SamePageSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const samePageRules: string[] = [
  "The game shows a question, like \"The best biscuit\" or \"A number from 1 to 10\".",
  "Each player types 1 answer in secret. You must answer before the timer ends.",
  "You can change your answer until the timer ends.",
  "The game puts matching answers in groups. Small differences do not matter.",
  "These differences do not matter: capital letters, \"a\" or \"the\", plurals, and a 1-letter spelling mistake.",
  "Then the host can join 2 groups with the same meaning, like \"telly\" and \"tv\". The host can also split those groups again.",
  "Each player in the biggest group gets 1 point. If 2 groups tie for biggest, players in both groups get 1 point.",
  "A group with only 1 player never gets points.",
  "A lone answer is an answer that matches no other answer.",
  "The Lone answer setting can be on. Then, if only 1 player has a lone answer, that player loses 1 point. A score never goes below 0.",
  "After the last question, the player with the most points wins. Tied players share the win.",
];

/** What the lobby shows (and the host can change) before a game. */
export function samePageSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: SamePageSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<SamePageSettings> | null) };
  // A round's answer time, most of the tidy-up and a few seconds of reveal.
  const minutes = Math.round((s.rounds * (s.answerSeconds + TIDY_MS / 2000 + 6)) / 60);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUNDS_OPTIONS.indexOf(s.rounds)),
      options: ROUNDS_OPTIONS.map((n) => ({ label: `${n} prompts`, patch: { rounds: n } })),
      hint: `About ${minutes} minutes`,
    },
    {
      key: "answerSeconds",
      label: "Answer time",
      selected: Math.max(0, ANSWER_SECONDS_OPTIONS.indexOf(s.answerSeconds)),
      options: ANSWER_SECONDS_OPTIONS.map((n) => ({ label: `${n} seconds`, patch: { answerSeconds: n } })),
      hint: "When everyone has answered, the time drops to 5 seconds",
    },
    {
      key: "lone",
      label: "Lone answer",
      selected: s.lone ? 1 : 0,
      options: [
        { label: "Off", patch: { lone: false } },
        { label: "Lose 1 point", patch: { lone: true } },
      ],
      hint: s.lone ? "1 lone answer loses 1 point" : "A lone answer gets 0 points",
    },
  ];
}
