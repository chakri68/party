import type { SettingField } from "@games/game-core";
import { deckSize } from "./rules.ts";
import { DEFAULT_SETTINGS, type OldMaidSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const oldMaidRules: string[] = [
  "The game takes 1 queen out of the deck. Now 1 queen has no partner. This card is the Old Maid.",
  "The host can choose a joker instead. Then the game adds 1 joker to the deck. The joker is the Old Maid.",
  "The dealer gives out all the cards. Some players get 1 more card than others.",
  "A pair is 2 cards with the same number or picture. The suit does not matter.",
  "The game puts your pairs face up on the table for you. It does this after the deal. It also does this each time you make a pair.",
  "On your turn, take 1 card from the player before you. You cannot see their cards. The screen shows you this player.",
  "The new card may make a pair.",
  "If you have no cards left, you are safe. You are also safe if another player takes your last card.",
  "The game goes on until only 1 player has cards. This player has the Old Maid and loses. Everyone else is safe.",
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
      hint: `${settings.oldMaid === "queen" ? "Nobody knows the queen until the end" : "Only its holder knows"} · ${low}${size % n ? `–${low + 1}` : ""} cards each`,
    },
  ];
}
