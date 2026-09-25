import type { SettingField } from "@games/game-core";
import { REFILL } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const goFishRules: string[] = [
  "Seven cards each with two or three players, five with more. The rest go face down in the middle: the pond.",
  "On your turn, pick someone and ask them for a rank you already hold, like \"got any sevens?\"",
  "If they have any, they hand over all of them and you go again. If not: go fish. Draw one from the pond. If it's the rank you asked for, show it and go again; otherwise your turn's over.",
  "All four of a rank make a book. It goes down face up as soon as you have it, even straight off the deal.",
  `Run out of cards and you draw ${REFILL} from the pond (or whatever's left). If the pond's empty too, you sit out the rest of the game.`,
  "Everyone hears every ask and answer. What you draw from the pond stays secret, unless it's the catch you show.",
  "When all 13 books are down, most books wins. Ties share it.",
];

/** Go Fish has nothing to set: the hand size follows the head count. */
export function goFishSettingFields(_raw: unknown, _players: number): SettingField[] {
  return [];
}
