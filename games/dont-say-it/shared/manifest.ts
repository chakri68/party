import type { GameManifest } from "@games/game-core";

export const dontSayItManifest: GameManifest = {
  id: "dont-say-it",
  name: "Don't Say It",
  description: "The game has 2 teams. Describe a word to your team. Do not say the 5 banned words.",
  minPlayers: 4,
  maxPlayers: 12,
  icon: "speech",
};
