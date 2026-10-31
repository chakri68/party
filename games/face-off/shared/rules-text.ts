import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type FaceOffSettings, TARGET_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const faceOffRules: string[] = [
  "Each player gets a card with a topic on it.",
  "For example: \"a breakfast food\" or \"something with wheels\".",
  "Everyone can see all the cards.",
  "Every few seconds, the game chooses 2 players.",
  "Each of the 2 players reads the other player's card. Each player says 1 answer for that topic out loud.",
  "After you say your answer, press Buzz. The first player to buzz gets the point.",
  "The other players then get 6 seconds to vote. They can accept the answer or reject it.",
  "If they reject the answer, the other player gets the point. If nobody votes, the point stays.",
  "The player without the point gets a new card.",
  "If nobody buzzes in 8 seconds, nobody gets a point. Both players get new cards.",
  "Each of the 2 players can ask for a redo 1 time. Nobody gets a point. The same 2 players play again.",
  "The first player to reach the target score wins.",
  "The game stops after 5 minutes. Then the player with the most points wins.",
  "If players have equal points at the end, they all win.",
];

/** What the lobby shows (and the host can change) before a game. */
export function faceOffSettingFields(raw: unknown): SettingField[] {
  const settings: FaceOffSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<FaceOffSettings> | null) };
  return [
    {
      key: "target",
      label: "First to",
      selected: Math.max(0, TARGET_OPTIONS.indexOf(settings.target)),
      options: TARGET_OPTIONS.map((n) => ({ label: `${n} points`, patch: { target: n } })),
      hint: "Or the game ends after 5 minutes",
    },
  ];
}
