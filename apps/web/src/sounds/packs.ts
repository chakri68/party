// The sound board's lists: the free pack, bundled with the app, then any
// extra packs a server serves (the stock app's memes). An extra list comes
// over the network, so every entry is checked before it reaches a tile.

import { isSoundId } from "@games/protocol";
import { FREE_SOUNDS, freeSoundUrl } from "@games/sounds";
import { HOST_PACK, HOST_SLOTS, MAX_SOUND_MS, cleanSoundName, isHostSlot } from "@games/sounds/check";

export interface BoardSound {
  /** The wire id, `<pack>:<id>` (`free:rise`). */
  id: string;
  name: string;
  ms: number;
  url: string;
}

export const MAX_PACK_SOUNDS = 60;

const PACK_NAME = /^[a-z][a-z0-9-]{0,15}$/;
/** `free` is the bundled pack; `host` is kept back for the host's own sounds. */
const RESERVED_PACKS = new Set(["free", "host"]);
const NAME_MAX = 24;
const MS_MAX = 3000;
/** Backslash, spaces and control characters: URL parsers drop or rewrite them, so a path could turn into another host. */
const UNSAFE_URL_CHAR = /[\\\u0000-\u0020\u007f]/;
const SAME_ORIGIN = "https://same.invalid";

/** A path on this site only: a list must not point the phone at another site. */
export function isSameOriginPath(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//") || UNSAFE_URL_CHAR.test(url)) return false;
  try {
    return new URL(url, SAME_ORIGIN).origin === SAME_ORIGIN;
  } catch {
    return false;
  }
}

export function freeBoard(): BoardSound[] {
  const out: BoardSound[] = [];
  for (const s of FREE_SOUNDS) {
    const url = freeSoundUrl(s.file);
    if (url) out.push({ id: `free:${s.id}`, name: s.name, ms: s.ms, url });
  }
  return out;
}

/** One extra pack's list, as the server sent it. Anything off gives `[]` or drops that entry. */
export function parsePackList(body: unknown): BoardSound[] {
  if (!body || typeof body !== "object") return [];
  const { pack, sounds } = body as { pack?: unknown; sounds?: unknown };
  if (typeof pack !== "string" || !PACK_NAME.test(pack) || RESERVED_PACKS.has(pack) || !Array.isArray(sounds)) return [];
  const out: BoardSound[] = [];
  const seen = new Set<string>();
  for (const entry of sounds) {
    if (out.length >= MAX_PACK_SOUNDS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, ms, url } = entry as Record<string, unknown>;
    const wire = `${pack}:${String(id)}`;
    if (typeof id !== "string" || !isSoundId(wire) || seen.has(wire)) continue;
    if (typeof name !== "string") continue;
    const label = name.trim();
    if (label.length < 1 || label.length > NAME_MAX) continue;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > MS_MAX) continue;
    if (typeof url !== "string" || !isSameOriginPath(url)) continue;
    seen.add(wire);
    out.push({ id: wire, name: label, ms, url });
  }
  return out;
}

/** The room's list of the host's own sounds. */
export function hostSoundsUrl(code: string): string {
  return `/api/rooms/${code}/sounds`;
}

/**
 * The host's sounds, as the room sent them: slots "1" to "6" under `listUrl`
 * only, in the order sent. Anything off gives `[]` or drops that entry.
 */
export function parseHostList(body: unknown, listUrl: string): BoardSound[] {
  if (!body || typeof body !== "object") return [];
  const { pack, sounds } = body as { pack?: unknown; sounds?: unknown };
  if (pack !== HOST_PACK || !Array.isArray(sounds)) return [];
  const out: BoardSound[] = [];
  const seen = new Set<string>();
  for (const entry of sounds) {
    if (out.length >= HOST_SLOTS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, ms, url } = entry as Record<string, unknown>;
    if (!isHostSlot(id) || seen.has(id as string)) continue;
    const label = cleanSoundName(name);
    if (label === null) continue;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > MAX_SOUND_MS) continue;
    if (typeof url !== "string" || !isSameOriginPath(url) || !url.startsWith(`${listUrl}/`)) continue;
    seen.add(id as string);
    out.push({ id: `${HOST_PACK}:${id as string}`, name: label, ms, url });
  }
  return out;
}

/**
 * Every extra pack, in `urls` order. A pack that fails to load (offline, or a
 * 404 where the server has no such pack) is skipped without a word.
 */
export async function loadExtraPacks(urls: readonly string[], getJson: (url: string) => Promise<unknown>): Promise<BoardSound[]> {
  const lists = await Promise.all(urls.map((url) => attempt(() => getJson(url)).then(parsePackList, () => [])));
  return lists.flat();
}

/** Runs `fn`, so a throw before it returns a promise becomes a rejection. */
export function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
}
