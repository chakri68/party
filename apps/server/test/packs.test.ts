import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));

import { IMMUTABLE } from "../src/godot.ts";
import { packListBody, servePacks, soundPacksFor, type PacksEnv } from "../src/packs.ts";
import { ownerKeyPolicy, type ServerEnv } from "../src/policy.ts";
import { createFetch } from "../src/worker.ts";

// A fake R2 bucket: only get(key), like the route uses.
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function bucket(objects: Record<string, Uint8Array | string>): NonNullable<PacksEnv["MEMES"]> {
  return {
    async get(key: string) {
      const stored = objects[key];
      if (stored === undefined) return null;
      const bytes = typeof stored === "string" ? new TextEncoder().encode(stored) : stored;
      return {
        httpEtag: `"etag-${key.length}"`,
        body: new Response(bytes).body,
        async text() {
          return new TextDecoder().decode(bytes);
        },
      } as unknown as R2ObjectBody;
    },
  } as NonNullable<PacksEnv["MEMES"]>;
}

const good = { id: "bruh", name: "Bruh", file: "bruh.mp3", ms: 1200, source: "a clip", v: "0123456789" };
const index = (sounds: unknown[]) => JSON.stringify({ sounds });
const get = (path: string, init?: RequestInit) => new Request(`https://x.test${path}`, init);
const withIndex = (sounds: unknown[] = [good]) => ({ MEMES: bucket({ "memes/index.json": index(sounds), "memes/bruh.mp3": BYTES }) });

describe("servePacks", () => {
  it("lists the memes pack", async () => {
    const res = (await servePacks(get("/api/packs/memes"), withIndex()))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      pack: "memes",
      sounds: [{ id: "bruh", name: "Bruh", ms: 1200, url: "/api/packs/memes/bruh.mp3?v=0123456789" }],
    });
  });

  it("drops bad entries in the index", async () => {
    const env = withIndex([
      { ...good, id: "../x", file: "../x.mp3" },
      { ...good, id: "long", file: "long.mp3", ms: 5000 },
      { ...good, id: "nov", file: "nov.mp3", v: undefined },
      good,
      { ...good, name: "Second" },
    ]);
    const res = (await servePacks(get("/api/packs/memes"), env))!;
    expect(((await res.json()) as { sounds: { id: string; name: string }[] }).sounds.map((s) => [s.id, s.name])).toEqual([["bruh", "Bruh"]]);
  });

  it("is a 404 when the index is not JSON", async () => {
    const env = { MEMES: bucket({ "memes/index.json": "not json" }) };
    expect((await servePacks(get("/api/packs/memes"), env))!.status).toBe(404);
  });

  it("serves a file with a long cache", async () => {
    const res = (await servePacks(get("/api/packs/memes/bruh.mp3?v=0123456789"), withIndex()))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("is a 404 without the MEMES binding", async () => {
    for (const path of ["/api/packs/memes", "/api/packs/memes/bruh.mp3"]) {
      expect((await servePacks(get(path), {}))!.status).toBe(404);
    }
  });

  it("is a 404 for a bad id, a missing file or another path", async () => {
    for (const path of [
      "/api/packs/memes/BRUH.mp3",
      "/api/packs/memes/..%2Fx.mp3",
      "/api/packs/memes/nope.mp3",
      "/api/packs/free",
      "/api/packs/memes/bruh.ogg",
      "/api/packs/memes/",
      "/api/packs/",
    ]) {
      expect((await servePacks(get(path), withIndex()))!.status, path).toBe(404);
    }
  });

  it("is a 405 for other methods", async () => {
    for (const path of ["/api/packs/memes", "/api/packs/memes/bruh.mp3"]) {
      const res = (await servePacks(get(path, { method: "POST" }), withIndex()))!;
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
  });

  it("leaves other paths alone", async () => {
    expect(await servePacks(get("/api/rooms"), withIndex())).toBeNull();
  });
});

describe("packListBody", () => {
  it("gives an empty list for junk", () => {
    expect(packListBody(null)).toEqual({ pack: "memes", sounds: [] });
    expect(packListBody({ sounds: "x" })).toEqual({ pack: "memes", sounds: [] });
  });
});

describe("soundPacksFor", () => {
  it("names memes only when it is bound", () => {
    expect(soundPacksFor({})).toEqual([]);
    expect(soundPacksFor(withIndex())).toEqual(["memes"]);
  });
});

describe("createFetch", () => {
  it("routes the pack list", async () => {
    const fetch = createFetch({ policy: ownerKeyPolicy, brand: "x" });
    const res = await fetch(get("/api/packs/memes"), withIndex() as ServerEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pack: string }).pack).toBe("memes");
  });
});
