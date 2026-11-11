// Host keys let this browser upgrade or reopen the rooms it made.
// They live in localStorage for 6 hours: longer than a game night, short enough to not pile up.

const KEY = "cp-host-keys";
const MAX_AGE_MS = 6 * 3_600_000;

type Entry = { key: string; at: number };

function read(): Record<string, Entry> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const now = Date.now();
    const out: Record<string, Entry> = {};
    for (const [code, e] of Object.entries(raw as Record<string, Partial<Entry>>)) {
      if (e && typeof e.key === "string" && typeof e.at === "number" && now - e.at < MAX_AGE_MS) out[code] = { key: e.key, at: e.at };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveHostKey(code: string, key: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [code]: { key, at: Date.now() } }));
  } catch {
    // Private mode or full storage: the room still works, only host powers are lost on reload.
  }
}

export function hostKeyFor(code: string): string | null {
  return read()[code]?.key ?? null;
}
