// The memes sound pack, served from R2 at the same origin. The clips and their
// list never enter git: `pnpm sound add --pack memes` puts them in the bucket.
// Only the party-games deploy binds MEMES. CouchParty and self-hosted copies
// have none, so these routes are a 404 there and the room offers no extra pack.
import { checkEntries, SOUND_ID_RE } from "@games/sounds/check";
import { IMMUTABLE } from "./godot.ts";

/** The part of R2 this touches, so tests can fake it. */
export type PackBucket = Pick<R2Bucket, "get">;

export interface PacksEnv {
  MEMES?: PackBucket;
}

export const MEMES_PREFIX = "memes/";

export interface PackListBody {
  pack: "memes";
  sounds: { id: string; name: string; ms: number; url: string }[];
}

/** The index in R2 turned into the list the client reads. Bad entries and repeated ids are left out. */
export function packListBody(index: unknown): PackListBody {
  const raw = index && typeof index === "object" ? (index as { sounds?: unknown }).sounds : undefined;
  const sounds: PackListBody["sounds"] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (checkEntries([entry], { pack: "memes" }).length > 0) continue;
    const e = entry as { id: string; name: string; ms: number; v: string };
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    sounds.push({ id: e.id, name: e.name.trim(), ms: e.ms, url: `/api/packs/memes/${e.id}.mp3?v=${e.v}` });
  }
  return { pack: "memes", sounds };
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });

const FILE = /^\/api\/packs\/memes\/([^/]+)\.mp3$/;

/** null when the path isn't ours, so the caller carries on routing. */
export async function servePacks(request: Request, env: PacksEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/packs/")) return null;
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }
  const bucket = env.MEMES;
  if (!bucket) return notFound();

  if (pathname === "/api/packs/memes") {
    const obj = await bucket.get(`${MEMES_PREFIX}index.json`);
    if (!obj) return notFound();
    let index: unknown;
    try {
      index = JSON.parse(await obj.text());
    } catch {
      return notFound();
    }
    return new Response(JSON.stringify(packListBody(index)), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  }

  const id = FILE.exec(pathname)?.[1];
  if (!id || !SOUND_ID_RE.test(id)) return notFound();
  const obj = await bucket.get(`${MEMES_PREFIX}${id}.mp3`);
  if (!obj) return notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": "audio/mpeg",
      // The list's ?v= is the file's hash, so a given URL never changes.
      "cache-control": IMMUTABLE,
      etag: obj.httpEtag,
      "x-content-type-options": "nosniff",
    },
  });
}

/** The extra packs this deploy has, for the room to accept sounds from. */
export function soundPacksFor(env: PacksEnv): string[] {
  return env.MEMES ? ["memes"] : [];
}
