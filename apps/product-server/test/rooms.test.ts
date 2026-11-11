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
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const ORIGIN = "https://couchpartygames.com";
const KEY = "test-ip-key";

function setup(opts: { turnstile?: boolean; createLimit?: boolean | ((key: string) => boolean); ipHashKey?: string | null; claim?: boolean | ((hostKey: string) => boolean) } = {}) {
  const db = fakeD1();
  const clock = { t: T0 };
  const claims: Array<unknown> = [];
  const limitKeys: string[] = [];
  const upgrades: Array<{ code: string; hostKey: string }> = [];
  const env = {
    DB: db,
    CREATE_LIMIT: {
      limit: async ({ key }: { key: string }) => (
        limitKeys.push(key), { success: typeof opts.createLimit === "function" ? opts.createLimit(key) : (opts.createLimit ?? true) }
      ),
    },
    IP_HASH_KEY: opts.ipHashKey === null ? undefined : (opts.ipHashKey ?? KEY),
  } as unknown as ProductEnv;
  const deps = { now: () => clock.t, verifyTurnstile: async () => opts.turnstile ?? true };
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
    );
  const upgradeDeps = {
    now: deps.now,
    getRoom: async (_env: unknown, code: string) => ({
      upgrade: async (hostKey: string) => (upgrades.push({ code, hostKey }), hostKey === "right"),
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
  const user = async (pass: boolean) => {
    const id = newId();
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, `${id}@x.com`, T0).run();
    const token = newId();
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), id, T0 + HOUR).run();
    if (pass) await grant(db, id, { source: "comp", plan: "pass", days: 1, ref: "x" }, T0);
    return `cp_session=${token}`;
  };
  return { db, clock, claims, limitKeys, upgrades, create, upgrade, user };
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
    expect(s.claims[0]).toEqual({ tier: "free", hostKey: body.hostKey });
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

  it("a signed-in free user is treated as anonymous", async () => {
    const s = setup({ turnstile: false });
    const cookie = await s.user(false);
    expect((await s.create({ cookie })).status).toBe(403);
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
    expect(PRODUCT_LIMITS).toEqual({ premiumGameIds: ["blind-rally", "rally", "treasure-hunt", "dominion"], freeMaxPlayers: 8 });
  });
});
