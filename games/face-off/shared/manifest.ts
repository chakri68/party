import type { GameManifest } from "@games/game-core";

export const faceOffManifest: GameManifest = {
  id: "face-off",
  name: "Face-Off",
  description: "The game chooses 2 players. Each player says an answer for the other player's card. The first player to buzz wins.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "bolt",
};
