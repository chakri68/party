import type { Attr, RuinId } from "./types.ts";

export interface Approach { label: string; attr: Attr; need: 7 | 9; fail: { damage: number; noise: number } }

export const RUINS: Record<RuinId, { name: string; approaches: [Approach, Approach] }> = {
  shrine: {
    name: "Sunken Shrine",
    approaches: [
      { label: "Read the old words", attr: "mind", need: 9, fail: { damage: 0, noise: 2 } },
      { label: "Lift the stone door", attr: "strength", need: 7, fail: { damage: 1, noise: 0 } },
    ],
  },
  tower: {
    name: "Star Tower",
    approaches: [
      { label: "Climb in quietly", attr: "stealth", need: 9, fail: { damage: 1, noise: 0 } },
      { label: "Turn the star wheel", attr: "mind", need: 7, fail: { damage: 0, noise: 3 } },
    ],
  },
  cave: {
    name: "Root Cave",
    approaches: [
      { label: "Sneak past the roots", attr: "stealth", need: 7, fail: { damage: 0, noise: 2 } },
      { label: "Pull the roots away", attr: "strength", need: 9, fail: { damage: 1, noise: 0 } },
    ],
  },
};
