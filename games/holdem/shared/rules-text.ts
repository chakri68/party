import { formatChips, type SettingField } from "@games/game-core";
import { blindsFor, handOrder } from "./rules.ts";
import {
  DEFAULT_SETTINGS,
  ENDING_OPTIONS,
  HANDS_PER_LEVEL_OPTIONS,
  REBUY_OPTIONS,
  STARTING_CHIPS_OPTIONS,
  TURN_SECONDS_OPTIONS,
  VARIANT_OPTIONS,
  variantOf,
  type HoldemSettings,
  type Variant,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const holdemRules: string[] = [
  "Each player starts with the same number of play chips.",
  "The last player with chips wins the game.",
  "Each hand, you get 2 cards. Only you can see your 2 cards.",
  "The game then puts 5 shared cards in the middle. Every player can use the shared cards.",
  "First, 3 shared cards come out. This is the flop.",
  "Next, 1 more shared card comes out. This is the turn.",
  "Last, 1 more shared card comes out. This is the river.",
  "The button is a marker. The button moves 1 seat each hand.",
  "Blinds are chips that 2 players must bet before the cards come.",
  "The player left of the button pays the small blind.",
  "The next player pays the big blind. The big blind is 2 times the small blind.",
  "Players bet before the flop. Players bet again after each new shared card.",
  "On your turn, you can fold. Fold means you give up this hand.",
  "You can check if nobody has bet. Check means you bet nothing.",
  "You can call. Call means you match the bet.",
  "You can raise. Raise means you bet more than the bet.",
  "You can always go all-in. All-in means you bet all your chips.",
  "The pot is all the chips bet in a hand.",
  "Make your best hand of 5 cards. Use your 2 cards and the 5 shared cards.",
  "The best hand at the end wins the pot.",
  "If every other player folds, the last player wins the pot.",
  `Hands, best first: ${handOrder("holdem").join(", ").toLowerCase()}.`,
  "The blinds go up every few hands. So the game always ends.",
  "If you lose all your chips, you are out.",
  "The chips are play chips. You do not use real money.",
  "The host can pick Omaha instead of Texas Hold'em. Omaha changes 3 things.",
  "In Omaha, you get 4 cards, not 2.",
  "In Omaha, your hand must use exactly 2 of your 4 cards and exactly 3 shared cards.",
  "In Omaha, the most you can bet is the size of the pot.",
  "The host can also pick Short Deck. Short Deck uses only 36 cards: 6 up to Ace. There are no 2, 3, 4 or 5 cards.",
  "In Short Deck, a flush beats a full house.",
  "In Short Deck, A-6-7-8-9 is the lowest straight. Here the Ace counts as a low card.",
  `In Short Deck, hands, best first: ${handOrder("shortdeck").join(", ").toLowerCase()}.`,
];

const VARIANT_LABELS: Record<Variant, string> = { holdem: "Texas Hold'em", omaha: "Omaha", shortdeck: "Short Deck" };
const VARIANT_HINTS: Record<Variant, string> = {
  holdem: "2 cards each. You can bet any amount.",
  omaha: "4 cards each. Use exactly 2 of them. You can bet up to the pot.",
  shortdeck: "36 cards, 6 up to Ace. A flush beats a full house. You can bet any amount.",
};

/** What the lobby shows (and the host can change) before a game. */
export function holdemSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: HoldemSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<HoldemSettings> | null) };
  const bb = blindsFor(0).bb;
  const index = <T>(list: readonly T[], value: T) => Math.max(0, list.indexOf(value));
  const variant = variantOf(s);
  return [
    {
      key: "variant",
      label: "Game",
      selected: index(VARIANT_OPTIONS as readonly string[], variant),
      options: VARIANT_OPTIONS.map((v) => ({ label: VARIANT_LABELS[v], patch: { variant: v } })),
      hint: VARIANT_HINTS[variant],
    },
    {
      key: "startingChips",
      label: "Starting chips",
      selected: index(STARTING_CHIPS_OPTIONS as readonly number[], s.startingChips),
      options: STARTING_CHIPS_OPTIONS.map((n) => ({ label: formatChips(n), patch: { startingChips: n } })),
      hint: `${s.startingChips / bb} big blinds at the start (10/20)`,
    },
    {
      key: "handsPerLevel",
      label: "Blind speed",
      selected: index(HANDS_PER_LEVEL_OPTIONS as readonly number[], s.handsPerLevel),
      options: HANDS_PER_LEVEL_OPTIONS.map((n) => ({
        label: `${n === 10 ? "Slow" : n === 6 ? "Normal" : "Fast"} (${n} hands)`,
        patch: { handsPerLevel: n },
      })),
      hint: `Blinds go up every ${s.handsPerLevel} hands`,
    },
    {
      key: "ending",
      label: "Ending",
      selected: index(ENDING_OPTIONS as readonly unknown[], s.ending),
      options: ENDING_OPTIONS.map((e) => ({ label: e === "last" ? "Last player left" : `${e} minutes`, patch: { ending: e } })),
      hint: s.ending === "last" ? "The game goes on until 1 player has all the chips" : "When time ends, the player with the most chips wins",
    },
    {
      key: "rebuys",
      label: "Rebuys",
      selected: index(REBUY_OPTIONS as readonly string[], s.rebuys),
      options: [
        { label: "Off", patch: { rebuys: "off" } },
        { label: "1 each, first 3 levels", patch: { rebuys: "early" } },
      ],
      hint: s.rebuys === "off" ? "If you lose all your chips, you are out" : `If you lose all your chips early, you can buy ${formatChips(s.startingChips)} once`,
    },
    {
      key: "turnSeconds",
      label: "Turn timer",
      selected: index(TURN_SECONDS_OPTIONS as readonly number[], s.turnSeconds),
      options: TURN_SECONDS_OPTIONS.map((n) => ({ label: `${n} seconds`, patch: { turnSeconds: n } })),
      hint: "When time ends, you check. If you can't check, you fold.",
    },
  ];
}
