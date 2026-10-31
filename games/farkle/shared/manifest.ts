import type { GameManifest } from "@games/game-core";

export const farkleManifest: GameManifest = {
  id: "farkle",
  name: "Farkle",
  description: "Roll 6 dice. Keep the dice that score. Roll again, or save your points. If no dice score, you lose the points for that turn.",
  minPlayers: 2,
  maxPlayers: 8,
  icon: "dice",
};
