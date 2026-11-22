// An in-memory KeyValue for the voice settings tests.

import type { KeyValue } from "../../src/voice/prefs.ts";

export function memoryStore(): KeyValue & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    read: (k) => map.get(k) ?? null,
    write: (k, v) => {
      if (v === null) map.delete(k);
      else map.set(k, v);
    },
  };
}
