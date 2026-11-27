import { formatChips, type SettingField } from "@games/game-core";
import { bootFor } from "./rules.ts";
import {
  DEFAULT_SETTINGS,
  ENDING_OPTIONS,
  HANDS_PER_LEVEL_OPTIONS,
  POT_LIMIT_BOOTS,
  STARTING_CHIPS_OPTIONS,
  TURN_SECONDS_OPTIONS,
  type TeenPattiSettings,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const teenPattiRules: string[] = [
  "Each player starts with the same number of play chips. You do not use real money.",
  "The last player with chips wins the game.",
  "Each hand, every player puts in the boot. The boot is a small bet before the cards come.",
  "The boot goes up every few hands. So the game always ends.",
  "Each player gets 3 cards, face down.",
  "At the start you play Blind. Blind means you have not looked at your cards.",
  "On your turn you can tap See to look at your cards. Now you play Seen. Seeing is free, and you can still play this turn.",
  "The stake is the bet now. It starts at the boot.",
  "On your turn you can Pack. Pack means you give up this hand.",
  "Or you can Chaal. Chaal means you bet and stay in.",
  "A Blind player bets 1 or 2 times the stake. A Seen player bets 2 or 4 times the stake.",
  "If you bet the bigger amount, the stake doubles for everyone.",
  "When only 2 players are left, you can ask for a Show. A Show costs your normal bet. Both hands turn over, and the better hand wins the pot.",
  "In a Show, if both hands are equal, the player who asked for the Show loses.",
  "A Seen player can ask for a Sideshow with the player just before them, if that player is also Seen. A Sideshow costs your normal bet.",
  "The other player can say yes or no to a Sideshow. If they say yes, you 2 see each other's cards. The lower hand packs. If the hands are equal, the player who asked packs.",
  "If nobody answers a Sideshow in time, the answer is no.",
  "If you don't have enough chips for a bet, you can go all-in. Then you can only win what you matched from each player.",
  `When the pot reaches ${POT_LIMIT_BOOTS} times the boot, every hand still in turns over. The best hand wins.`,
  "If every other player packs, the last player wins the pot.",
  "Hands, best first: Trail, Pure sequence, Sequence, Color, Pair, High card.",
  "Trail: 3 cards of the same rank, like 7-7-7. A-A-A is the best.",
  "Pure sequence: 3 cards in a row, all in one suit.",
  "Sequence: 3 cards in a row, in any suits. A-K-Q is the best row. A-2-3 is next. Then K-Q-J, down to 4-3-2.",
  "Color: 3 cards of one suit, not in a row.",
  "Pair: 2 cards of the same rank.",
  "High card: none of these. Your top card counts.",
  "If two hands are the same kind, the higher cards win. If they are fully equal, they share the pot.",
  "If you lose all your chips, you are out.",
];

const SPEED_NAMES: Record<number, string> = { 10: "Slow", 6: "Normal", 4: "Fast" };

/** What the lobby shows (and the host can change) before a game. */
export function teenPattiSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: TeenPattiSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<TeenPattiSettings> | null) };
  const boot = bootFor(0);
  const index = <T>(list: readonly T[], value: T) => Math.max(0, list.indexOf(value));
  return [
    {
      key: "startingChips",
      label: "Starting chips",
      selected: index(STARTING_CHIPS_OPTIONS as readonly number[], s.startingChips),
      options: STARTING_CHIPS_OPTIONS.map((n) => ({ label: formatChips(n), patch: { startingChips: n } })),
      hint: `${s.startingChips / boot} times the first boot (${boot})`,
    },
    {
      key: "handsPerLevel",
      label: "Boot speed",
      selected: index(HANDS_PER_LEVEL_OPTIONS as readonly number[], s.handsPerLevel),
      options: HANDS_PER_LEVEL_OPTIONS.map((n) => ({ label: `${SPEED_NAMES[n] ?? n} (${n} hands)`, patch: { handsPerLevel: n } })),
      hint: `The boot goes up every ${s.handsPerLevel} hands`,
    },
    {
      key: "ending",
      label: "Ending",
      selected: index(ENDING_OPTIONS as readonly unknown[], s.ending),
      options: ENDING_OPTIONS.map((e) => ({ label: e === "last" ? "Last player left" : `${e} minutes`, patch: { ending: e } })),
      hint: s.ending === "last" ? "The game goes on until 1 player has all the chips" : "When time ends, the player with the most chips wins",
    },
    {
      key: "turnSeconds",
      label: "Turn timer",
      selected: index(TURN_SECONDS_OPTIONS as readonly number[], s.turnSeconds),
      options: TURN_SECONDS_OPTIONS.map((n) => ({ label: `${n} seconds`, patch: { turnSeconds: n } })),
      hint: "When time ends, you pack",
    },
  ];
}
