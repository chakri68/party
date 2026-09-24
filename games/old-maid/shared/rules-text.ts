import type { SettingField } from "@games/game-core";
import { deckSize } from "./rules.ts";
import { DEFAULT_SETTINGS, type OldMaidSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const oldMaidRules: string[] = [
  "One queen comes out of the deck (or a joker goes in, if the host picks that). Now exactly one card can never be paired: that's the Old Maid.",
  "The whole deck gets dealt. Some players get one more card than others.",
  "Pairs (two cards of the same rank, any suit) go down face up. That happens by itself, right after the deal and whenever you make one.",
  "On your turn, take one card blind from the player on your right. It pairs with something or it doesn't.",
  "Run out of cards and you're out, safe. That includes having your last card taken.",
  "Play goes round until one player's left, holding the Old Maid. They lose; everyone else is fine.",
];

/** What the lobby shows (and the host can change) before a game. */
export function oldMaidSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: OldMaidSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<OldMaidSettings> | null) };
  const n = Math.max(players, 2);
  const size = deckSize(settings.oldMaid);
  const low = Math.floor(size / n);
  const choices = ["queen", "joker"] as const;
  return [
    {
      key: "oldMaid",
      label: "Old Maid",
      selected: Math.max(0, choices.indexOf(settings.oldMaid)),
      options: [
        { label: "A queen (classic)", patch: { oldMaid: "queen" } },
        { label: "The joker", patch: { oldMaid: "joker" } },
      ],
      hint: `${settings.oldMaid === "queen" ? "Nobody knows which queen till the end" : "Whoever holds it knows"} · ${low}${size % n ? `–${low + 1}` : ""} cards each`,
    },
  ];
}
