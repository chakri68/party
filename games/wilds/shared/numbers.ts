import type { ItemId } from "./types.ts";

export const N = {
  hearts: 3, actions: 2, bag: 2,
  move: 2, runnerMove: 3, look: 2, guideLook: 3,
  fireLife: 2, fireCap: 5, noiseMax: 3,
  spiderStep: 2, hungryStep: 3, spiderNoiseRange: 4, spiderHuntRange: 2, scaredStep: 2,
  medkit: 2, lureRange: 3, lureNoise: 3, forceNoise: 3, boldNoise: 1,
  cacheWeights: { planks: 3, medkit: 3, lure: 2, torch: 1 } as Record<ItemId, number>,
  eventOpenGate: 2, eventOpenRuin: 2, campOpen: 1, birdTiles: 3, echoNoise: 2, stoneNoise: 3, stoneDelay: 2, calmRounds: 2,
  timers: { roles: 30_000, choice: 20_000, report: 8_000 },
} as const;
