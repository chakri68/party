import { describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));

import { ownerKeyPolicy, type CreateDecision, type ServerEnv } from "../src/policy.ts";
import { createFetch } from "../src/worker.ts";

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
});
