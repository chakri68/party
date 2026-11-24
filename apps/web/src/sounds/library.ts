// The phone's client for the owner's sound library (GET/PUT/PATCH/DELETE /api/sounds).

import { HOST_SLOTS, MAX_SOUND_MS, cleanSoundName, isHostSlot } from "@games/sounds/check";
import { shellConfig } from "../shell.ts";
import { isSameOriginPath } from "./packs.ts";

export interface LibrarySlot {
  id: string;
  name: string;
  ms: number;
  url: string;
}

export interface Library {
  active: boolean;
  slots: LibrarySlot[];
}

/**
 * `refetch` is true when the server answered 2xx but the body was not a list:
 * the write may have worked, so the caller should call `get()` to find out.
 */
export type LibraryResult = { ok: true; library: Library } | { ok: false; error: string; refetch?: true };

export const SAVE_FAILED = "Could not save. Try again.";

const API = "/api/sounds";

/** A file path under the sounds API: on this site, and still there once `..` and `%2e` are resolved. */
export function isLibraryUrl(url: string): boolean {
  if (!isSameOriginPath(url) || !url.startsWith(`${API}/`)) return false;
  try {
    return new URL(url, "http://x").pathname.startsWith(`${API}/`);
  } catch {
    return false;
  }
}

/** Keeps only safe slots: a good id, name and length, and a file path on this site. */
export function parseLibrary(body: unknown): Library | null {
  if (!body || typeof body !== "object") return null;
  const { active, slots } = body as { active?: unknown; slots?: unknown };
  if (typeof active !== "boolean" || !Array.isArray(slots)) return null;
  const out: LibrarySlot[] = [];
  const seen = new Set<string>();
  for (const entry of slots) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, ms, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !isHostSlot(id) || seen.has(id)) continue;
    const label = cleanSoundName(name);
    if (label === null) continue;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > MAX_SOUND_MS) continue;
    if (typeof url !== "string" || !isLibraryUrl(url)) continue;
    seen.add(id);
    out.push({ id, name: label, ms, url });
  }
  out.sort((a, b) => Number(a.id) - Number(b.id));
  return { active, slots: out.slice(0, HOST_SLOTS) };
}

interface Deps {
  fetch: typeof fetch;
  headers: () => Record<string, string> | null;
}

export class LibraryApi {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  /** The headers for one call, or null when this phone has no right to ask. */
  authHeaders(): Record<string, string> | null {
    return this.deps.headers();
  }

  async get(): Promise<Library | null> {
    return (await this.ask()).library;
  }

  /** Like `get`, and says if a "no" is final (no auth, or the server said 401/403/404) or may pass. */
  async ask(): Promise<{ library: Library | null; definite: boolean }> {
    const headers = this.deps.headers();
    if (!headers) return { library: null, definite: true };
    try {
      const res = await this.deps.fetch(API, { headers });
      if (res.status === 200) {
        let library: Library | null = null;
        try {
          library = parseLibrary(await res.json());
        } catch {
          // Not JSON: treated as a bad body.
        }
        return { library, definite: library !== null };
      }
      return { library: null, definite: res.status === 401 || res.status === 403 || res.status === 404 };
    } catch {
      return { library: null, definite: false };
    }
  }

  save(slot: string, bytes: Uint8Array, name: string): Promise<LibraryResult> {
    return this.write(`${API}/${slot}?name=${encodeURIComponent(name)}`, "PUT", { "content-type": "audio/mpeg" }, bytes as BodyInit);
  }

  rename(slot: string, name: string): Promise<LibraryResult> {
    return this.write(`${API}/${slot}`, "PATCH", { "content-type": "application/json" }, JSON.stringify({ name }));
  }

  remove(slot: string): Promise<LibraryResult> {
    return this.write(`${API}/${slot}`, "DELETE", {});
  }

  async bytes(url: string): Promise<ArrayBuffer | null> {
    const headers = this.deps.headers();
    if (!headers || !isLibraryUrl(url)) return null;
    try {
      const res = await this.deps.fetch(url, { headers });
      return res.ok ? await res.arrayBuffer() : null;
    } catch {
      return null;
    }
  }

  private async write(
    url: string,
    method: string,
    extra: Record<string, string>,
    body?: BodyInit,
  ): Promise<LibraryResult> {
    const headers = this.deps.headers();
    if (!headers) return { ok: false, error: SAVE_FAILED };
    try {
      const res = await this.deps.fetch(url, { method, headers: { ...headers, ...extra }, body });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // No JSON body: fall through to the generic answer.
      }
      if (res.ok) {
        const library = parseLibrary(parsed);
        return library ? { ok: true, library } : { ok: false, error: SAVE_FAILED, refetch: true };
      }
      const error = (parsed as { error?: unknown } | null)?.error;
      return { ok: false, error: typeof error === "string" && error ? error : SAVE_FAILED };
    } catch {
      return { ok: false, error: SAVE_FAILED };
    }
  }
}

export function mySoundsApi(): LibraryApi {
  return new LibraryApi({ fetch: (...a) => fetch(...a), headers: () => shellConfig().soundsAuth() });
}

const asked = new Map<string, Promise<boolean>>();

/** Forget what we know about owning sounds. Call it after a write, or after a sign-in. */
export function resetMySounds(): void {
  asked.clear();
}

/**
 * Does this phone own a library? Asked once per page load for each set of headers.
 * Only a sure answer is kept: yes, or a 401/403/404. A network error, a 5xx or a bad body is asked again.
 */
export function hasMySounds(api: LibraryApi = mySoundsApi()): Promise<boolean> {
  const headers = api.authHeaders();
  if (!headers) return Promise.resolve(false);
  const key = JSON.stringify(headers);
  let answer = asked.get(key);
  if (!answer) {
    const pending: Promise<boolean> = api.ask().then(({ library, definite }) => {
      if (!definite && asked.get(key) === pending) asked.delete(key);
      return library !== null;
    });
    answer = pending;
    asked.set(key, pending);
  }
  return answer;
}
