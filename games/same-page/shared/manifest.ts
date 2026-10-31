import type { GameManifest } from "@games/game-core";

export const samePageManifest: GameManifest = {
  id: "same-page",
  name: "Same Page",
  description: "Everyone answers the same prompt in secret. Score for matching the room, not for being clever.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "speech",
};
