import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, DRAW_SECONDS_OPTIONS, ROUND_OPTIONS, type ScribblSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const scribblRules: string[] = [
  "Players take turns to draw. In each round, every player draws once.",
  "On your turn, the game shows you 3 words. Only you can see them. Choose 1 word.",
  "If you take too long, the game chooses a word for you.",
  "Draw the word. Do not write letters or numbers.",
  "The other players type guesses. If you guess right, you get points.",
  "Fast guesses get more points. The fastest guess gets 300 points. A slow guess gets 50 points.",
  "If your guess is very close, you see \"close!\". Only you see this.",
  "The drawer gets points for every player who guesses the word. So draw clearly.",
  "The blanks show how many letters the word has. As time runs out, the game shows 1 or 2 letters.",
  "After you guess the word, only players who also guessed the word see your messages.",
  "The turn ends when time is up, or when everyone has guessed.",
  "After the last round, the player with the most points wins.",
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
      hint: `${turns} drawings, up to about ${minutes} min`,
    },
    {
      key: "drawSeconds",
      label: "Time to draw",
      selected: Math.max(0, DRAW_SECONDS_OPTIONS.indexOf(settings.drawSeconds)),
      options: DRAW_SECONDS_OPTIONS.map((s) => ({ label: `${s} s`, patch: { drawSeconds: s } })),
    },
  ];
}
