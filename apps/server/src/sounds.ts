// Which sound ids the room relays. The id's shape is checked at the network edge.

import { FREE_SOUND_IDS } from "@games/sounds/list";

/** Packs the room never takes from `extraPacks`: free has its own list, and host is kept for later. */
const RESERVED_PACKS: readonly string[] = ["free", "host"];

/** Is this `<pack>:<id>` on the board? Free ids must be on the free list; other packs are taken by name. */
export function onBoard(id: string, extraPacks: readonly string[]): boolean {
  const at = id.indexOf(":");
  const pack = id.slice(0, at);
  if (pack === "free") return FREE_SOUND_IDS.has(id.slice(at + 1));
  return !RESERVED_PACKS.includes(pack) && extraPacks.includes(pack);
}
