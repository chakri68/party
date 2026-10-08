// City names, built from syllables per culture. Original, deliberately silly
// in places; nobody's lore is final yet (§20).

import type { Rng } from "./grid.ts";
import type { FactionKind } from "./types.ts";

const PARTS: Record<FactionKind, [string[], string[]]> = {
  orchard: [
    ["Apple", "Pear", "Honey", "Barley", "Plum", "Clover", "Butter", "Quince", "Thistle", "Meadow", "Cider", "Bramble"],
    ["ton", "field", "bury", "stead", "wick", "hollow", "dale", "mere", "brook", "cote"],
  ],
  forest: [
    ["Elk", "Ash", "Wolf", "Fern", "Rowan", "Bear", "Moss", "Thorn", "Lynx", "Alder", "Owl", "Birch"],
    ["holt", "den", "fell", "hearth", "lodge", "ridge", "wood", "fang", "shaw", "tor"],
  ],
};

export function cityName(rng: Rng, kind: FactionKind, taken: ReadonlySet<string>): string {
  const [heads, tails] = PARTS[kind];
  for (let i = 0; i < 20; i++) {
    const name = rng.pick(heads) + rng.pick(tails);
    if (!taken.has(name)) return name;
  }
  // Ran out of luck: number it. Rare enough to be funny when it happens.
  let n = 2;
  const base = rng.pick(heads) + rng.pick(tails);
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
