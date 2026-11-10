// A whole hunt: the layout plus its caches. Mirrors makeLayout's reroll loop,
// adding one more reason to reroll: too few cache spots (R6).

import { generateLayout, validateLayout } from "../shared/generate.ts";
import { START_MIN } from "../shared/sky.ts";
import { rng } from "../shared/noise.ts";
import type { TreasureLayout } from "../shared/types.ts";
import { makeCaches, type Cache } from "./caches.ts";

/** Seed stream for layers 6–7, xor'd with the layout's own seed. */
export const CACHE_SEED = 0xcac4e;

/** The first seed in seed, seed+1, … (10 tries) with a valid layout and enough cache spots. Throws if none has. */
export interface HuntSky {
  startMin: number;
  minutes: number;
}

/** `sky` is the round's clock window. Sky clues (shadow, lamp, photo) will use it. */
export function makeHunt(seed: number, _sky: HuntSky = { startMin: START_MIN.day, minutes: 30 }): { layout: TreasureLayout; caches: Cache[] } {
  for (let k = 0; k < 10; k++) {
    const layout = generateLayout(seed + k);
    if (validateLayout(layout).length > 0) continue;
    const caches = makeCaches(layout, rng(layout.seed ^ CACHE_SEED));
    if (caches) return { layout, caches };
  }
  throw new Error(`no valid Treasure Hunt map in seeds ${seed}..${seed + 9}`);
}
