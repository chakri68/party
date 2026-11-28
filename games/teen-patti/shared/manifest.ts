import type { GameManifest } from "@games/game-core";

export const teenPattiManifest: GameManifest = {
  id: "teen-patti",
  name: "Teen Patti",
  description: "3 cards each, with play chips. Play Blind or Seen, Chaal or Pack. The boot goes up over time. The last player with chips wins.",
  minPlayers: 3,
  maxPlayers: 7,
  bestMinPlayers: 4,
  bestMaxPlayers: 6,
  computers: true,
  pausable: true,
  icon: "chips",
};
