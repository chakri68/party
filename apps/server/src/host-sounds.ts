// A host's own sounds (step 2), in the R2 bucket bound as SOUNDS:
// lib/<library>/<slot>-<v>.mp3 and lib/<library>/index.json. Each version of a
// slot has its own key, so a cached ?v= URL never serves other bytes. The owner API here
// lists, saves, renames and removes them. Without SOUNDS, or without a
// policy.soundOwner, every route is a 404 and nobody has host sounds.
import { cleanSoundName, HOST_SOUND_MAX_BYTES, isHostSlot, MAX_SOUND_MS } from "@games/sounds/check";
import { isValidRoomCode } from "@games/protocol";
import { readMp3 } from "@games/sounds/mp3";
import { json, type HostPolicy, type ServerEnv } from "./policy.ts";
import { isLibraryId, LIBRARY_ID_RE } from "./runtime.ts";

export { isLibraryId, LIBRARY_ID_RE };

/** The part of R2 this touches, so tests can fake it. */
export type SoundsBucket = Pick<R2Bucket, "get" | "put" | "delete" | "head">;

export interface SoundsEnv {
  SOUNDS?: SoundsBucket;
}

/** One version of a slot's file. `v` is the index's hash, so a key never changes its bytes. */
export const libKey = (library: string, slot: string, v: string): string => `lib/${library}/${slot}-${v}.mp3`;
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
export const V_RE = /^[0-9a-f]{10}$/;
const MAX_PATCH_BYTES = 1024;

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
      // The first index is create-only, so two first saves can't both land.
      onlyIf: etag !== null ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
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
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/** A write may only come from this site: Origin (when sent) names our host, and Sec-Fetch-Site (when sent) says same-origin. */
function sameSite(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return false;
    try {
      if (new URL(origin).host !== url.host) return false;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

/** Best effort: a file left behind is only space, swept with the library. */
async function dropFile(bucket: SoundsBucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (err) {
    console.error(`host sounds: could not delete ${key}:`, err);
  }
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
  if (write && !sameSite(request, url)) return error(NOT_OWNER, 403);

  const slot = match[1];
  if (slot === undefined) {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
    return listBody(active, (await readIndex(bucket, library)).slots);
  }
  if (!isHostSlot(slot)) return notFound();

  switch (request.method) {
    case "GET": {
      // The version is in the URL, so no index read: a bad or missing v is a 404.
      const v = url.searchParams.get("v");
      if (v === null || !V_RE.test(v)) return notFound();
      return serveFile(bucket, libKey(library, slot, v));
    }

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
      // On a 409 the new file stays behind, unnamed; it goes when the library does.
      await bucket.put(libKey(library, slot, entry.v), bytes, { httpMetadata: { contentType: "audio/mpeg" } });
      let replaced: string | undefined;
      const done = await updateIndex(bucket, library, (slots) => {
        replaced = slots.find((s) => s.id === slot)?.v;
        return [...slots.filter((s) => s.id !== slot), entry];
      });
      if ("conflict" in done) return error(CONFLICT, 409);
      if (replaced !== undefined && replaced !== entry.v) await dropFile(bucket, libKey(library, slot, replaced));
      return listBody(active, "slots" in done ? done.slots : done.unchanged);
    }

    case "PATCH": {
      const text = await readCapped(request.body, MAX_PATCH_BYTES);
      let raw: unknown = null;
      if (text) {
        try {
          raw = JSON.parse(new TextDecoder().decode(text));
        } catch {
          raw = null;
        }
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
      let removed: string | undefined;
      const done = await updateIndex(bucket, library, (slots) => {
        removed = slots.find((s) => s.id === slot)?.v;
        return removed === undefined ? null : slots.filter((s) => s.id !== slot);
      });
      if ("conflict" in done) return error(CONFLICT, 409);
      if (removed !== undefined) await dropFile(bucket, libKey(library, slot, removed));
      return listBody(active, "slots" in done ? done.slots : done.unchanged);
    }

    default:
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, PUT, PATCH, DELETE" } });
  }
}

export interface RoomSoundsBody {
  pack: "host";
  sounds: SoundSlotBody[];
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)\/sounds(?:\/([^/]+))?$/;

/**
 * A room's host sounds, by room code: /api/rooms/<code>/sounds and
 * /api/rooms/<code>/sounds/<slot>?v=. Only the library the room stored at claim
 * is served. null when the path isn't ours.
 */
export async function serveRoomSounds(
  request: Request,
  env: ServerEnv,
  libraryOf: (code: string) => Promise<string | null>,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = ROOM_PATH.exec(url.pathname);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }
  const bucket = env.SOUNDS;
  const code = match[1]!.toUpperCase();
  if (!bucket || !isValidRoomCode(code)) return notFound();
  const slot = match[2];
  if (slot !== undefined && !isHostSlot(slot)) return notFound();
  const library = await libraryOf(code);
  if (!isLibraryId(library)) return notFound();

  if (slot === undefined) {
    const { slots } = await readIndex(bucket, library);
    const body: RoomSoundsBody = {
      pack: "host",
      sounds: slots.map((s) => ({ id: s.id, name: s.name, ms: s.ms, url: `/api/rooms/${code}/sounds/${s.id}?v=${s.v}` })),
    };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const v = url.searchParams.get("v");
  if (v === null || !V_RE.test(v)) return notFound();
  return serveFile(bucket, libKey(library, slot, v));
}
