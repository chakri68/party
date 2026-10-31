import type { SettingField } from "@games/game-core";
import { blindsFor, formatChips } from "./rules.ts";
import {
  DEFAULT_SETTINGS,
  ENDING_OPTIONS,
  HANDS_PER_LEVEL_OPTIONS,
  REBUY_OPTIONS,
  STARTING_CHIPS_OPTIONS,
  TURN_SECONDS_OPTIONS,
  type HoldemSettings,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const holdemRules: string[] = [
  "Everyone starts with the same stack of play chips. Last one with chips wins.",
  "Each hand you get two cards only you can see. Five shared cards come out in the middle: three (the flop), then one (the turn), then one more (the river).",
  "Before the flop, the two players left of the button put in the small and big blind. There's a round of betting before the flop and after each new shared card.",
  "On your turn: fold, check if nothing's owed, call to match the bet, or raise. You can always go all-in.",
  "Make the best five-card hand from your two cards and the five shared ones. Best hand at the end takes the pot, or the last player left in when everyone else folds.",
  "Hands, best first: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card.",
  "Blinds go up every few hands, so the game always ends. Run out of chips and you're out.",
  "Play chips only: no buying, no cashing out, nothing carries over.",
];

/** What the lobby shows (and the host can change) before a game. */
export function holdemSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: HoldemSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<HoldemSettings> | null) };
  const bb = blindsFor(0).bb;
  const index = <T>(list: readonly T[], value: T) => Math.max(0, list.indexOf(value));
  return [
    {
      key: "startingChips",
      label: "Starting chips",
      selected: index(STARTING_CHIPS_OPTIONS as readonly number[], s.startingChips),
      options: STARTING_CHIPS_OPTIONS.map((n) => ({ label: formatChips(n), patch: { startingChips: n } })),
      hint: `${s.startingChips / bb} big blinds at the opening 10/20`,
    },
    {
      key: "handsPerLevel",
      label: "Blind speed",
      selected: index(HANDS_PER_LEVEL_OPTIONS as readonly number[], s.handsPerLevel),
      options: HANDS_PER_LEVEL_OPTIONS.map((n) => ({
        label: `${n === 10 ? "Slow" : n === 6 ? "Normal" : "Turbo"} (${n} hands)`,
        patch: { handsPerLevel: n },
      })),
      hint: `Blinds go up every ${s.handsPerLevel} hands`,
    },
    {
      key: "ending",
      label: "Ending",
      selected: index(ENDING_OPTIONS as readonly unknown[], s.ending),
      options: ENDING_OPTIONS.map((e) => ({ label: e === "last" ? "Last one standing" : `${e} minutes`, patch: { ending: e } })),
      hint: s.ending === "last" ? "Plays until one player has every chip" : "Then the hand in progress finishes, and the biggest stack wins",
    },
    {
      key: "rebuys",
      label: "Rebuys",
      selected: index(REBUY_OPTIONS as readonly string[], s.rebuys),
      options: [
        { label: "Off", patch: { rebuys: "off" } },
        { label: "One each, first 3 levels", patch: { rebuys: "early" } },
      ],
      hint: s.rebuys === "off" ? "Bust and you're out" : `Bust early and buy back in once, for ${formatChips(s.startingChips)}`,
    },
    {
      key: "turnSeconds",
      label: "Turn timer",
      selected: index(TURN_SECONDS_OPTIONS as readonly number[], s.turnSeconds),
      options: TURN_SECONDS_OPTIONS.map((n) => ({ label: `${n} seconds`, patch: { turnSeconds: n } })),
      hint: "Then you check if you can, otherwise fold",
    },
  ];
}
