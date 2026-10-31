import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, STARTING_DICE_OPTIONS, type LiarsDiceSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). Also known as Perudo, or Dudo. */
export const liarsDiceRules: string[] = [
  "Each player starts with 5 dice under a cup. The host can choose fewer dice.",
  "Each round, all players roll their dice at the same time. You can see only your own dice.",
  "Players take turns to bid. A bid is a guess about all the dice on the table.",
  "For example, \"four 3s\" means at least 4 dice on the table show a 3.",
  "On your turn, you can raise the bid. Say more dice, or say the same number of dice with a higher face.",
  "You can also call \"Liar!\" Call \"Liar!\" if you think the last bid is wrong.",
  "After a call, all players show their dice.",
  "If the bid is true, the caller loses 1 die. If the bid is false, the bidder loses 1 die.",
  "Call \"Spot on\" if you think the bid is exactly right.",
  "If you are right, you get 1 die back. If you are wrong, you lose 1 die.",
  "Wild ones: a 1 counts as any face.",
  "A bid on 1s needs half as many dice. Round the number up.",
  "To move from 1s to another face, double the count and add 1.",
  "A bid on 1s counts only the 1s.",
  "The player who lost a die starts the next round.",
  "If you lose all your dice, you are out.",
  "The last player with dice wins.",
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
      hint: s.wildOnes ? "1s count as any face" : "1 is the lowest face",
    },
    {
      key: "spotOn",
      label: "Spot on",
      selected: s.spotOn ? 0 : 1,
      options: [
        { label: "On", patch: { spotOn: true } },
        { label: "Off", patch: { spotOn: false } },
      ],
      hint: s.spotOn ? "Say the bid is exact. Get 1 die back." : "You can only raise or call Liar",
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
