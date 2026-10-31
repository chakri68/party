import type { SettingField } from "@games/game-core";
import { REFILL } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const goFishRules: string[] = [
  "With 2 or 3 players, each player gets 7 cards. With more players, each player gets 5 cards.",
  "The other cards go face down in the middle. This pile is the pond.",
  "On your turn, choose a player. Ask this player for a card number you have. For example: \"Do you have any sevens?\"",
  "If the player has cards of that number, the player gives you all of them. Then you play again.",
  "If the player has none, the player says \"Go fish\". Then you take 1 card from the pond.",
  "If the pond card is the number you asked for, show it. Then you play again. If not, your turn ends.",
  "A book is all 4 cards of one number. The game puts your book face up on the table for you. This can happen right after the deal too.",
  `If you have no cards left, take ${REFILL} cards from the pond. If the pond has fewer cards, take them all.`,
  "If the pond is also empty, you stop playing for the rest of the game.",
  "Everyone sees each question and each answer. Only you see your pond card. You show it only if it is the number you asked for.",
  "The game ends when all 13 books are on the table. The player with the most books wins. If players have the same number of books, they share the win.",
];

/** Go Fish has nothing to set: the hand size follows the head count. */
export function goFishSettingFields(_raw: unknown, _players: number): SettingField[] {
  return [];
}
