import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, ROUND_CHOICES, type PresidentSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const presidentRules: string[] = [
  "The game deals all the cards. Some players may get 1 more card than others.",
  "3 is the lowest card. Next come 4 to K, then A. 2 is the highest card.",
  "Rank means the number or letter on a card, like 7 or K.",
  "The leader plays first. In round 1, the player with the 3 of clubs is the leader.",
  "The leader plays 1 card, or 2, 3 or 4 cards of the same rank.",
  "Next, each player plays the same number of cards with a higher rank.",
  "If you can't beat the pile, you pass. The game passes for you.",
  "If you pass, you sit out until the pile is cleared. You sit out even if you can beat the next play.",
  "When all other players pass, the game clears the pile.",
  "The last player to play then leads. The leader can play any cards.",
  "If the leader has no cards left, the next player leads.",
  "The first player with no cards is the President. The second is the Vice-President.",
  "The last player is the Asshole. The second-last player is the Vice-Asshole.",
  "The Vice titles need 4 or more players.",
  "From round 2, players swap cards before play.",
  "The Asshole gives the President their 2 best cards.",
  "The President gives the Asshole any 2 cards.",
  "The Vice-Asshole and Vice-President swap 1 card the same way.",
  "Then the Asshole leads.",
  "Each round, you get 1 point for each player who finishes after you.",
  "After the last round, the player with the most points wins.",
  "If 2 players tie, the player who finished higher in the last round wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function presidentSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: PresidentSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<PresidentSettings> | null) };
  const n = Math.max(players, 3);
  const low = Math.floor(52 / n);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUND_CHOICES.indexOf(settings.rounds as (typeof ROUND_CHOICES)[number])),
      options: ROUND_CHOICES.map((r) => ({ label: `${r} ${r === 1 ? "round" : "rounds"}`, patch: { rounds: r } })),
      hint: `${low}${52 % n ? `–${low + 1}` : ""} cards each${settings.rounds > 1 ? " · players swap cards between rounds" : ""}`,
    },
    {
      key: "matchSkips",
      label: "Matching",
      selected: settings.matchSkips ? 1 : 0,
      options: [
        { label: "Must beat it", patch: { matchSkips: false } },
        { label: "Match to skip", patch: { matchSkips: true } },
      ],
      hint: settings.matchSkips ? "You can play the same rank. The same rank skips the next player." : "You must play a higher rank",
    },
  ];
}
