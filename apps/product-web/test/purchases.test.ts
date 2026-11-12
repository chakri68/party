import { describe, expect, it } from "vitest";
import { purchaseLine } from "../src/account.ts";

const base = { status: "paid", createdAt: Date.UTC(2026, 10, 12, 23, 30) };

describe("purchaseLine", () => {
  it("formats rupees", () => {
    expect(purchaseLine({ ...base, plan: "month", amount: 14900, currency: "INR" })).toBe("12 Nov 2026 · 30 days · ₹149");
  });
  it("formats dollars with cents", () => {
    expect(purchaseLine({ ...base, plan: "month", amount: 499, currency: "USD" })).toBe("12 Nov 2026 · 30 days · $4.99");
  });
  it("drops zero cents", () => {
    expect(purchaseLine({ ...base, plan: "year", amount: 3900, currency: "USD" })).toBe("12 Nov 2026 · 365 days · $39");
  });
  it("handles other currencies", () => {
    expect(purchaseLine({ ...base, plan: "month", amount: 399, currency: "GBP" })).toBe("12 Nov 2026 · 30 days · £3.99");
  });
});
