import type { SettingField } from "@games/game-core";
import { resolveDecks, stockAfterDeal } from "./rules.ts";
import { DEFAULT_SETTINGS, HAND_SIZE, type CrazyEightsSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const crazyEightsRules: string[] = [
  `Everyone gets ${HAND_SIZE} cards. The rest is the stock, and its top card is turned up to start the pile. (If that's an eight, it gets buried and the next one's turned.)`,
  "On your turn, play a card that matches the top card's suit or rank.",
  "Eights are wild: play one any time and call a suit. The next player has to follow that suit, or play an eight of their own.",
  "Can't play? Draw from the stock until you can. You're allowed to draw even when you could play.",
  "When the stock runs out and you can't play, you pass. (Or, if the host turns it on, the pile gets reshuffled into a new stock.)",
  "First to empty their hand wins, and scores what's left in everyone else's: eights 50, tens and faces 10, aces 1, the rest face value.",
  "If the stock's gone and nobody can play, the lowest hand wins.",
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
        { label: "Reshuffle the pile", patch: { emptyStock: "reshuffle" } },
      ],
      hint: settings.emptyStock === "pass" ? "No more draws once it's gone (Bicycle rules)" : "The pile, minus its top card, becomes the new stock",
    },
  ];
}
