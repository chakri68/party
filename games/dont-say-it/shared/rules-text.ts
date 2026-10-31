import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type DontSayItSettings, TURN_SECONDS_OPTIONS, TURNS_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const dontSayItRules: string[] = [
  "The game has 2 teams: Amber and Teal.",
  "You can change your team before the game starts. The host can mix up the teams.",
  "The teams take turns.",
  "On your team's turn, 1 player describes a word out loud. This player is the describer.",
  "The other players on the team guess the word.",
  "Each card shows the word and 5 more words. These 6 words are banned. You can't say them.",
  "You can't spell the word. You can't say a word that sounds like it. You can't point at things.",
  "Your team guesses the word: your team gets +1.",
  "You skip the card: your team gets 0.",
  "You say a banned word: your team gets −1.",
  "After each card, you get the next card.",
  "The other team can see the card too. If they hear a banned word, they press Buzz. The clock stops.",
  "You can agree with the buzz. Then your team gets −1.",
  "You can say the buzz is not fair. Then the other team's captain decides. The captain accepts the buzz (−1) or rejects it.",
  "A team's score never goes below 0.",
  "After the last turn, the team with more points wins.",
  "If the scores are equal, each team plays 1 more turn.",
  "If the scores are still equal, both teams win.",
];

/** What the lobby shows (and the host can change) before a game. */
export function dontSayItSettingFields(raw: unknown): SettingField[] {
  const settings: DontSayItSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<DontSayItSettings> | null) };
  // About 20 s around each turn for the handover and the summary.
  const minutes = Math.round((2 * settings.turnsPerTeam * (settings.turnSeconds + 20)) / 60);
  return [
    {
      key: "turnSeconds",
      label: "Turn length",
      selected: Math.max(0, TURN_SECONDS_OPTIONS.indexOf(settings.turnSeconds)),
      options: TURN_SECONDS_OPTIONS.map((n) => ({ label: `${n} s`, patch: { turnSeconds: n } })),
    },
    {
      key: "turnsPerTeam",
      label: "Turns per team",
      selected: Math.max(0, TURNS_OPTIONS.indexOf(settings.turnsPerTeam)),
      options: TURNS_OPTIONS.map((n) => ({ label: String(n), patch: { turnsPerTeam: n } })),
      hint: `About ${minutes} min`,
    },
  ];
}
