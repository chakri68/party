import type { SettingField } from "@games/game-core";
import { resolveDecks } from "./rules.ts";
import { DEFAULT_SETTINGS, WINDOW_SECONDS_OPTIONS, type CheatSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). Also known as BS, or I Doubt It. */
export const cheatRules: string[] = [
  "The game deals all the cards. Some players may get 1 more card than others.",
  "On your turn, put 1 to 4 cards face down on the pile.",
  "Then say what the cards are. You must say the next rank.",
  "Rank means the number or letter on a card, like 7 or K.",
  "The first rank is Aces. Next come Twos and Threes, up to Kings. Then Aces come again.",
  "You must say the next rank, even if you don't have it. If you don't have it, lie.",
  "After each play, any other player can call \"Cheat!\" before the timer ends.",
  "Only the first call counts.",
  "The game then turns the cards over.",
  "If any card is wrong, the player who played the cards takes the whole pile.",
  "If all the cards are right, the player who called takes the whole pile.",
  "If nobody calls, the next player plays.",
  "The first player with no cards left wins.",
  "Your last play must be true. If someone catches a lie on your last play, you take the pile.",
];

/** What the lobby shows (and the host can change) before a game. */
export function cheatSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: CheatSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<CheatSettings> | null) };
  const n = Math.max(players, 3);
  const auto = resolveDecks("auto", n);
  const cards = 52 * resolveDecks(settings.decks, n);
  const low = Math.floor(cards / n);
  const deckChoices = ["auto", 1, 2] as const;
  const claimChoices = ["strict", "near"] as const;
  return [
    {
      key: "decks",
      label: "Decks",
      selected: Math.max(0, deckChoices.indexOf(settings.decks)),
      options: deckChoices.map((d) => ({
        label: d === "auto" ? `Auto (${auto} for ${n})` : `${d} ${d === 1 ? "deck" : "decks"}`,
        patch: { decks: d },
      })),
      hint: `${low}${cards % n ? `–${low + 1}` : ""} cards each`,
    },
    {
      key: "claims",
      label: "Claims",
      selected: Math.max(0, claimChoices.indexOf(settings.claims)),
      options: [
        { label: "Next rank up", patch: { claims: "strict" } },
        { label: "Same, or 1 up or down", patch: { claims: "near" } },
      ],
      hint: settings.claims === "strict" ? "A, 2, 3 … K, A. You can't choose." : "After Sevens, you can say Sixes, Sevens or Eights",
    },
    {
      key: "windowSeconds",
      label: "Time to call",
      selected: Math.max(0, (WINDOW_SECONDS_OPTIONS as readonly number[]).indexOf(settings.windowSeconds)),
      options: WINDOW_SECONDS_OPTIONS.map((s) => ({ label: `${s} seconds`, patch: { windowSeconds: s } })),
      hint: "The timer ends early if no player wants to call",
    },
  ];
}
