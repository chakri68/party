import type { GameManifest } from "@games/game-core";

export const blindRallyManifest: GameManifest = {
  id: "blind-rally",
  name: "Blind Rally",
  description: "One player drives but cannot see the road. The other player sees the road. That player tells the driver where to go.",
  // One pair is a practice run; four pairs race. Seats past 8 watch.
  minPlayers: 2,
  maxPlayers: 12,
  icon: "car",
  // Seats are picked inside the game, so people turning up after the host
  // hits Start (and while the cars are out) still get in, as spares.
  lateJoin: true,
};
