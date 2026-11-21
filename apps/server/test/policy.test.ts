import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));

import { ownerKeyPolicy, type CreateDecision, type ServerEnv } from "../src/policy.ts";
import { createFetch, parseRoomSetup } from "../src/worker.ts";

const env = (extra: Partial<ServerEnv> = {}) => ({ ...extra }) as ServerEnv;
const post = (bearer?: string) =>
  new Request("https://x.test/api/rooms", {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("ownerKeyPolicy", () => {
  it("fails closed with 503 when no OWNER_KEY is set", async () => {
    const d = await ownerKeyPolicy.canCreate(post("anything"), env());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.response.status).toBe(503);
  });

  it("403s a wrong or missing bearer", async () => {
    for (const bearer of ["nope", undefined]) {
      const d = await ownerKeyPolicy.canCreate(post(bearer), env({ OWNER_KEY: "secret" }));
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.response.status).toBe(403);
    }
  });

  it("grants a pass room to the right bearer", async () => {
    const d = await ownerKeyPolicy.canCreate(post("secret"), env({ OWNER_KEY: "secret" }));
    expect(d).toEqual({ ok: true, grant: { tier: "pass", hostKey: null } });
  });
});

describe("createFetch", () => {
  it("returns extra fields from the policy next to the code", async () => {
    const claimed: unknown[] = [];
    const created: string[] = [];
    const fetch = createFetch({
      brand: "Test",
      policy: {
        canCreate: async (): Promise<CreateDecision> => ({
          ok: true,
          grant: { tier: "free", hostKey: "hk" },
          extra: { hostKey: "hk" },
        }),
      },
      getRoom: async () => ({
        claim: async (grant) => {
          claimed.push(grant);
          return true;
        },
      }),
      onRoomCreated: async (code) => void created.push(code),
    });
    const res = await fetch(post(), env());
    const body = (await res.json()) as { code: string; hostKey: string };
    expect(res.status).toBe(200);
    expect(body.hostKey).toBe("hk");
    expect(body.code).toMatch(/^[A-Z0-9]+$/);
    expect(claimed).toEqual([{ tier: "free", hostKey: "hk" }]);
    expect(created).toEqual([body.code]);
  });

  it("answers without waiting for onRoomCreated when it has a ctx, and hands the record to waitUntil", async () => {
    let finish!: () => void;
    const record = new Promise<void>((r) => (finish = r));
    const waited: Promise<unknown>[] = [];
    const fetch = createFetch({
      brand: "Test",
      policy: { canCreate: async (): Promise<CreateDecision> => ({ ok: true, grant: { tier: "free", hostKey: "hk" } }) },
      getRoom: async () => ({ claim: async () => true }),
      // Never settles until the test says so: an awaited record would hang the response.
      onRoomCreated: () => record,
    });
    const res = await fetch(post(), env(), { waitUntil: (p) => void waited.push(p) });
    expect(res.status).toBe(200);
    expect(waited).toHaveLength(1);
    finish();
    await waited[0];
  });
});

describe("parseRoomSetup", () => {
  const parse = (q: string) => parseRoomSetup(new URL("https://x.test/api/rooms" + q));

  it("reads the game and the count", () => {
    expect(parse("?game=cheat&computers=3")).toEqual({ gameId: "cheat", computers: 3 });
  });
  it("leaves the count out when it is missing or not a number", () => {
    expect(parse("?game=cheat")).toEqual({ gameId: "cheat", computers: undefined });
    expect(parse("?game=cheat&computers=abc")).toEqual({ gameId: "cheat", computers: undefined });
    expect(parse("?game=cheat&computers=")).toEqual({ gameId: "cheat", computers: undefined });
  });
  it("is undefined without a game", () => {
    expect(parse("?computers=3")).toBeUndefined();
    expect(parse("")).toBeUndefined();
    expect(parse("?game=")).toBeUndefined();
  });
});

describe("createFetch room setup", () => {
  const policy = { canCreate: async (): Promise<CreateDecision> => ({ ok: true, grant: { tier: "pass", hostKey: null } }) };
  const run = async (query: string) => {
    const calls: unknown[][] = [];
    const fetch = createFetch({
      brand: "Test",
      policy,
      getRoom: async () => ({
        claim: async (...args: unknown[]) => {
          calls.push(args);
          return true;
        },
      }),
    });
    const res = await fetch(new Request("https://x.test/api/rooms" + query, { method: "POST" }), env());
    return { res, calls };
  };

  it("passes the setup to claim", async () => {
    const { res, calls } = await run("?game=cheat&computers=3");
    expect(res.status).toBe(200);
    expect(calls).toEqual([[{ tier: "pass", hostKey: null }, { gameId: "cheat", computers: 3 }]]);
  });
  it("passes no setup without a game", async () => {
    const { calls } = await run("");
    expect(calls[0]![1]).toBeUndefined();
  });
});
