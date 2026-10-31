import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, POINTS_OPTIONS, type ThornsSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const thornsRules: string[] = [
  "Everyone holds four discs: three roses and one thorn. Nobody sees anyone else's.",
  "To start a round, everyone puts one disc face down on their mat, all at once.",
  "Then, in turn, put another disc on top of your stack, or bid how many discs you can flip without hitting a thorn. Out of discs in hand? You have to bid.",
  "Once anyone bids, nobody places any more. Each player raises or passes, and a pass is for the rest of the round.",
  "The top bidder flips: their own stack first, all of it, then the top disc of anyone else's, one at a time, their pick.",
  "Reach the bid on roses alone and you score a point. Two points wins.",
  "Hit a thorn and you lose one of your discs at random. Only you find out which. Lose them all and you're out.",
  "After a win the winner starts the next round. After a thorn, its owner does. Last player with discs also wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function thornsSettingFields(raw: unknown, _players: number): SettingField[] {
  const settings: ThornsSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<ThornsSettings> | null) };
  return [
    {
      key: "pointsToWin",
      label: "Points to win",
      selected: Math.max(0, (POINTS_OPTIONS as readonly number[]).indexOf(settings.pointsToWin)),
      options: POINTS_OPTIONS.map((n) => ({ label: `${n} points`, patch: { pointsToWin: n } })),
      hint: settings.pointsToWin === 3 ? "A longer game" : "Two clean flips and you're done",
    },
  ];
}
