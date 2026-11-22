// The sound board's lists: the free pack, bundled with the app, then any
// extra packs a server serves (the stock app's memes). An extra list comes
// over the network, so every entry is checked before it reaches a tile.

import { isSoundId } from "@games/protocol";
import { FREE_SOUNDS, freeSoundUrl } from "@games/sounds";

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
    // Same origin only: a list must not point the phone at another site.
    if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) continue;
    seen.add(wire);
    out.push({ id: wire, name: label, ms, url });
  }
  return out;
}

/**
 * Every extra pack, in `urls` order. A pack that fails to load (offline, or a
 * 404 where the server has no such pack) is skipped without a word.
 */
export async function loadExtraPacks(urls: readonly string[], getJson: (url: string) => Promise<unknown>): Promise<BoardSound[]> {
  const lists = await Promise.all(urls.map((url) => getJson(url).then(parsePackList, () => [])));
  return lists.flat();
}
