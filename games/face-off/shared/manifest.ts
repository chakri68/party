import type { GameManifest } from "@games/game-core";

export const faceOffManifest: GameManifest = {
  id: "face-off",
  name: "Face-Off",
  description: "Two of you are called out. Name something from the other's card, out loud, and buzz first.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "bolt",
};
