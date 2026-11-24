// Which sound ids the room relays. The id's shape is checked at the network edge.

import { HOST_PACK, isHostSlot } from "@games/sounds/check";
import { FREE_SOUND_IDS } from "@games/sounds/list";

/** Packs the room never takes from `extraPacks`: free has its own list, and host comes from the room's library. */
const RESERVED_PACKS: readonly string[] = ["free", HOST_PACK];

/**
 * Is this `<pack>:<id>` on the board? Free ids must be on the free list; host ids
 * must be a slot, in a room with the host's sounds; other packs are taken by name.
 */
export function onBoard(id: string, extraPacks: readonly string[], hostSounds: boolean): boolean {
  const at = id.indexOf(":");
  const pack = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (pack === "free") return FREE_SOUND_IDS.has(rest);
  if (pack === HOST_PACK) return hostSounds && isHostSlot(rest);
  return !RESERVED_PACKS.includes(pack) && extraPacks.includes(pack);
}
