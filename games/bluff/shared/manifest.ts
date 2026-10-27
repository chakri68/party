import type { GameManifest } from "@games/game-core";

export const fakeWordManifest: GameManifest = {
  id: "fake-word",
  name: "Fake Word",
  description: "Here's what a real word means. Make up a word that could mean it, and spot the real one.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "book",
};

export const bluffDefinitionsManifest: GameManifest = {
  id: "bluff-definitions",
  name: "Bluff Definitions",
  description: "Here's a real word nobody knows. Make up what it means, and spot the real meaning.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "book",
};
