import type { SettingField } from "@games/game-core";
import { resolveDecks } from "./rules.ts";
import { DEFAULT_SETTINGS, type SevensSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const sevensRules: string[] = [
  "Every card is dealt, so hands can differ by a card. Bigger groups play with more decks (the host picks, or leave it on auto).",
  "With more than one deck, each suit gets a row per deck, and each seven can start one.",
  "A Seven starts its suit's row. After that, a card can go down only right next to what's already there: 6 or 8 after the 7, then 5 or 9, and so on outward.",
  "Aces are high: they go after the King.",
  "If you can play, you must. If you can't, you pass automatically.",
  "First to empty their hand wins.",
];


/** What the lobby shows (and the host can change) before a game. */
export function sevensSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: SevensSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<SevensSettings> | null) };
  const n = Math.max(players, 2);
  const auto = resolveDecks("auto", n);
  const decks = resolveDecks(settings.decks, n);
  const perHand = Math.floor((52 * decks) / n);
  const choices = ["auto", 1, 2, 3] as const;
  return [
    {
      key: "decks",
      label: "Decks",
      selected: Math.max(0, choices.indexOf(settings.decks)),
      options: choices.map((d) => ({
        label: d === "auto" ? `Auto (${auto} for ${n})` : `${d} ${d === 1 ? "deck" : "decks"}`,
        patch: { decks: d },
      })),
      hint: `${perHand}${(52 * decks) % n ? "–" + (perHand + 1) : ""} cards each`,
    },
  ];
}
