import type { SettingField } from "@games/game-core";
import { resolveDecks } from "./rules.ts";
import { DEFAULT_SETTINGS, WINDOW_SECONDS_OPTIONS, type CheatSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). Also known as BS, or I Doubt It. */
export const cheatRules: string[] = [
  "The whole deck gets dealt. Some players get one more card than others.",
  "On your turn, put one to four cards face down on the pile and say what they are. The first play is Aces, then Twos, Threes, up to Kings and round to Aces again.",
  "You have to claim the rank that's up, whatever you're holding. Haven't got it? Lie.",
  "After each play, anyone else can call \"Cheat!\" before the timer runs out. First call counts.",
  "The cards get turned over. If any of them isn't what was claimed, the player who put them down takes the whole pile. If they were all true, the caller takes it.",
  "Nobody calls (or everyone lets it go)? The next player carries on.",
  "First to get rid of every card wins, as long as their last play survives a call.",
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
        { label: "Same, up or down one", patch: { claims: "near" } },
      ],
      hint: settings.claims === "strict" ? "A, 2, 3 … K, A: no choice in the matter" : "After Sevens: Sixes, Sevens or Eights",
    },
    {
      key: "windowSeconds",
      label: "Time to call",
      selected: Math.max(0, (WINDOW_SECONDS_OPTIONS as readonly number[]).indexOf(settings.windowSeconds)),
      options: WINDOW_SECONDS_OPTIONS.map((s) => ({ label: `${s} seconds`, patch: { windowSeconds: s } })),
      hint: "Closes early once everyone's let it go",
    },
  ];
}
