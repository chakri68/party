import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type DontSayItSettings, TURN_SECONDS_OPTIONS, TURNS_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const dontSayItRules: string[] = [
  "Two teams, Amber and Teal. Switch sides before the start if you like; the host can shuffle.",
  "Teams take turns. One of you describes, out loud, and the rest of your team guesses.",
  "The card has the word and five more you can't say either. No rhymes, no spelling, no pointing at things.",
  "Got it: +1. Skip: 0. Oops (you said one): −1. Then the next card.",
  "The other team sees the card too. If they hear a slip, they buzz and the clock stops.",
  "Fair: −1. Contest it and the other team's captain decides: uphold it (−1) or drop it and carry on.",
  "A team's total never goes below 0. Most points after the last turn wins. A tie gets one more turn each.",
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
