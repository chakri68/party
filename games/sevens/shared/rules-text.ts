import type { SettingField } from "@games/game-core";
import { resolveDecks } from "./rules.ts";
import { DEFAULT_SETTINGS, type SevensSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const sevensRules: string[] = [
  "The dealer gives out all the cards. Some players may get 1 extra card.",
  "Big groups play with more than 1 deck. The host chooses the number of decks, or leaves it on Auto.",
  "Each suit has its own row on the table. With 2 decks, each suit has 2 rows.",
  "The player on the dealer's left goes first.",
  "The host can change this rule. Then the player with the 7 of diamonds goes first. This player must play the 7 of diamonds first.",
  "A 7 starts a new row for its suit.",
  "After the 7, you can add the 6 or the 8 of that suit. Then the 5 or the 9. Each card must sit next to a card in the row.",
  "Aces are high. An ace goes after the King.",
  "The host can make aces low. Then an ace goes before the 2.",
  "You must play a card if you can. If you can't play, the game passes for you.",
  "The host can turn this rule off. Then you can pass at any time. You must tap Pass yourself.",
  "The first player with no cards left wins.",
  "The other players are ranked by the number of cards they have left.",
  "The host can choose penalty points instead. Then your leftover cards give you points.",
  "A number card gives its number. A picture card gives 10. An ace gives 1. The lowest score is best.",
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
        { label: "7 of diamonds", patch: { startingRule: "seven-of-diamonds" } },
      ],
      hint:
        settings.startingRule === "seven-of-diamonds"
          ? "The player with the 7♦ starts. The 7♦ is the first card."
          : "The player on the dealer's left starts. Any 7 can start.",
    },
    {
      key: "acePosition",
      label: "Aces",
      selected: settings.acePosition === "low" ? 1 : 0,
      options: [
        { label: "High", patch: { acePosition: "high" } },
        { label: "Low", patch: { acePosition: "low" } },
      ],
      hint: settings.acePosition === "low" ? "Rows go from A to K" : "Rows go from 2 to A",
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
        ? "You must play if you can. If you can't, the game passes for you."
        : "You can pass at any time. You must tap Pass yourself.",
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
          ? "Each card left gives you points. Picture cards give 10. Aces give 1."
          : "Other players are ranked by cards left",
    },
  ];
}
