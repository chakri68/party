import type { GameManifest } from "@games/game-core";

export const holdemManifest: GameManifest = {
  id: "holdem",
  name: "Hold'em",
  description: "No-limit Texas Hold'em with play chips. Blinds climb until one player has the lot.",
  minPlayers: 2,
  maxPlayers: 9,
  icon: "chips",
};
