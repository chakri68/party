// The phone's client for the owner's sound library (GET/PUT/PATCH/DELETE /api/sounds).

import { HOST_SLOTS, isHostSlot } from "@games/sounds/check";
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

export type LibraryResult = { ok: true; library: Library } | { ok: false; error: string };

export const SAVE_FAILED = "Could not save. Try again.";

const NAME_MAX = 24;
const MS_MAX = 3000;
const API = "/api/sounds";

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
    if (typeof name !== "string") continue;
    const label = name.trim();
    if (label.length < 1 || label.length > NAME_MAX) continue;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > MS_MAX) continue;
    if (typeof url !== "string" || !isSameOriginPath(url) || !url.startsWith(`${API}/`)) continue;
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
    const headers = this.deps.headers();
    if (!headers) return null;
    try {
      const res = await this.deps.fetch(API, { headers });
      if (res.status !== 200) return null;
      return parseLibrary(await res.json());
    } catch {
      return null;
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
    if (!headers || !isSameOriginPath(url) || !url.startsWith(`${API}/`)) return null;
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
        return library ? { ok: true, library } : { ok: false, error: SAVE_FAILED };
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

/** Does this phone own a library? Asked once per page load for each set of headers. */
export function hasMySounds(api: LibraryApi = mySoundsApi()): Promise<boolean> {
  const headers = api.authHeaders();
  if (!headers) return Promise.resolve(false);
  const key = JSON.stringify(headers);
  let answer = asked.get(key);
  if (!answer) {
    answer = api.get().then((lib) => lib !== null);
    asked.set(key, answer);
  }
  return answer;
}
