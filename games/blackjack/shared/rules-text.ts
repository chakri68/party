import type { SettingField } from "@games/game-core";
import { formatChips, rebuyRounds } from "./rules.ts";
import {
  DEFAULT_SETTINGS,
  MIN_BET,
  REBUY_OPTIONS,
  ROUNDS_OPTIONS,
  STARTING_CHIPS,
  TURN_SECONDS_OPTIONS,
  type BlackjackSettings,
} from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const blackjackRules: string[] = [
  "You play against the dealer. You do not play against the other players.",
  "Everyone starts with 1,000 play chips. You do not use real money.",
  "Each round, everyone bets at the same time. The smallest bet is 10.",
  "If you do not bet in time, you sit out that round. Miss 2 bets and you sit out until you tap Play next round.",
  "You get 2 cards face up. The dealer gets 1 card face up and 1 card face down.",
  "Number cards count their number. Jack, Queen and King count 10. An Ace counts 1 or 11.",
  "Try to get closer to 21 than the dealer. Over 21 is a bust, and you lose your bet at once.",
  "Everyone plays their own cards at the same time.",
  "Hit: take 1 more card. Stand: stop with what you have.",
  "Double: put in the same bet again, take exactly 1 more card, and stop. You can do this on your first 2 cards.",
  "Split: if your 2 cards have the same rank, make them 2 hands. Each hand gets the same bet. You can split once a round.",
  "Split Aces get only 1 more card each.",
  "If the dealer shows an Ace or a card worth 10, the dealer checks the face-down card. If the dealer has Blackjack, the round ends at once.",
  "When everyone is done, the dealer shows the face-down card. The dealer takes cards until 17 or more.",
  "A win pays the same as your bet. A tie gives your bet back.",
  "Blackjack is an Ace and a card worth 10 as your first 2 cards. It pays 3 to 2, so a bet of 10 wins 15.",
  "The game uses 6 decks. They are shuffled again when about 3 quarters are used.",
  "The game ends after the last round, or when everyone is out of chips. The most chips wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function blackjackSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: BlackjackSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<BlackjackSettings> | null) };
  const index = <T>(list: readonly T[], value: T) => Math.max(0, list.indexOf(value));
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: index(ROUNDS_OPTIONS as readonly number[], s.rounds),
      options: ROUNDS_OPTIONS.map((n) => ({ label: `${n} rounds`, patch: { rounds: n } })),
      hint: `Everyone starts with ${formatChips(STARTING_CHIPS)} chips. The smallest bet is ${MIN_BET}.`,
    },
    {
      key: "rebuys",
      label: "Rebuys",
      selected: index(REBUY_OPTIONS as readonly string[], s.rebuys),
      options: [
        { label: "Off", patch: { rebuys: "off" } },
        { label: "1 each, first half", patch: { rebuys: "one" } },
      ],
      hint:
        s.rebuys === "off"
          ? "If you lose all your chips, you are out"
          : `If you lose all your chips in the first ${rebuyRounds(s.rounds)} rounds, you can buy ${formatChips(STARTING_CHIPS)} chips once`,
    },
    {
      key: "turnSeconds",
      label: "Turn timer",
      selected: index(TURN_SECONDS_OPTIONS as readonly number[], s.turnSeconds),
      options: TURN_SECONDS_OPTIONS.map((n) => ({ label: `${n} seconds`, patch: { turnSeconds: n } })),
      hint: "No bet in time: you sit out the round. No move in time: you stand.",
    },
  ];
}
