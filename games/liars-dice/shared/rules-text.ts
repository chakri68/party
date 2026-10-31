import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, STARTING_DICE_OPTIONS, type LiarsDiceSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). Also known as Perudo, or Dudo. */
export const liarsDiceRules: string[] = [
  "Everyone starts with five dice under a cup (fewer if the host says so). Each round, everyone rolls in secret and sees only their own.",
  "Take turns bidding on what's under all the cups together: \"four 3s\" means at least four dice show a 3.",
  "On your turn, raise (more dice, or the same number of a higher face) or call the last bid a lie.",
  "Call \"Liar!\" and everyone's dice come up. If the bid was there, you lose a die. If it wasn't, the bidder does.",
  "Call \"Spot on\" if you think the bid is exactly right. Right, and you get a die back. Wrong, and you lose one.",
  "Wild ones: 1s count as every face. Bidding on 1s takes half as many (rounded up); coming off them takes double plus one. A bid on 1s counts only 1s.",
  "Whoever lost a die starts the next round. Run out of dice and you're out. Last one with dice wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function liarsDiceSettingFields(raw: unknown, players: number): SettingField[] {
  const s: LiarsDiceSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<LiarsDiceSettings> | null) };
  const n = Math.max(players, 2);
  return [
    {
      key: "wildOnes",
      label: "Wild ones",
      selected: s.wildOnes ? 0 : 1,
      options: [
        { label: "On", patch: { wildOnes: true } },
        { label: "Off", patch: { wildOnes: false } },
      ],
      hint: s.wildOnes ? "1s count as any face" : "1 is just the lowest face",
    },
    {
      key: "spotOn",
      label: "Spot on",
      selected: s.spotOn ? 0 : 1,
      options: [
        { label: "On", patch: { spotOn: true } },
        { label: "Off", patch: { spotOn: false } },
      ],
      hint: s.spotOn ? "Call the bid exact to win a die back" : "Raise or call liar, nothing else",
    },
    {
      key: "startingDice",
      label: "Starting dice",
      selected: Math.max(0, (STARTING_DICE_OPTIONS as readonly number[]).indexOf(s.startingDice)),
      options: STARTING_DICE_OPTIONS.map((d) => ({ label: `${d} dice`, patch: { startingDice: d } })),
      hint: `${s.startingDice * n} dice on the table`,
    },
  ];
}
