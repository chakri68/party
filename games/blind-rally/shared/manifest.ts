import type { GameManifest } from "@games/game-core";

export const blindRallyManifest: GameManifest = {
  id: "blind-rally",
  name: "Blind Rally",
  description: "One of you drives without seeing the road. The other sees it all and has to talk them through.",
  // One pair is a practice run; four pairs race. Seats past 8 watch.
  minPlayers: 2,
  maxPlayers: 12,
  icon: "car",
  // Seats are picked inside the game, so people turning up after the host
  // hits Start (and while the cars are out) still get in, as spares.
  lateJoin: true,
};
