// What the "My sounds" screen shows for a library: pure, so it is tested
// without a DOM. The dialog itself is my-sounds.ts (lazy).

import { HOST_SLOTS } from "@games/sounds/check";
import type { Library, LibrarySlot } from "../sounds/library.ts";

export const MY_SOUNDS_COPY = {
  title: "My sounds",
  intro: "Your sounds play on the sound board in rooms you make. You can keep 6.",
  lapsed: "Get Host Pass to use these in your rooms.",
  lapsedAdd: "Get Host Pass to add sounds.",
  add: "Add a sound",
  play: "Play",
  rename: "Rename",
  replace: "Replace",
  remove: "Remove",
  removeAsk: "Remove this sound?",
  name: "Name",
  noName: "Give it a name.",
  save: "Save",
  saving: "Saving...",
  cancel: "Cancel",
  close: "Close",
  loadFailed: "Could not load your sounds. Try again.",
} as const;

export type SlotAction = "add" | "play" | "rename" | "replace" | "remove";

export interface SlotRow {
  id: string;
  name: string | null;
  /** Like "2.4 s". */
  seconds: string | null;
  actions: SlotAction[];
}

/** Always 6 rows, slots "1".."6". A lapsed library keeps play, rename and remove, and can add nothing. */
export function mySoundsModel(lib: Library): { notes: string[]; rows: SlotRow[] } {
  const rows: SlotRow[] = [];
  for (let n = 1; n <= HOST_SLOTS; n++) {
    const id = String(n);
    const slot = lib.slots.find((s) => s.id === id);
    if (!slot) rows.push({ id, name: null, seconds: null, actions: lib.active ? ["add"] : [] });
    else
      rows.push({
        id,
        name: slot.name,
        seconds: `${(Math.round(slot.ms / 100) / 10).toFixed(1)} s`,
        actions: lib.active ? ["play", "rename", "replace", "remove"] : ["play", "rename", "remove"],
      });
  }
  return { notes: lib.active ? [] : [MY_SOUNDS_COPY.lapsed, MY_SOUNDS_COPY.lapsedAdd], rows };
}

export function startLabel(startS: number): string {
  return `Starts at ${startS.toFixed(1)} seconds`;
}

export type LibraryWrite = { kind: "save" | "rename"; slot: string; name: string } | { kind: "remove"; slot: string };

/**
 * The server said yes but sent no list, so we read the list again: did this write land?
 * A save gives a new file (a new url) under that name, a rename the new name, a remove an empty slot.
 */
export function writeLanded(write: LibraryWrite, before: Library | null, after: Library): boolean {
  const find = (lib: Library | null): LibrarySlot | undefined => lib?.slots.find((s) => s.id === write.slot);
  const now = find(after);
  if (write.kind === "remove") return !now;
  if (!now || now.name !== write.name) return false;
  return write.kind === "rename" || now.url !== find(before)?.url;
}
