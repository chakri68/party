import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));

import { fakeMp3 } from "../../../packages/sounds/test/mp3-fixture.ts";
import {
  indexKey,
  isLibraryId,
  libKey,
  readCapped,
  readIndex,
  serveMySounds,
  serveRoomSounds,
  type RoomSoundsBody,
  type HostSlot,
  type MySoundsBody,
  type SoundsBucket,
} from "../src/host-sounds.ts";
import { ownerKeyPolicy, type HostPolicy, type ServerEnv, type SoundOwner } from "../src/policy.ts";
import { createFetch } from "../src/worker.ts";

const KEY = "secret";

/**
 * A fake R2 bucket over a Map. put honours onlyIf.etagMatches and etagDoesNotMatch "*";
 * each put gets a new etag. state.beforeIndexPut runs once, just before the next
 * index put is checked, to let another request land in between.
 */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; contentType?: string }>();
  let n = 0;
  const state = { failIndexPuts: 0, writes: 0, beforeIndexPut: null as null | (() => Promise<unknown>) };
  const toBytes = async (value: unknown): Promise<Uint8Array> => {
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    throw new Error("fake bucket: unsupported value");
  };
  const meta = (key: string, o: { bytes: Uint8Array; etag: string }) => ({
    key,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    size: o.bytes.byteLength,
  });
  const bucket = {
    async head(key: string) {
      const o = objects.get(key);
      return o ? meta(key, o) : null;
    },
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      const bytes = o.bytes;
      return {
        ...meta(key, o),
        body: new Response(bytes).body,
        async text() {
          return new TextDecoder().decode(bytes);
        },
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
      };
    },
    async put(
      key: string,
      value: unknown,
      opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; httpMetadata?: { contentType?: string } },
    ) {
      if (key.endsWith("/index.json") && state.beforeIndexPut) {
        const run = state.beforeIndexPut;
        state.beforeIndexPut = null;
        await run();
      }
      if (key.endsWith("/index.json") && state.failIndexPuts > 0) {
        state.failIndexPuts--;
        return null;
      }
      const want = opts?.onlyIf?.etagMatches;
      if (want !== undefined && objects.get(key)?.etag !== want) return null;
      if (opts?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      const o = { bytes: await toBytes(value), etag: `e${++n}`, contentType: opts?.httpMetadata?.contentType };
      objects.set(key, o);
      state.writes++;
      return meta(key, o);
    },
    async delete(key: string) {
      objects.delete(key);
      state.writes++;
    },
  };
  return { bucket: bucket as unknown as SoundsBucket, objects, state };
}

const auth = { authorization: `Bearer ${KEY}` };
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://x.test${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
const put = (slot: string, name: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  req(`/api/sounds/${slot}?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": "audio/mpeg", ...headers },
  });
const patch = (slot: string, body: unknown) =>
  req(`/api/sounds/${slot}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const del = (slot: string) => req(`/api/sounds/${slot}`, { method: "DELETE" });

function setup(policy: HostPolicy = ownerKeyPolicy) {
  const b = fakeBucket();
  const env = { OWNER_KEY: KEY, SOUNDS: b.bucket } as unknown as ServerEnv;
  const call = async (r: Request) => {
    const res = await serveMySounds(r, env, policy);
    if (!res) throw new Error("not routed");
    return res;
  };
  return { ...b, env, call };
}

const body = async (res: Response) => (await res.json()) as MySoundsBody;
const storedIndex = (objects: Map<string, { bytes: Uint8Array }>, library = "owner") => {
  const o = objects.get(indexKey(library));
  return o ? (JSON.parse(new TextDecoder().decode(o.bytes)) as { slots: HostSlot[] }).slots : null;
};
const fileKeys = (objects: Map<string, unknown>) => [...objects.keys()].filter((k) => k.endsWith(".mp3")).sort();
const vOf = (objects: Map<string, { bytes: Uint8Array }>, id: string) => storedIndex(objects)!.find((s) => s.id === id)?.v;
const policyGiving = (owner: SoundOwner | null): HostPolicy => ({
  canCreate: ownerKeyPolicy.canCreate,
  soundOwner: async () => owner,
});

describe("serveMySounds", () => {
  it("leaves other paths alone", async () => {
    const { env } = setup();
    for (const path of ["/api/rooms", "/api/soundsx", "/api/sounds/1/2", "/"]) {
      expect(await serveMySounds(req(path), env, ownerKeyPolicy)).toBeNull();
    }
  });

  it("lists an empty library", async () => {
    const { call } = setup();
    const res = await call(req("/api/sounds"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ active: true, slots: [] });
  });

  it("refuses anyone but the owner", async () => {
    const { env } = setup();
    const noAuth = new Request("https://x.test/api/sounds");
    expect((await serveMySounds(noAuth, env, ownerKeyPolicy))!.status).toBe(403);
    expect(await (await serveMySounds(noAuth, env, ownerKeyPolicy))!.json()).toEqual({
      error: "Only the host can change these sounds.",
    });
    const wrong = new Request("https://x.test/api/sounds", { headers: { authorization: "Bearer nope" } });
    expect((await serveMySounds(wrong, env, ownerKeyPolicy))!.status).toBe(403);
    const noOwner: HostPolicy = { canCreate: ownerKeyPolicy.canCreate };
    expect((await serveMySounds(req("/api/sounds"), env, noOwner))!.status).toBe(404);

    const unbound = { OWNER_KEY: KEY } as ServerEnv;
    for (const r of [req("/api/sounds"), req("/api/sounds/1"), put("1", "A", fakeMp3()), patch("1", { name: "A" }), del("1")]) {
      expect((await serveMySounds(r, unbound, ownerKeyPolicy))!.status).toBe(404);
    }
  });

  it("saves a sound", async () => {
    const { call, objects } = setup();
    const bytes = fakeMp3();
    const res = await call(put("3", " Bruh ", bytes));
    expect(res.status).toBe(200);
    const slots = storedIndex(objects)!;
    const file = objects.get(libKey("owner", "3", slots[0]!.v));
    expect(file?.bytes).toEqual(bytes);
    expect(file?.contentType).toBe("audio/mpeg");
    expect(fileKeys(objects)).toEqual([`lib/owner/3-${slots[0]!.v}.mp3`]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ id: "3", name: "Bruh", ms: 2400 });
    expect(slots[0]!.v).toMatch(/^[0-9a-f]{10}$/);
    expect(await body(res)).toEqual({
      active: true,
      slots: [{ id: "3", name: "Bruh", ms: 2400, url: `/api/sounds/3?v=${slots[0]!.v}` }],
    });
  });

  it("checks the slot, type, size, name and length", async () => {
    const { call, state } = setup();
    for (const slot of ["0", "7", "a"]) {
      expect((await call(put(slot, "A", fakeMp3()))).status).toBe(404);
      expect((await call(req(`/api/sounds/${slot}`))).status).toBe(404);
    }
    const notSound = { error: "This file is not a sound we can use." };
    const wav = await call(put("1", "A", fakeMp3(), { "content-type": "audio/wav" }));
    expect(wav.status).toBe(415);
    expect(await wav.json()).toEqual(notSound);

    const big = new Uint8Array(65537);
    const tooBig = await call(put("1", "A", big));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: "This sound file is too big." });
    // No content-length: a stream that grows past the cap while it is read.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(40000));
        c.enqueue(new Uint8Array(25537));
        c.close();
      },
    });
    const streamed = new Request("https://x.test/api/sounds/1?name=A", {
      method: "PUT",
      body: stream,
      headers: { ...auth, "content-type": "audio/mpeg" },
      duplex: "half",
    } as RequestInit);
    expect(streamed.headers.get("content-length")).toBeNull();
    expect((await call(streamed)).status).toBe(413);

    for (const name of ["", "x".repeat(25)]) {
      const res = await call(put("1", name, fakeMp3()));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A name has 1 to 24 letters." });
    }
    const long = await call(put("1", "A", fakeMp3({ frames: 130 })));
    expect(long.status).toBe(422);
    expect(await long.json()).toEqual({ error: "This sound is too long. A sound can be 3 seconds at most." });

    const zeros = await call(put("1", "A", new Uint8Array(1000)));
    expect(zeros.status).toBe(415);
    expect(await zeros.json()).toEqual(notSound);

    // Junk after the audio (more than an ID3v1 tag's worth).
    const good = fakeMp3();
    const junk = new Uint8Array(good.length + 129);
    junk.set(good);
    junk.fill(7, good.length);
    const junky = await call(put("1", "A", junk));
    expect(junky.status).toBe(415);
    expect(await junky.json()).toEqual(notSound);

    expect(state.writes).toBe(0);
  });

  it("allows a little trailing data", async () => {
    const { call } = setup();
    const good = fakeMp3();
    const bytes = new Uint8Array(good.length + 128);
    bytes.set(good);
    expect((await call(put("1", "A", bytes))).status).toBe(200);
  });

  it("replace changes v, rename keeps it", async () => {
    const { call, objects } = setup();
    await call(put("3", "Bruh", fakeMp3()));
    const v1 = storedIndex(objects)![0]!.v;
    await call(put("3", "Bruh", fakeMp3({ frames: 50 })));
    const v2 = storedIndex(objects)![0]!.v;
    expect(v2).not.toBe(v1);
    expect(storedIndex(objects)![0]!.ms).toBe(1200);
    // The old version's file is gone; only the new one is left.
    expect(fileKeys(objects)).toEqual([libKey("owner", "3", v2)]);
    // The same bytes again keep v and the file.
    await call(put("3", "Bruh", fakeMp3({ frames: 50 })));
    expect(fileKeys(objects)).toEqual([libKey("owner", "3", v2)]);

    const renamed = await call(patch("3", { name: " Wow " }));
    expect(renamed.status).toBe(200);
    expect((await body(renamed)).slots).toEqual([{ id: "3", name: "Wow", ms: 1200, url: `/api/sounds/3?v=${v2}` }]);
    expect(storedIndex(objects)![0]).toEqual({ id: "3", name: "Wow", ms: 1200, v: v2 });

    const empty = await call(patch("2", { name: "Wow" }));
    expect(empty.status).toBe(404);
    expect(await empty.json()).toEqual({ error: "There is no sound here." });
    for (const bad of [{ name: "" }, { name: 5 }, {}]) {
      const res = await call(patch("3", bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A name has 1 to 24 letters." });
    }
    const notJson = await call(req("/api/sounds/3", { method: "PATCH", body: "{", headers: { "content-type": "application/json" } }));
    expect(notJson.status).toBe(400);
    const huge = JSON.stringify({ name: "Ok", pad: "x".repeat(2000) });
    const tooBig = await call(req("/api/sounds/3", { method: "PATCH", body: huge, headers: { "content-type": "application/json" } }));
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: "A name has 1 to 24 letters." });
    expect(storedIndex(objects)![0]!.name).toBe("Wow");
  });

  it("remove takes the slot and the file", async () => {
    const { call, objects } = setup();
    await call(put("3", "Bruh", fakeMp3()));
    await call(put("1", "One", fakeMp3({ frames: 10 })));
    const v1 = vOf(objects, "1")!;
    const res = await call(del("3"));
    expect(res.status).toBe(200);
    expect((await body(res)).slots.map((s) => s.id)).toEqual(["1"]);
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1"]);
    expect(fileKeys(objects)).toEqual([libKey("owner", "1", v1)]);
    const again = await call(del("3"));
    expect(again.status).toBe(200);
    expect((await body(again)).slots.map((s) => s.id)).toEqual(["1"]);
  });

  it("a lapsed library can rename and remove but not save", async () => {
    const live = setup();
    await live.call(put("1", "One", fakeMp3()));
    await live.call(put("2", "Two", fakeMp3()));
    const lapsed = policyGiving({ library: "owner", active: false });
    const call = async (r: Request) => (await serveMySounds(r, live.env, lapsed))!;

    const list = await call(req("/api/sounds"));
    expect(list.status).toBe(200);
    const listed = await body(list);
    expect(listed.active).toBe(false);
    expect(listed.slots.map((s) => s.id)).toEqual(["1", "2"]);
    expect((await call(req(`/api/sounds/1?v=${vOf(live.objects, "1")}`))).status).toBe(200);
    expect((await call(patch("1", { name: "Uno" }))).status).toBe(200);
    expect((await call(del("2"))).status).toBe(200);

    const writes = live.state.writes;
    const res = await call(put("3", "Three", fakeMp3()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Get Host Pass to add sounds." });
    expect(live.state.writes).toBe(writes);
    expect(fileKeys(live.objects).some((k) => k.startsWith("lib/owner/3-"))).toBe(false);
  });

  it("serves the owner's own file", async () => {
    const { call, objects } = setup();
    const bytes = fakeMp3();
    await call(put("3", "Bruh", bytes));
    const v = vOf(objects, "3")!;
    const res = await call(req(`/api/sounds/3?v=${v}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect((await call(req(`/api/sounds/2?v=${v}`))).status).toBe(404);
  });

  it("a bad or missing v is a 404", async () => {
    const { call, objects } = setup();
    await call(put("3", "Bruh", fakeMp3()));
    const v = vOf(objects, "3")!;
    for (const q of ["", "?v=", "?v=x", `?v=${v.toUpperCase()}`, `?v=${v}0`, "?v=../../x", "?v=0123456789"]) {
      expect((await call(req(`/api/sounds/3${q}`))).status).toBe(404);
    }
  });

  it("two tabs replacing one slot leave one file, the one the index names", async () => {
    const { call, objects, state } = setup();
    await call(put("3", "Old", fakeMp3({ frames: 10 })));
    // Tab B saves while tab A is between its read and its index write.
    state.beforeIndexPut = () => call(put("3", "B", fakeMp3({ frames: 30 })));
    expect((await call(put("3", "A", fakeMp3({ frames: 20 })))).status).toBe(200);
    const slots = storedIndex(objects)!;
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("A");
    expect(fileKeys(objects)).toEqual([libKey("owner", "3", slots[0]!.v)]);
  });

  it("a save racing a remove keeps the index and files in step", async () => {
    const { call, objects, state } = setup();
    await call(put("3", "Old", fakeMp3({ frames: 10 })));
    // The remove lands between the save's file write and its index write.
    state.beforeIndexPut = () => call(del("3"));
    expect((await call(put("3", "New", fakeMp3({ frames: 20 })))).status).toBe(200);
    const slots = storedIndex(objects)!;
    expect(slots.map((s) => s.name)).toEqual(["New"]);
    expect(fileKeys(objects)).toEqual([libKey("owner", "3", slots[0]!.v)]);

    // The other order: the save lands while the remove is between read and write.
    state.beforeIndexPut = () => call(put("3", "Newer", fakeMp3({ frames: 30 })));
    expect((await call(del("3"))).status).toBe(200);
    expect(storedIndex(objects)).toEqual([]);
    expect(fileKeys(objects)).toEqual([]);
  });

  it("two first saves at once keep both slots", async () => {
    const { call, objects, state } = setup();
    state.beforeIndexPut = () => call(put("2", "Two", fakeMp3()));
    expect((await call(put("1", "One", fakeMp3()))).status).toBe(200);
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("a race on the index retries and keeps both slots", async () => {
    const { call, objects, state } = setup();
    await call(put("1", "One", fakeMp3()));
    state.failIndexPuts = 1;
    const res = await call(put("2", "Two", fakeMp3()));
    expect(res.status).toBe(200);
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1", "2"]);

    state.failIndexPuts = 3;
    const lost = await call(put("4", "Four", fakeMp3()));
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: "Could not save. Try again." });
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1", "2"]);
    // The lost save's file stays, unnamed: it goes when the library is deleted.
    expect(fileKeys(objects).filter((k) => k.startsWith("lib/owner/4-"))).toHaveLength(1);
  });

  it("a real etag race keeps the other writer's slot", async () => {
    const { bucket, call, objects } = setup();
    await call(put("1", "One", fakeMp3()));
    // Another tab writes the index between our read and our write.
    const realGet = bucket.get.bind(bucket);
    let raced = false;
    (bucket as { get: unknown }).get = async (key: string) => {
      const got = await realGet(key);
      if (key === indexKey("owner") && !raced) {
        raced = true;
        const slots = storedIndex(objects)!;
        await bucket.put(indexKey("owner"), JSON.stringify({ slots: [...slots, { id: "5", name: "Five", ms: 24, v: "0123456789" }] }));
      }
      return got;
    };
    expect((await call(put("2", "Two", fakeMp3()))).status).toBe(200);
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1", "2", "5"]);
  });

  it("a bad index in R2 is cleaned on read", async () => {
    const { bucket, call } = setup();
    const slots = [
      { id: "9", name: "Nine", ms: 100, v: "0123456789" },
      { id: "2", name: "Long", ms: 5000, v: "0123456789" },
      { id: "3", name: "x".repeat(30), ms: 100, v: "0123456789" },
      { id: "4", name: "Bad v", ms: 100, v: "xyz" },
      { id: "5", name: "Half", ms: 1.5, v: "0123456789" },
      { id: "1", name: " First ", ms: 100, v: "0123456789" },
      { id: "1", name: "Second", ms: 200, v: "abcdefabcd" },
      "junk",
      null,
    ];
    await bucket.put(indexKey("owner"), JSON.stringify({ slots }));
    expect((await body(await call(req("/api/sounds")))).slots).toEqual([
      { id: "1", name: "First", ms: 100, url: "/api/sounds/1?v=0123456789" },
    ]);
  });

  it("an index that is not JSON lists empty, and a save replaces it", async () => {
    const { bucket, call, objects } = setup();
    await bucket.put(indexKey("owner"), "{not json");
    expect((await body(await call(req("/api/sounds")))).slots).toEqual([]);
    expect((await call(put("1", "One", fakeMp3()))).status).toBe(200);
    expect(storedIndex(objects)!.map((s) => s.id)).toEqual(["1"]);
  });

  it("two libraries do not mix", async () => {
    const byHeader: HostPolicy = {
      canCreate: ownerKeyPolicy.canCreate,
      soundOwner: async (r) => ({ library: r.headers.get("x-lib") ?? "", active: true }),
    };
    const { env } = setup();
    const a = put("1", "A", fakeMp3(), { "x-lib": "a" });
    expect((await serveMySounds(a, env, byHeader))!.status).toBe(200);
    const listA = await serveMySounds(req("/api/sounds", { headers: { "x-lib": "a" } }), env, byHeader);
    const bodyA = await body(listA!);
    expect(bodyA.slots.map((s) => s.id)).toEqual(["1"]);
    const listB = await serveMySounds(req("/api/sounds", { headers: { "x-lib": "b" } }), env, byHeader);
    expect((await body(listB!)).slots).toEqual([]);
    const v = bodyA.slots[0]!.url.split("?v=")[1];
    expect((await serveMySounds(req(`/api/sounds/1?v=${v}`, { headers: { "x-lib": "a" } }), env, byHeader))!.status).toBe(200);
    expect((await serveMySounds(req(`/api/sounds/1?v=${v}`, { headers: { "x-lib": "b" } }), env, byHeader))!.status).toBe(404);
  });

  it("a library id with odd characters is refused", async () => {
    const { env } = setup();
    for (const library of ["../x", "", "a/b", "x".repeat(65), "a b"]) {
      const res = await serveMySounds(req("/api/sounds"), env, policyGiving({ library, active: true }));
      expect(res!.status).toBe(403);
    }
  });

  it("a write from another site is refused", async () => {
    const { call, state } = setup();
    const evil = await call(put("1", "A", fakeMp3(), { origin: "https://evil.test" }));
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "Only the host can change these sounds." });
    const evilDel = req("/api/sounds/1", { method: "DELETE", headers: { origin: "https://evil.test" } });
    expect((await call(evilDel)).status).toBe(403);
    const evilPatch = req("/api/sounds/1", { method: "PATCH", body: "{}", headers: { origin: "https://evil.test" } });
    expect((await call(evilPatch)).status).toBe(403);
    expect(state.writes).toBe(0);
    const refused: Record<string, string>[] = [
      { origin: "null" },
      { origin: "not a url" },
      { origin: "https://x.test.evil.test" },
      { origin: "https://x.test:8443" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
      { origin: "https://x.test", "sec-fetch-site": "cross-site" },
      { origin: "https://evil.test", "sec-fetch-site": "same-site" },
    ];
    for (const headers of refused) {
      expect((await call(put("1", "A", fakeMp3(), headers))).status, JSON.stringify(headers)).toBe(403);
    }
    expect(state.writes).toBe(0);
    expect((await call(put("1", "A", fakeMp3(), { origin: "https://x.test" }))).status).toBe(200);
    expect((await call(put("2", "B", fakeMp3(), { origin: "http://x.test", "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect((await call(put("3", "C", fakeMp3()))).status).toBe(200);
    // Behind a dev proxy the Worker sees another host: the browser's Sec-Fetch-Site decides.
    expect((await call(put("4", "D", fakeMp3(), { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }))).status).toBe(200);
    // Reads are not checked.
    expect((await call(req("/api/sounds", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(200);
  });

  it("other methods get a 405", async () => {
    const { call } = setup();
    const list = await call(req("/api/sounds", { method: "POST" }));
    expect(list.status).toBe(405);
    expect(list.headers.get("allow")).toBe("GET");
    const slot = await call(req("/api/sounds/1", { method: "POST" }));
    expect(slot.status).toBe(405);
    expect(slot.headers.get("allow")).toBe("GET, PUT, PATCH, DELETE");
  });

  it("createFetch routes it", async () => {
    const { env } = setup();
    const fetch = createFetch({ policy: ownerKeyPolicy, brand: "x" });
    const res = await fetch(req("/api/sounds"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: true, slots: [] });
  });
});

describe("helpers", () => {
  it("isLibraryId takes 1 to 64 letters, digits, _ and -", () => {
    for (const ok of ["owner", "a", "A-b_9", "x".repeat(64), "AbCdEfGhIjKlMnOpQrStUvWx"]) expect(isLibraryId(ok)).toBe(true);
    for (const bad of ["", "x".repeat(65), "../x", "a/b", "a b", "a.b", 5, null, undefined]) expect(isLibraryId(bad)).toBe(false);
  });

  it("keys are under lib/<library>/", () => {
    expect(libKey("owner", "3", "0123456789")).toBe("lib/owner/3-0123456789.mp3");
    expect(indexKey("owner")).toBe("lib/owner/index.json");
  });

  it("readIndex of a missing index is empty", async () => {
    expect(await readIndex(fakeBucket().bucket, "owner")).toEqual({ slots: [], etag: null });
  });

  it("readIndex sorts by id", async () => {
    const { bucket } = fakeBucket();
    const s = (id: string) => ({ id, name: id, ms: 10, v: "0123456789" });
    await bucket.put(indexKey("owner"), JSON.stringify({ slots: [s("4"), s("1"), s("2")] }));
    const got = await readIndex(bucket, "owner");
    expect(got.slots.map((x) => x.id)).toEqual(["1", "2", "4"]);
    expect(got.etag).toBeTruthy();
  });

  it("readCapped stops past the cap", async () => {
    const stream = (...sizes: number[]) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const n of sizes) c.enqueue(new Uint8Array(n).fill(1));
          c.close();
        },
      });
    expect((await readCapped(stream(3, 4), 7))?.length).toBe(7);
    expect(await readCapped(stream(3, 5), 7)).toBeNull();
    expect((await readCapped(null, 7))?.length).toBe(0);
  });
});

describe("room routes", () => {
  async function room(library: string | null = "owner") {
    const w = setup();
    const bytes = fakeMp3();
    expect((await w.call(put("1", "One", bytes))).status).toBe(200);
    expect((await w.call(put("3", "Three", fakeMp3({ frames: 12 })))).status).toBe(200);
    const libraryOf = vi.fn(async () => library);
    const get = (path: string, init: RequestInit = {}) =>
      serveRoomSounds(new Request(`https://x.test${path}`, init), w.env, libraryOf);
    return { ...w, bytes, libraryOf, get };
  }

  it("lists the room's host sounds", async () => {
    const { get, libraryOf, objects } = await room();
    const res = (await get("/api/rooms/k7dx/sounds"))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = (await res.json()) as RoomSoundsBody;
    expect(b.pack).toBe("host");
    expect(b.sounds.map((s) => [s.id, s.name, s.url])).toEqual([
      ["1", "One", `/api/rooms/K7DX/sounds/1?v=${vOf(objects, "1")}`],
      ["3", "Three", `/api/rooms/K7DX/sounds/3?v=${vOf(objects, "3")}`],
    ]);
    expect(libraryOf).toHaveBeenCalledWith("K7DX");
  });

  it("serves a slot's file", async () => {
    const { get, objects, bytes } = await room();
    const res = (await get(`/api/rooms/K7DX/sounds/1?v=${vOf(objects, "1")}`))!;
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("the file route refuses a room that does not use that library", async () => {
    const other = await room("other");
    const v = vOf(other.objects, "1");
    expect(((await (await other.get("/api/rooms/K7DX/sounds"))!.json()) as RoomSoundsBody).sounds).toEqual([]);
    expect((await other.get(`/api/rooms/K7DX/sounds/1?v=${v}`))!.status).toBe(404);
    const none = await room(null);
    expect((await none.get("/api/rooms/K7DX/sounds"))!.status).toBe(404);
    expect((await none.get(`/api/rooms/K7DX/sounds/1?v=${v}`))!.status).toBe(404);
  });

  it("a bad code never wakes a room", async () => {
    const { get, libraryOf } = await room();
    expect((await get("/api/rooms/K7/sounds"))!.status).toBe(404);
    expect((await get("/api/rooms/K7DX!/sounds"))!.status).toBe(404);
    expect((await get("/api/rooms/K7/sounds/1?v=0123456789"))!.status).toBe(404);
    expect(libraryOf).not.toHaveBeenCalled();
  });

  it("is a 404 for a bad or empty slot, and a 405 for writes", async () => {
    const { get, objects } = await room();
    const v = vOf(objects, "1");
    for (const path of ["/sounds/7", `/sounds/2?v=${v}`, "/sounds/1.mp3"]) {
      expect((await get(`/api/rooms/K7DX${path}`))!.status).toBe(404);
    }
    const res = (await get("/api/rooms/K7DX/sounds", { method: "PUT", body: "x" }))!;
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("a bad or missing v is a 404", async () => {
    const { get, objects, libraryOf } = await room();
    const v = vOf(objects, "1")!;
    const bad = ["", "?v=", "?v=x", `?v=${v.toUpperCase()}`].filter((q) => q !== `?v=${v}`);
    for (const q of bad) {
      expect((await get(`/api/rooms/K7DX/sounds/1${q}`))!.status).toBe(404);
    }
    // None of those woke the room.
    expect(libraryOf).not.toHaveBeenCalled();
    // Good shape, but no file at that version.
    expect((await get("/api/rooms/K7DX/sounds/1?v=0123456789"))!.status).toBe(404);
  });

  it("leaves other room paths alone", async () => {
    const { get } = await room();
    expect(await get("/api/rooms", { method: "POST" })).toBeNull();
    expect(await get("/api/rooms/K7DX/upgrade")).toBeNull();
  });

  it("answers 404 without SOUNDS", async () => {
    const res = await serveRoomSounds(new Request("https://x.test/api/rooms/K7DX/sounds"), {} as ServerEnv, async () => "owner");
    expect(res!.status).toBe(404);
  });

  it("no phone ever sees the library id", async () => {
    const { get, objects } = await room();
    for (const path of ["/api/rooms/K7DX/sounds", `/api/rooms/K7DX/sounds/1?v=${vOf(objects, "1")}`]) {
      const res = (await get(path))!;
      expect([...res.headers.values()].join("\n")).not.toContain("owner");
      if (path.endsWith("sounds")) expect(await res.text()).not.toContain("owner");
    }
  });

  it("is wired into createFetch, and asks the room once per request", async () => {
    const w = await room();
    const v = vOf(w.objects, "1");
    const library = vi.fn(async () => "owner");
    const fetch = createFetch({ policy: ownerKeyPolicy, brand: "x", getRoom: async () => ({ claim: async () => true, library }) });
    const list = await fetch(new Request("https://x.test/api/rooms/k7dx/sounds"), w.env);
    expect(list.status).toBe(200);
    expect(((await list.json()) as RoomSoundsBody).sounds).toHaveLength(2);
    expect(library).toHaveBeenCalledTimes(1);
    const file = await fetch(new Request(`https://x.test/api/rooms/K7DX/sounds/1?v=${v}`, { method: "HEAD" }), w.env);
    expect(file.status).toBe(200);
    expect(library).toHaveBeenCalledTimes(2);
    const bad = await fetch(new Request(`https://x.test/api/rooms/K7DX/sounds/1?v=${v}`, { method: "POST" }), w.env);
    expect(bad.status).toBe(405);
    expect(library).toHaveBeenCalledTimes(2);
    const bare = createFetch({ policy: ownerKeyPolicy, brand: "x", getRoom: async () => ({ claim: async () => true }) });
    expect((await bare(new Request("https://x.test/api/rooms/K7DX/sounds"), w.env)).status).toBe(404);
  });
});
