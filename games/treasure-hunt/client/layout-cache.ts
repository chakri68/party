// Public state carries the seed; the layout (24 KB) is rebuilt here. Keeps
// the last one, since every state broadcast asks for it.

import { generateLayout } from "../shared/generate.ts";
import type { TreasureLayout } from "../shared/types.ts";

let last: { seed: number; layout: TreasureLayout } | null = null;

export function layoutFor(seed: number): TreasureLayout {
  if (last?.seed !== seed) last = { seed, layout: generateLayout(seed) };
  return last.layout;
}
