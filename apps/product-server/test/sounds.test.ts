import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));

import { indexKey, libKey, serveMySounds, type MySoundsBody } from "@games/server/host-sounds";
import type { ServerEnv } from "@games/server/policy";
import { fakeMp3 } from "../../../packages/sounds/test/mp3-fixture.ts";
import { newId, sha256Hex } from "../src/db.ts";
import { grant } from "../src/entitlements.ts";
import type { ProductEnv } from "../src/env.ts";
import { productPolicy } from "../src/rooms.ts";
import { deleteLibrary, productSoundOwner } from "../src/sounds.ts";
import { fakeBucket } from "./bucket.ts";
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
const ORIGIN = "https://couchpartygames.com";

function setup() {
  const db = fakeD1();
  const b = fakeBucket();
  const clock = { t: T0 };
  const env = { DB: db, SOUNDS: b.bucket } as unknown as ProductEnv;
  const policy = productPolicy({ now: () => clock.t, verifyTurnstile: async () => true });
  /** A user with a 30-day session; `passDays` gives them a Host Pass from T0. */
  const user = async (passDays?: number) => {
    const id = newId();
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, `${id}@x.com`, T0).run();
    const token = newId();
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), id, T0 + 30 * DAY).run();
    if (passDays !== undefined) await grant(db, id, { source: "comp", plan: "pass", days: passDays, ref: "x" }, T0);
    return { id, cookie: `cp_session=${token}` };
  };
  const req = (path: string, cookie?: string, init: RequestInit = {}) =>
    new Request(ORIGIN + path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) } });
  const owner = (cookie?: string) => productSoundOwner(req("/api/sounds", cookie), env, clock.t);
  const call = async (r: Request) => {
    const res = await serveMySounds(r, env as unknown as ServerEnv, policy);
    if (!res) throw new Error("not routed");
    return res;
  };
  return { db, env, clock, policy, user, req, owner, call, ...b };
}

const saveIndex = async (bucket: R2Bucket, library: string, slots: Array<{ id: string; name: string; ms: number; v: string }>) => {
  await bucket.put(indexKey(library), JSON.stringify({ slots }));
  for (const s of slots) await bucket.put(libKey(library, s.id, s.v), fakeMp3());
};

describe("soundOwner", () => {
  it("a Pass user owns their library, active", async () => {
    const s = setup();
    const u = await s.user(30);
    expect(await s.owner(u.cookie)).toEqual({ library: u.id, active: true });
    // A Pass user needs no bucket call at all.
    expect(s.state.headCalls).toBe(0);
  });

  it("a free user with saved sounds owns them, not active", async () => {
    const s = setup();
    const u = await s.user();
    await saveIndex(s.bucket, u.id, [{ id: "1", name: "Horn", ms: 500, v: "0123456789" }]);
    s.state.headCalls = 0;
    expect(await s.owner(u.cookie)).toEqual({ library: u.id, active: false });
    expect(s.state.headCalls).toBe(1);
  });

  it("a free user with no sounds, and no cookie, own nothing", async () => {
    const s = setup();
    const u = await s.user();
    expect(await s.owner(u.cookie)).toBeNull();
    expect(await s.owner()).toBeNull();
    expect(await s.owner("cp_session=nope")).toBeNull();
  });

  it("productPolicy uses it", async () => {
    const s = setup();
    const u = await s.user(30);
    expect(await s.policy.soundOwner!(s.req("/api/sounds", u.cookie), s.env as unknown as ServerEnv)).toEqual({ library: u.id, active: true });
  });
});

describe("a lapsed host", () => {
  it("can open, rename and remove, but not add", async () => {
    const s = setup();
    const u = await s.user(1);
    const put = (slot: string) =>
      s.call(s.req(`/api/sounds/${slot}?name=Bell`, u.cookie, { method: "PUT", body: fakeMp3(), headers: { "content-type": "audio/mpeg" } }));

    // While the Pass is on, a sound saves.
    expect((await put("1")).status).toBe(200);
    expect((await put("2")).status).toBe(200);

    s.clock.t = T0 + 2 * DAY;
    const list = await s.call(s.req("/api/sounds", u.cookie));
    expect(list.status).toBe(200);
    const body = (await list.json()) as MySoundsBody;
    expect(body.active).toBe(false);
    expect(body.slots.map((x) => x.id)).toEqual(["1", "2"]);

    const play = await s.call(s.req(body.slots[0]!.url, u.cookie));
    expect(play.status).toBe(200);

    const renamed = await s.call(
      s.req("/api/sounds/1", u.cookie, { method: "PATCH", body: JSON.stringify({ name: "Drum" }), headers: { "content-type": "application/json" } }),
    );
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as MySoundsBody).slots[0]!.name).toBe("Drum");

    const removed = await s.call(s.req("/api/sounds/2", u.cookie, { method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as MySoundsBody).slots.map((x) => x.id)).toEqual(["1"]);

    for (const slot of ["1", "3"]) {
      const r = await put(slot);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "Get Host Pass to add sounds." });
    }
  });

  it("someone else's cookie can't touch the library", async () => {
    const s = setup();
    const a = await s.user(30);
    const b = await s.user(30);
    await saveIndex(s.bucket, a.id, [{ id: "1", name: "Horn", ms: 500, v: "0123456789" }]);
    const list = (await (await s.call(s.req("/api/sounds", b.cookie))).json()) as MySoundsBody;
    expect(list.slots).toEqual([]);
  });
});

describe("deleteLibrary", () => {
  it("deletes every key under lib/<id>/, page by page, and nothing else", async () => {
    const s = setup();
    s.state.pageSize = 2;
    for (const k of ["lib/a/index.json", "lib/a/1-0000000000.mp3", "lib/a/2-1111111111.mp3", "lib/a/3-2222222222.mp3", "lib/a/4-3333333333.mp3", "lib/ab/index.json", "lib/b/index.json"]) {
      await s.bucket.put(k, "x");
    }
    await deleteLibrary(s.bucket, "a");
    expect([...s.objects.keys()].sort()).toEqual(["lib/ab/index.json", "lib/b/index.json"]);
    expect(s.state.listCalls).toBeGreaterThan(1);
  });

  it("a library id that isn't one deletes nothing", async () => {
    const s = setup();
    await s.bucket.put("lib/a/index.json", "x");
    for (const bad of ["", "a/..", "../a", "a/b"]) await deleteLibrary(s.bucket, bad);
    expect([...s.objects.keys()]).toEqual(["lib/a/index.json"]);
    expect(s.state.listCalls).toBe(0);
  });

  it("an empty library is fine", async () => {
    const s = setup();
    await deleteLibrary(s.bucket, "a");
    expect(s.objects.size).toBe(0);
  });
});
