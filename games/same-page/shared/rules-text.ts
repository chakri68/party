import type { SettingField } from "@games/game-core";
import { ANSWER_SECONDS_OPTIONS, DEFAULT_SETTINGS, ROUNDS_OPTIONS, TIDY_MS, type SamePageSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const samePageRules: string[] = [
  "A prompt goes up: \"The best biscuit\", \"A number from 1 to 10\".",
  "Everyone types one answer in secret before the timer runs out. You can change it until then.",
  "Matching answers are grouped: case, \"a/the\", plurals and one-letter typos don't count against you.",
  "The host can then merge groups the machine missed (\"telly\" into \"tv\"), and split them again.",
  "Everyone in the biggest group scores 1. Groups tied for biggest all score. A group of one never does.",
  "With Lone answer on: if exactly one person is alone with their answer, they lose a point (never below 0).",
  "After the last prompt, the most points wins. Ties share it.",
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
      hint: "Drops to 5 seconds once everyone's in",
    },
    {
      key: "lone",
      label: "Lone answer",
      selected: s.lone ? 1 : 0,
      options: [
        { label: "Off", patch: { lone: false } },
        { label: "Costs a point", patch: { lone: true } },
      ],
      hint: s.lone ? "The only odd one out loses a point" : "Odd ones out just miss out",
    },
  ];
}
