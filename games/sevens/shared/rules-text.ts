import type { SettingField } from "@games/game-core";
import { resolveDecks } from "./rules.ts";
import { DEFAULT_SETTINGS, type SevensSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const sevensRules: string[] = [
  "Every card is dealt, so hands can differ by a card. Bigger groups play with more decks (the host picks, or leave it on auto).",
  "With more than one deck, each suit gets a row per deck, and each seven can start one.",
  "The player left of the dealer goes first. (Or, if the host picks it, whoever holds the seven of diamonds, and it has to be the first card down.)",
  "A Seven starts its suit's row. After that, a card can go down only right next to what's already there: 6 or 8 after the 7, then 5 or 9, and so on outward.",
  "Aces are high: they go after the King. The host can make them low, so they go before the 2 instead.",
  "If you can play, you must. If you can't, you pass automatically. The host can turn this off, and then you can pass whenever you like, and have to press Pass yourself when stuck.",
  "First to empty their hand wins. Everyone else ranks by cards left, or, with penalty scoring, by what those cards are worth: face value, courts 10, aces 1. Lowest is best.",
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
    {
      key: "startingRule",
      label: "First move",
      selected: settings.startingRule === "seven-of-diamonds" ? 1 : 0,
      options: [
        { label: "Left of dealer", patch: { startingRule: "dealer-left" } },
        { label: "Seven of diamonds", patch: { startingRule: "seven-of-diamonds" } },
      ],
      hint:
        settings.startingRule === "seven-of-diamonds"
          ? "Whoever holds the 7♦ starts, and it's the first card down"
          : "Left of the dealer starts; any seven can open",
    },
    {
      key: "acePosition",
      label: "Aces",
      selected: settings.acePosition === "low" ? 1 : 0,
      options: [
        { label: "High", patch: { acePosition: "high" } },
        { label: "Low", patch: { acePosition: "low" } },
      ],
      hint: settings.acePosition === "low" ? "Rows run A to K" : "Rows run 2 to A",
    },
    {
      key: "forcedPlay",
      label: "Passing",
      selected: settings.forcedPlay ? 0 : 1,
      options: [
        { label: "Only when stuck", patch: { forcedPlay: true } },
        { label: "Any time", patch: { forcedPlay: false } },
      ],
      hint: settings.forcedPlay
        ? "If you can play, you must; stuck players pass automatically"
        : "Hold cards back if you like; nobody passes for you",
    },
    {
      key: "scoring",
      label: "Scoring",
      selected: settings.scoring === "remaining-cards" ? 1 : 0,
      options: [
        { label: "Winner only", patch: { scoring: "winner-only" } },
        { label: "Penalty points", patch: { scoring: "remaining-cards" } },
      ],
      hint:
        settings.scoring === "remaining-cards"
          ? "Cards left cost points: face value, courts 10, aces 1"
          : "The rest rank by cards left",
    },
  ];
}
