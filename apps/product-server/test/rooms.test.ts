import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));
import { grant } from "../src/entitlements.ts";
import type { ProductEnv } from "../src/env.ts";
import { hmacHex, newId, sha256Hex, type Db } from "../src/db.ts";
import { productGames, PRODUCT_LIMITS } from "../src/catalog.ts";
import { handleUpgrade, productPolicy, recordRoom } from "../src/rooms.ts";
import { gamesFor } from "@games/server/games";
import { createFetch } from "@games/server/worker";
import { fakeBucket } from "./bucket.ts";
import { fakeD1, tripCounter } from "./d1.ts";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const ORIGIN = "https://couchpartygames.com";
const KEY = "test-ip-key";

function setup(opts: { trips?: boolean; turnstile?: boolean; createLimit?: boolean | ((key: string) => boolean); ipHashKey?: string | null; claim?: boolean | ((hostKey: string) => boolean); sounds?: boolean } = {}) {
  const raw = fakeD1();
  // trips: count database round trips (and time Turnstile on the same clock).
  const counter = opts.trips ? tripCounter(raw) : null;
  const db = counter?.db ?? raw;
  const background: Promise<unknown>[] = [];
  const ctx = opts.trips ? { waitUntil: (p: Promise<unknown>) => void background.push(p) } : undefined;
  const clock = { t: T0 };
  const claims: Array<unknown> = [];
  const limitKeys: string[] = [];
  const upgrades: Array<{ code: string; hostKey: string; library?: string | null }> = [];
  const env = {
    DB: db,
    CREATE_LIMIT: {
      limit: async ({ key }: { key: string }) => (
        limitKeys.push(key), { success: typeof opts.createLimit === "function" ? opts.createLimit(key) : (opts.createLimit ?? true) }
      ),
    },
    IP_HASH_KEY: opts.ipHashKey === null ? undefined : (opts.ipHashKey ?? KEY),
    ...(opts.sounds ? { SOUNDS: fakeBucket().bucket } : {}),
  } as unknown as ProductEnv;
  const turnstile = async () => opts.turnstile ?? true;
  const deps = { now: () => clock.t, verifyTurnstile: counter ? () => counter.track(turnstile) : turnstile };
  const getRoom = async () => ({
    claim: async (g?: unknown) => (claims.push(g), true),
  });
  const fetchRooms = createFetch({ policy: productPolicy(deps), brand: "CouchParty", onRoomCreated: recordRoom(db, env.IP_HASH_KEY, deps.now), getRoom });
  const create = (init: { cookie?: string; token?: string; ip?: string } = {}) =>
    fetchRooms(
      new Request(ORIGIN + "/api/rooms", {
        method: "POST",
        headers: {
          "cf-connecting-ip": init.ip ?? "1.2.3.4",
          ...(init.token ? { "x-turnstile-token": init.token } : {}),
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
      }),
      env,
      ctx,
    );
  const upgradeDeps = {
    now: deps.now,
    getRoom: async (_env: unknown, code: string) => ({
      upgrade: async (hostKey: string, library?: string | null) => (upgrades.push({ code, hostKey, library }), hostKey === "right"),
    }),
  };
  const upgrade = (code: string, body: unknown, cookie?: string) =>
    handleUpgrade(
      new Request(`${ORIGIN}/api/rooms/${code}/upgrade`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: JSON.stringify(body),
      }),
      env,
      upgradeDeps,
    ) as Promise<Response>;
  const user = async (pass: boolean) => (await userWithId(pass)).cookie;
  const userWithId = async (pass: boolean) => {
    const id = newId();
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, `${id}@x.com`, T0).run();
    const token = newId();
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), id, T0 + HOUR).run();
    if (pass) await grant(db, id, { source: "comp", plan: "pass", days: 1, ref: "x" }, T0);
    return { id, cookie: `cp_session=${token}` };
  };
  return { db, raw, counter, background, clock, claims, limitKeys, upgrades, create, upgrade, user, userWithId };
}

const rows = async (db: Db) =>
  (await db.prepare("SELECT code, tier, ip_hash FROM rooms").all<{ code: string; tier: string; ip_hash: string }>()).results;

describe("room creation policy", () => {
  it("anonymous without a Turnstile token gets 403", async () => {
    const s = setup({ turnstile: false });
    const r = await s.create();
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Please try again." });
    expect(await rows(s.db)).toEqual([]);
  });

  it("anonymous with a token gets a code, a host key and a free row", async () => {
    const s = setup();
    const r = await s.create({ token: "t" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { code: string; hostKey: string };
    expect(body.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(body.hostKey.length).toBeGreaterThanOrEqual(24);
    expect(s.claims[0]).toEqual({ tier: "free", hostKey: body.hostKey, library: null });
    const [row] = await rows(s.db);
    expect(row).toEqual({ code: body.code, tier: "free", ip_hash: await hmacHex(KEY, "1.2.3.4") });
  });

  it("the stored IP hash is keyed: not a plain SHA-256, and another key gives another hash", async () => {
    const s = setup();
    await s.create({ token: "t" });
    const [row] = await rows(s.db);
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.ip_hash).not.toBe(await sha256Hex("1.2.3.4"));
    expect(row!.ip_hash).not.toBe(await hmacHex("other", "1.2.3.4"));
  });

  it("no IP_HASH_KEY means no free room, rather than an unkeyed hash", async () => {
    const s = setup({ ipHashKey: null });
    await expect(s.create({ token: "t" })).rejects.toThrow("IP_HASH_KEY is not set");
    expect(await rows(s.db)).toEqual([]);
  });

  it("sixth free room from one IP in 6 hours gets 429; another IP or later is fine", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await s.create({ token: "t" })).status).toBe(200);
    const r = await s.create({ token: "t" });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Too many rooms right now. Please try again later." });
    expect((await s.create({ token: "t", ip: "9.9.9.9" })).status).toBe(200);
    s.clock.t += 6 * HOUR + 1;
    expect((await s.create({ token: "t" })).status).toBe(200);
  });

  it("CREATE_LIMIT exceeded gets 429", async () => {
    const s = setup({ createLimit: false });
    const r = await s.create({ token: "t" });
    expect(r.status).toBe(429);
  });

  it("global free cap of 2000 in 6 hours gets 429", async () => {
    const s = setup();
    const stmts = Array.from({ length: 2000 }, (_, i) =>
      s.db.prepare("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES (?, 'free', ?, ?)").bind(`c${i}`, `h${i}`, T0),
    );
    await s.db.batch(stmts);
    expect((await s.create({ token: "t", ip: "7.7.7.7" })).status).toBe(429);
  });

  it("pass user skips Turnstile and gets a pass room, not counted against free caps", async () => {
    const s = setup({ turnstile: false });
    const cookie = await s.user(true);
    for (let i = 0; i < 7; i++) {
      const r = await s.create({ cookie });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { hostKey: string }).hostKey).toBeTruthy();
    }
    expect(s.claims[0]).toMatchObject({ tier: "pass" });
    expect((await rows(s.db)).every((r) => r.tier === "pass")).toBe(true);
    expect(s.limitKeys.every((k) => /^user:[\w-]+$/.test(k))).toBe(true);
  });

  it("pass users are rate limited per user, not per IP", async () => {
    const s = setup({ createLimit: (key) => !key.startsWith("user:") });
    const cookie = await s.user(true);
    const r = await s.create({ cookie });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Too many rooms right now. Please try again later." });
    expect(await rows(s.db)).toEqual([]);
    // The same IP, signed out, has its own budget.
    expect((await s.create({ token: "t" })).status).toBe(200);
  });

  it("a Pass room gets the host's library, a free room none", async () => {
    const s = setup({ sounds: true });
    const u = await s.userWithId(true);
    expect((await s.create({ cookie: u.cookie })).status).toBe(200);
    expect((await s.create({ token: "t" })).status).toBe(200);
    expect(s.claims[0]).toMatchObject({ tier: "pass", library: u.id });
    expect(s.claims[1]).toMatchObject({ tier: "free", library: null });
  });

  it("without a sounds bucket, a Pass room gets no library", async () => {
    const s = setup();
    const u = await s.userWithId(true);
    await s.create({ cookie: u.cookie });
    expect((s.claims[0] as { library?: string | null }).library ?? null).toBeNull();
  });

  it("a signed-in free user is treated as anonymous", async () => {
    const s = setup({ turnstile: false });
    const cookie = await s.user(false);
    expect((await s.create({ cookie })).status).toBe(403);
  });
});

describe("room creation round trips", () => {
  // Calls to the database and to Turnstile are held until the test lets them go.
  // A trip is the calls that are waiting together, so the counts come from
  // order, not from a timer.
  // Waits for at least n calls, then checks that exactly n were released.
  const step = async (c: NonNullable<ReturnType<typeof setup>["counter"]>, n: number) => {
    await c.waitFor(n);
    expect(c.release()).toBe(n);
  };

  it("anonymous: Turnstile and the cap counts overlap, and the record waits for nothing", async () => {
    const s = setup({ trips: true });
    const c = s.counter!;
    c.hold();
    const pending = s.create({ token: "t" });
    // Turnstile and the counts are both waiting at once: one trip for the two.
    await step(c, 2);
    // Nothing else is held up: the response comes back with the record write unfinished.
    const res = await pending;
    expect(res.status).toBe(200);
    expect(c.trips).toBe(1);
    expect(s.background).toHaveLength(1);
    // Only now does the record write get its turn.
    await step(c, 1);
    await Promise.all(s.background);
    expect(await rows(s.raw)).toHaveLength(1);
  });

  it("a pass user's session and pass come back in one trip", async () => {
    const s = setup({ trips: true });
    const cookie = await s.user(true);
    s.counter!.reset();
    s.counter!.hold();
    const pending = s.create({ cookie });
    await step(s.counter!, 1);
    expect((await pending).status).toBe(200);
    expect(s.counter!.trips).toBe(1);
  });

  it("a signed-in free user: one trip for who they are, then one for Turnstile and the counts", async () => {
    const s = setup({ trips: true });
    const cookie = await s.user(false);
    s.counter!.reset();
    s.counter!.hold();
    const pending = s.create({ cookie, token: "t" });
    await step(s.counter!, 1);
    await step(s.counter!, 2);
    expect((await pending).status).toBe(200);
    expect(s.counter!.trips).toBe(2);
  });
});

describe("upgrade", () => {
  const code = "ABCD";
  it("signed out gets 401", async () => {
    const s = setup();
    const r = await s.upgrade(code, { hostKey: "right" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Sign in first." });
  });
  it("free user gets 402", async () => {
    const s = setup();
    const r = await s.upgrade(code, { hostKey: "right" }, await s.user(false));
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "This needs Host Pass." });
    expect(s.upgrades).toEqual([]);
  });
  it("wrong host key gets 403 and leaves the row alone", async () => {
    const s = setup();
    await s.db.prepare("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES (?, 'free', 'h', ?)").bind(code, T0).run();
    const r = await s.upgrade(code, { hostKey: "wrong" }, await s.user(true));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "That is not your room." });
    expect((await rows(s.db))[0]!.tier).toBe("free");
  });
  it("right host key lifts the room and the row", async () => {
    const s = setup();
    await s.db.prepare("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES (?, 'free', 'h', ?)").bind(code, T0).run();
    const r = await s.upgrade(code, { hostKey: "right" }, await s.user(true));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect((await rows(s.db))[0]!.tier).toBe("pass");
  });
  it("upgrade passes the account's library", async () => {
    const s = setup();
    const u = await s.userWithId(true);
    expect((await s.upgrade(code, { hostKey: "right" }, u.cookie)).status).toBe(200);
    expect(s.upgrades).toEqual([{ code, hostKey: "right", library: u.id }]);
  });
  it("bad code gets 400, bad body gets 400", async () => {
    const s = setup();
    const cookie = await s.user(true);
    expect((await s.upgrade("nope!", { hostKey: "right" }, cookie)).status).toBe(400);
    expect((await s.upgrade(code, {}, cookie)).status).toBe(400);
  });
  it("ignores other routes", async () => {
    const r = await handleUpgrade(new Request(ORIGIN + "/api/rooms", { method: "POST" }), {} as ProductEnv, { now: () => T0, getRoom: async () => ({ upgrade: async () => true }) });
    expect(r).toBeNull();
  });
});

describe("catalog", () => {
  it("renames games on copies only", () => {
    const g = productGames({ blindRally: true, treasureHunt: true });
    expect(g.dominion!.manifest.name).toBe("Frontier");
    expect(g.scribbl!.manifest.name).toBe("Doodle Dash");
    const orig = gamesFor({ blindRally: true, treasureHunt: true });
    expect(orig.dominion!.manifest.name).not.toBe("Frontier");
    expect(orig.scribbl!.manifest.name).not.toBe("Doodle Dash");
    expect(g.nightfall!.manifest.name).toBe(orig.nightfall!.manifest.name);
    expect(Object.keys(g)).toEqual(expect.arrayContaining(["blind-rally", "rally", "treasure-hunt"]));
  });
  it("limits", () => {
    expect(PRODUCT_LIMITS).toEqual({ premiumGameIds: ["blind-rally", "rally", "treasure-hunt", "dominion", "long-trail", "wilds"], freeMaxPlayers: 8 });
  });
});
