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
  steppe: [
    ["Wind", "Mare", "Dust", "Saddle", "Sky", "Grass", "Hoof", "Kestrel", "Amber", "Dune", "Thunder", "Gale"],
    ["run", "camp", "yurt", "plain", "steppe", "ford", "gallop", "ring", "drift", "reach"],
  ],
  highland: [
    ["Iron", "Slate", "Cinder", "Anvil", "Granite", "Copper", "Crag", "Ember", "Flint", "Basalt", "Quarry", "Tin"],
    ["peak", "hold", "forge", "delve", "spire", "crest", "pike", "vault", "scar", "deep"],
  ],
  coastal: [
    ["Gull", "Salt", "Tide", "Kelp", "Coral", "Harbor", "Pearl", "Driftwood", "Shell", "Brine", "Anchor", "Sand"],
    ["haven", "port", "cove", "quay", "strand", "mouth", "bay", "mere", "sound", "point"],
  ],
  citadel: [
    ["Stone", "Bastion", "Rampart", "Shield", "Warden", "Gate", "Tower", "Keep", "Moat", "Banner", "Sentinel", "Bulwark"],
    ["wall", "keep", "guard", "watch", "fort", "burg", "hall", "march", "rest", "stand"],
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
