import { describe, expect, it } from "vitest";
import type { Billing, Me } from "../src/api.ts";
import { sheetMode, takeBuyParam, waitForPass, withBuy } from "../src/buy.ts";

const ORIGIN = "https://couchpartygames.com";

describe("withBuy", () => {
  it("adds buy to a bare path", () => {
    expect(withBuy("/pricing", "month")).toBe("/pricing?buy=month");
  });
  it("keeps the query that is already there", () => {
    expect(withBuy("/room/ABCD?upgrade=1", "day")).toBe("/room/ABCD?upgrade=1&buy=day");
  });
  it("replaces an old buy instead of adding a second one", () => {
    expect(withBuy("/pricing?buy=day", "year")).toBe("/pricing?buy=year");
  });
});

describe("takeBuyParam", () => {
  const run = (href: string) => {
    const urls: string[] = [];
    const plan = takeBuyParam(new URL(href, ORIGIN), (p) => void urls.push(p));
    return { plan, urls };
  };
  it("returns the plan and strips it from the address", () => {
    expect(run("/pricing?buy=year")).toEqual({ plan: "year", urls: ["/pricing"] });
  });
  it("keeps the other params", () => {
    expect(run("/room/ABCD?upgrade=1&buy=day#x")).toEqual({ plan: "day", urls: ["/room/ABCD?upgrade=1#x"] });
  });
  it("returns null for a plan that does not exist, and still strips it", () => {
    expect(run("/pricing?buy=week")).toEqual({ plan: null, urls: ["/pricing"] });
  });
  it("leaves the address alone when there is no buy", () => {
    expect(run("/pricing?x=1")).toEqual({ plan: null, urls: [] });
  });
});

describe("waitForPass", () => {
  const fake = (counts: number[]) => {
    let calls = 0;
    let sleeps = 0;
    const deps = {
      me: async (): Promise<Me> => {
        const n = counts[Math.min(calls++, counts.length - 1)]!;
        return { email: "a@x.com", tier: "free", purchases: Array(n).fill({ plan: "month", amount: 14900, currency: "INR", status: "paid", createdAt: 0 }) };
      },
      sleep: async (ms: number) => {
        expect(ms).toBe(3000);
        sleeps++;
      },
    };
    return { deps, calls: () => calls, sleeps: () => sleeps };
  };

  it("is done once a new purchase shows up, even when one was there before", async () => {
    const f = fake([1, 1, 2]);
    expect(await waitForPass(1, f.deps)).toBe("done");
    expect(f.calls()).toBe(3);
    expect(f.sleeps()).toBe(2);
  });
  it("gives up as pending after 20 tries", async () => {
    const f = fake([1]);
    expect(await waitForPass(1, f.deps)).toBe("pending");
    expect(f.calls()).toBe(20);
  });
});

describe("sheetMode", () => {
  const billing: Billing = {
    provider: "razorpay",
    razorpayKeyId: "rzp_test_x",
    paddle: { env: "sandbox", token: "t", prices: { month: "pri_m", year: "pri_y" } },
  };
  const out: Me = { email: null, tier: "free" };
  const free: Me = { id: "u1", email: "a@x.com", tier: "free", purchases: [] };
  const pass: Me = { id: "u1", email: "a@x.com", tier: "pass", purchases: [] };

  it.each([
    ["signed out, host", out, true, billing, "sign-in"],
    ["signed out, not host", out, false, billing, "sign-in"],
    ["signed out, no billing", out, true, null, "sign-in"],
    ["free host, billing on", free, true, billing, "buy"],
    ["free host, billing off", free, true, null, "code-only"],
    ["pass host, billing on", pass, true, billing, "use-pass"],
    ["pass host, billing off", pass, true, null, "use-pass"],
    ["free, not host, billing on", free, false, billing, "not-host"],
    ["free, not host, billing off", free, false, null, "not-host"],
    ["pass, not host", pass, false, billing, "not-host"],
  ] as const)("%s → %s", (_name, m, isHost, b, want) => {
    expect(sheetMode(m, isHost, b)).toBe(want);
  });
});
