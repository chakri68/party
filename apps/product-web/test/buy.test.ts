import { describe, expect, it } from "vitest";
import type { Billing, Me } from "../src/api.ts";
import { foreverPass, paddleOutcome, sheetMode, takeBuyParam, takePaidParam, waitForPass, withBuy } from "../src/buy.ts";

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

describe("takePaidParam", () => {
  const run = (href: string) => {
    const urls: string[] = [];
    const paid = takePaidParam(new URL(href, ORIGIN), (p) => void urls.push(p));
    return { paid, urls };
  };
  it("is true for paid=1 and strips it", () => {
    expect(run("/account?paid=1")).toEqual({ paid: true, urls: ["/account"] });
  });
  it("keeps the other params", () => {
    expect(run("/account?paid=1&x=2#h")).toEqual({ paid: true, urls: ["/account?x=2#h"] });
  });
  it("strips junk values but says false", () => {
    expect(run("/account?paid=yes")).toEqual({ paid: false, urls: ["/account"] });
  });
  it("leaves the address alone without paid", () => {
    expect(run("/account")).toEqual({ paid: false, urls: [] });
  });
});

describe("foreverPass", () => {
  it.each([
    ["free", { email: "a@x.com", tier: "free" }, false],
    ["signed out", { email: null, tier: "free" }, false],
    ["pass with an end", { email: "a@x.com", tier: "pass", plan: { source: "purchase", endsAt: 5 } }, false],
    ["pass with no end", { email: "a@x.com", tier: "pass", plan: { source: "comp", endsAt: null } }, true],
    ["pass with no plan facts", { email: "a@x.com", tier: "pass" }, true],
  ] as const)("%s → %s", (_n, m, want) => {
    expect(foreverPass(m as Me)).toBe(want);
  });
});

describe("paddleOutcome", () => {
  it("completed needs a transaction id", () => {
    expect(paddleOutcome({ name: "checkout.completed", data: { transaction_id: "txn_1" } })).toEqual({ kind: "completed", txn: "txn_1" });
    expect(paddleOutcome({ name: "checkout.completed" })).toBeNull();
  });
  it("closed is closed", () => {
    expect(paddleOutcome({ name: "checkout.closed" })).toEqual({ kind: "closed" });
  });
  it("checkout.error is an error: the checkout never opened, so nothing was charged", () => {
    expect(paddleOutcome({ name: "checkout.error" })).toEqual({ kind: "error" });
  });
  it("ignores everything else, payment.failed included (the buyer can retry in the overlay)", () => {
    for (const name of ["checkout.loaded", "checkout.payment.failed", "checkout.warning", undefined]) expect(paddleOutcome({ name })).toBeNull();
  });
});
