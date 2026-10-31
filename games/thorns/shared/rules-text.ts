import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, POINTS_OPTIONS, type ThornsSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const thornsRules: string[] = [
  "Each player has 4 discs: 3 roses and 1 thorn. You can see only your own discs.",
  "Each player has a mat. The discs on your mat make your stack.",
  "At the start of a round, everyone puts 1 disc face down on their mat.",
  "Then players take turns. On your turn, put 1 more disc on your stack. Or make a bid.",
  "A bid is a number. Say how many discs you can turn over without finding a thorn.",
  "You must bid if you have no discs left in your hand.",
  "After the first bid, nobody puts down more discs.",
  "Each player says a bigger number or passes. If a player passes, that player cannot bid again this round.",
  "The player with the biggest bid turns over discs. First, this player turns over all the discs in their own stack.",
  "Next, this player turns over the top disc of other stacks, one at a time. This player chooses the stacks.",
  "If every disc is a rose, the player gets 1 point. The first player to get 2 points wins. The host can change this to 3.",
  "If the player finds a thorn, the player loses 1 disc. The game picks the disc. Only that player sees which disc.",
  "A player with no discs left is out of the game.",
  "After a point, the same player starts the next round. After a thorn, the thorn's owner starts.",
  "The last player with discs also wins.",
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
      hint: settings.pointsToWin === 3 ? "A longer game" : "Win 2 rounds to win the game",
    },
  ];
}
