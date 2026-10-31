import type { SettingField } from "@games/game-core";
import { resolveDecks, stockAfterDeal } from "./rules.ts";
import { DEFAULT_SETTINGS, HAND_SIZE, type CrazyEightsSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const crazyEightsRules: string[] = [
  `Each player gets ${HAND_SIZE} cards. The other cards go face down in a pile. This pile is the stock.`,
  "The game turns over the top card of the stock. This card starts the pile in the middle.",
  "If the first card is an 8, the game puts it back in the stock. Then the game turns over the next card.",
  "On your turn, play 1 card on the pile. Your card must match the top card. It can match the suit or the number.",
  "An 8 is a special card. You can play an 8 at any time. Then you call a suit: you choose the next suit.",
  "The next player must play a card of that suit, or another 8.",
  "If you can't play, take cards from the stock. Keep taking cards until you can play.",
  "You can also take a card when you are able to play.",
  "Sometimes the stock is empty and you can't play. Then you pass.",
  "The host can change this rule. Then the game shuffles the pile. The pile becomes the new stock.",
  "The first player with no cards left wins.",
  "The winner gets points for the cards in the other players' hands.",
  "An 8 gives 50 points. A 10 or a picture card gives 10. An ace gives 1. Other cards give their number.",
  "Sometimes the stock is empty and nobody can play. Then the player with the lowest card total wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function crazyEightsSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: CrazyEightsSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<CrazyEightsSettings> | null) };
  const n = Math.max(players, 2);
  const auto = resolveDecks("auto", n);
  const decks = resolveDecks(settings.decks, n);
  const deckChoices = ["auto", 1, 2] as const;
  const stockChoices = ["pass", "reshuffle"] as const;
  return [
    {
      key: "decks",
      label: "Decks",
      selected: Math.max(0, deckChoices.indexOf(settings.decks)),
      options: deckChoices.map((d) => ({
        label: d === "auto" ? `Auto (${auto} for ${n})` : `${d} ${d === 1 ? "deck" : "decks"}`,
        patch: { decks: d },
      })),
      hint: `${stockAfterDeal(decks, n)} cards in the stock`,
    },
    {
      key: "emptyStock",
      label: "Empty stock",
      selected: Math.max(0, stockChoices.indexOf(settings.emptyStock)),
      options: [
        { label: "Pass", patch: { emptyStock: "pass" } },
        { label: "Shuffle the pile", patch: { emptyStock: "reshuffle" } },
      ],
      hint: settings.emptyStock === "pass" ? "Players pass when the stock is empty" : "The game shuffles the pile. The pile becomes the new stock. The top card stays.",
    },
  ];
}
