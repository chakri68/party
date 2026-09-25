import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, ROUND_CHOICES, type PresidentSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const presidentRules: string[] = [
  "The whole deck gets dealt, so some players get one more card than others. Cards rank 3 low, then up through K and A, and 2 is the highest.",
  "Whoever leads plays a single card, or a pair, three or four of a kind. Round 1, that's whoever holds the 3 of clubs.",
  "Going round, each player either beats it with the same number of cards of a higher rank, or passes. If nothing in your hand beats it, you pass automatically.",
  "Once you pass, you're out of that trick until it clears, even if you could beat what comes next.",
  "When everyone else has passed, the pile clears and whoever played last leads anything. If they've just gone out, the lead goes to the next player on.",
  "First out of cards is the President, then the Vice-President. Last is the Asshole (Scum, if there are kids about), and second-last the Vice-Asshole. Vice titles need four players.",
  "From round 2: the Asshole hands the President their two best cards, and the President gives back any two. The Vices swap one the same way. Then the Asshole leads.",
  "Each round you score a point for every player you finished ahead of. Most points after the last round wins; a tie goes to whoever finished higher in the last round.",
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
      hint: `${low}${52 % n ? `–${low + 1}` : ""} cards each${settings.rounds > 1 ? " · cards swap between rounds" : ""}`,
    },
    {
      key: "matchSkips",
      label: "Matching",
      selected: settings.matchSkips ? 1 : 0,
      options: [
        { label: "Must beat it", patch: { matchSkips: false } },
        { label: "Match to skip", patch: { matchSkips: true } },
      ],
      hint: settings.matchSkips ? "Playing the same rank is allowed, and skips the next player" : "Only a higher rank goes on top",
    },
  ];
}
