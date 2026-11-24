// A host's own sounds (step 2), in the R2 bucket bound as SOUNDS:
// lib/<library>/<slot>.mp3 and lib/<library>/index.json. The owner API here
// lists, saves, renames and removes them. Without SOUNDS, or without a
// policy.soundOwner, every route is a 404 and nobody has host sounds.
import { cleanSoundName, HOST_SOUND_MAX_BYTES, isHostSlot, MAX_SOUND_MS } from "@games/sounds/check";
import { readMp3 } from "@games/sounds/mp3";
import { json, type HostPolicy, type ServerEnv } from "./policy.ts";
import { isLibraryId, LIBRARY_ID_RE } from "./runtime.ts";

export { isLibraryId, LIBRARY_ID_RE };

/** The part of R2 this touches, so tests can fake it. */
export type SoundsBucket = Pick<R2Bucket, "get" | "put" | "delete" | "head">;

export interface SoundsEnv {
  SOUNDS?: SoundsBucket;
}

export const libKey = (library: string, slot: string): string => `lib/${library}/${slot}.mp3`;
export const indexKey = (library: string): string => `lib/${library}/index.json`;

/** One slot in the index. `v` is the first 10 hex characters of the file's sha256. */
export interface HostSlot {
  id: string;
  name: string;
  ms: number;
  v: string;
}

export interface SoundSlotBody {
  id: string;
  name: string;
  ms: number;
  url: string;
}

export interface MySoundsBody {
  active: boolean;
  slots: SoundSlotBody[];
}

/** Owner and room files: the URL carries ?v=, so a given URL never changes. */
export const PRIVATE_IMMUTABLE = "private, max-age=31536000, immutable";

/** Bytes after the last good frame we still take: an ID3v1 tag's worth. */
const MAX_TRAILING = 128;
const INDEX_TRIES = 3;
const V_RE = /^[0-9a-f]{10}$/;

const NOT_OWNER = "Only the host can change these sounds.";
const NOT_SOUND = "This file is not a sound we can use.";
const TOO_BIG = "This sound file is too big.";
const BAD_NAME = "A name has 1 to 24 letters.";
const TOO_LONG = "This sound is too long. A sound can be 3 seconds at most.";
const NEED_PASS = "Get Host Pass to add sounds.";
const EMPTY_SLOT = "There is no sound here.";
const CONFLICT = "Could not save. Try again.";

function cleanSlots(raw: unknown): HostSlot[] {
  const list = raw && typeof raw === "object" ? (raw as { slots?: unknown }).slots : undefined;
  const seen = new Set<string>();
  const slots: HostSlot[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = cleanSoundName(e.name);
    if (!isHostSlot(e.id) || name === null) continue;
    if (typeof e.ms !== "number" || !Number.isInteger(e.ms) || e.ms < 1 || e.ms > MAX_SOUND_MS) continue;
    if (typeof e.v !== "string" || !V_RE.test(e.v)) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    slots.push({ id: e.id, name, ms: e.ms, v: e.v });
  }
  return slots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The library's index, cleaned. Missing or not JSON: no slots. `etag` is null only when there is no index. */
export async function readIndex(bucket: SoundsBucket, library: string): Promise<{ slots: HostSlot[]; etag: string | null }> {
  const obj = await bucket.get(indexKey(library));
  if (!obj) return { slots: [], etag: null };
  let raw: unknown;
  try {
    raw = JSON.parse(await obj.text());
  } catch {
    raw = null;
  }
  return { slots: cleanSlots(raw), etag: obj.etag };
}

/**
 * Change the index with `change`, which gets the current slots and gives the new
 * ones (or null to write nothing). The write only lands if nobody else wrote the
 * index since we read it; otherwise read again, up to 3 tries in all.
 */
async function updateIndex(
  bucket: SoundsBucket,
  library: string,
  change: (slots: HostSlot[]) => HostSlot[] | null,
): Promise<{ slots: HostSlot[] } | { conflict: true } | { unchanged: HostSlot[] }> {
  for (let attempt = 0; attempt < INDEX_TRIES; attempt++) {
    const { slots, etag } = await readIndex(bucket, library);
    const next = change(slots);
    if (next === null) return { unchanged: slots };
    const sorted = [...next].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const wrote = await bucket.put(indexKey(library), JSON.stringify({ slots: sorted }), {
      httpMetadata: { contentType: "application/json" },
      ...(etag !== null && { onlyIf: { etagMatches: etag } }),
    });
    if (wrote) return { slots: sorted };
  }
  return { conflict: true };
}

/** The whole body, or null once it is past `max` bytes. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function hashV(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 5)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
const error = (text: string, status: number) => json({ error: text }, status);

function listBody(active: boolean, slots: HostSlot[]): Response {
  const body: MySoundsBody = {
    active,
    slots: slots.map((s) => ({ id: s.id, name: s.name, ms: s.ms, url: `/api/sounds/${s.id}?v=${s.v}` })),
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The file as stored, or a 404. Shared with the room routes. */
export async function serveFile(bucket: SoundsBucket, key: string): Promise<Response> {
  const obj = await bucket.get(key);
  if (!obj) return notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": PRIVATE_IMMUTABLE,
      etag: obj.httpEtag,
      "x-content-type-options": "nosniff",
    },
  });
}

const PATH = /^\/api\/sounds(?:\/([^/]+))?$/;

/** The owner API: /api/sounds and /api/sounds/<slot>. null when the path isn't ours. */
export async function serveMySounds(request: Request, env: ServerEnv, policy: HostPolicy): Promise<Response | null> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match) return null;
  const bucket = env.SOUNDS;
  if (!bucket || !policy.soundOwner) return notFound();

  const owner = await policy.soundOwner(request, env);
  if (!owner || !isLibraryId(owner.library)) return error(NOT_OWNER, 403);
  const { library, active } = owner;
  const write = request.method !== "GET" && request.method !== "HEAD";
  const origin = request.headers.get("origin");
  if (write && origin !== null && origin !== url.origin) return error(NOT_OWNER, 403);

  const slot = match[1];
  if (slot === undefined) {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
    return listBody(active, (await readIndex(bucket, library)).slots);
  }
  if (!isHostSlot(slot)) return notFound();

  switch (request.method) {
    case "GET":
      return serveFile(bucket, libKey(library, slot));

    case "PUT": {
      if (!active) return error(NEED_PASS, 403);
      const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "audio/mpeg") return error(NOT_SOUND, 415);
      const length = Number(request.headers.get("content-length") ?? "0");
      if (!(length <= HOST_SOUND_MAX_BYTES)) return error(TOO_BIG, 413);
      const bytes = await readCapped(request.body, HOST_SOUND_MAX_BYTES);
      if (!bytes) return error(TOO_BIG, 413);
      const name = cleanSoundName(url.searchParams.get("name"));
      if (name === null) return error(BAD_NAME, 400);
      const mp3 = readMp3(bytes);
      if (!mp3 || mp3.trailing > MAX_TRAILING) return error(NOT_SOUND, 415);
      if (mp3.ms > MAX_SOUND_MS) return error(TOO_LONG, 422);

      const entry: HostSlot = { id: slot, name, ms: mp3.ms, v: await hashV(bytes) };
      // The file first, then the index: an index never names a file that isn't there.
      await bucket.put(libKey(library, slot), bytes, { httpMetadata: { contentType: "audio/mpeg" } });
      const done = await updateIndex(bucket, library, (slots) => [...slots.filter((s) => s.id !== slot), entry]);
      if ("conflict" in done) return error(CONFLICT, 409);
      return listBody(active, "slots" in done ? done.slots : done.unchanged);
    }

    case "PATCH": {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        raw = null;
      }
      const name = cleanSoundName(raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined);
      if (name === null) return error(BAD_NAME, 400);
      const done = await updateIndex(bucket, library, (slots) =>
        slots.some((s) => s.id === slot) ? slots.map((s) => (s.id === slot ? { ...s, name } : s)) : null,
      );
      if ("conflict" in done) return error(CONFLICT, 409);
      if ("unchanged" in done) return error(EMPTY_SLOT, 404);
      return listBody(active, done.slots);
    }

    case "DELETE": {
      // The index first, then the file: an index never names a file that isn't there.
      const done = await updateIndex(bucket, library, (slots) =>
        slots.some((s) => s.id === slot) ? slots.filter((s) => s.id !== slot) : null,
      );
      if ("conflict" in done) return error(CONFLICT, 409);
      await bucket.delete(libKey(library, slot));
      return listBody(active, "slots" in done ? done.slots : done.unchanged);
    }

    default:
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, PUT, PATCH, DELETE" } });
  }
}
