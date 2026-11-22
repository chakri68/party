// The free pack's list. Safe on the server: no Vite, no DOM.
import list from "../sounds.json";

export { MAX_SOUND_MS, SOUND_NAME_MAX } from "../check.mjs";

export interface FreeSound {
  id: string;
  name: string;
  file: string;
  ms: number;
  source: string;
  licence: string;
}

export const FREE_SOUNDS: readonly FreeSound[] = list.sounds as FreeSound[];

export const FREE_SOUND_IDS: ReadonlySet<string> = new Set(FREE_SOUNDS.map((s) => s.id));
