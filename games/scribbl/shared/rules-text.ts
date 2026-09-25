import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, DRAW_SECONDS_OPTIONS, ROUND_OPTIONS, type ScribblSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const scribblRules: string[] = [
  "Players take turns drawing. Every round, everyone draws once.",
  "When it's your turn, pick one of three words. Only you can see them. Dither and one gets picked for you.",
  "Draw it. No letters, no numbers: the others are guessing the word, not reading it.",
  "Everyone else types guesses. Nail it and you score: the faster, the more (300 down to 50). A near miss gets a quiet \"close!\" only you see.",
  "The drawer scores for every person who gets it, so draw like you mean it.",
  "The blanks show how long the word is. A letter or two gets filled in as the clock runs down.",
  "Once you've got it, your messages only reach the others who have. No spoilers.",
  "The turn ends when time's up or everyone's guessed. Most points after the last round wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function scribblSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: ScribblSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<ScribblSettings> | null) };
  const n = Math.max(players, 2);
  const turns = n * settings.rounds;
  // Choosing and the reveal add ~15 s a turn on top of the drawing.
  const minutes = Math.round((turns * (settings.drawSeconds + 15)) / 60);
  return [
    {
      key: "rounds",
      label: "Rounds",
      selected: Math.max(0, ROUND_OPTIONS.indexOf(settings.rounds)),
      options: ROUND_OPTIONS.map((r) => ({ label: String(r), patch: { rounds: r } })),
      hint: `${turns} drawings, up to ~${minutes} min`,
    },
    {
      key: "drawSeconds",
      label: "Time to draw",
      selected: Math.max(0, DRAW_SECONDS_OPTIONS.indexOf(settings.drawSeconds)),
      options: DRAW_SECONDS_OPTIONS.map((s) => ({ label: `${s} s`, patch: { drawSeconds: s } })),
    },
  ];
}
