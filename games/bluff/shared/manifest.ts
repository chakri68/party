import type { GameManifest } from "@games/game-core";

export const fakeWordManifest: GameManifest = {
  id: "fake-word",
  name: "Fake Word",
  description: "You see the meaning of a real word. Make up a word for it. Then find the real word.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "book",
};

export const bluffDefinitionsManifest: GameManifest = {
  id: "bluff-definitions",
  name: "Bluff Definitions",
  description: "You see a rare real word. Write a fake meaning for it. Then find the real meaning.",
  minPlayers: 3,
  maxPlayers: 12,
  icon: "book",
};
