import type { GameManifest } from "@games/game-core";

export const farkleManifest: GameManifest = {
  id: "farkle",
  name: "Farkle",
  description: "Roll six dice, keep the scorers, push your luck or bank. Roll nothing that scores and the turn's points are gone.",
  minPlayers: 2,
  maxPlayers: 8,
  icon: "dice",
};
