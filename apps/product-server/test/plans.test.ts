import { describe, expect, it } from "vitest";
import { PLANS, isPlanId, planForPaddlePrice, plansFor, priceLabel, providerFor, type PlanId } from "../src/billing/plans.ts";

describe("plans", () => {
  it("picks the provider by country", () => {
    expect(providerFor("IN")).toBe("razorpay");
    expect(providerFor("US")).toBe("paddle");
    expect(providerFor(null)).toBe("paddle");
  });

  it("sells the day pass only through Razorpay", () => {
    expect(plansFor("razorpay")).toEqual(["day", "month", "year"]);
    expect(plansFor("paddle")).toEqual(["month", "year"]);
  });

  it("holds amounts in paise and cents", () => {
    expect(PLANS.day).toEqual({ days: 1, length: "24 hours", inr: 4900, usd: null });
    expect(PLANS.month).toEqual({ days: 30, length: "30 days", inr: 14900, usd: 499 });
    expect(PLANS.year).toEqual({ days: 365, length: "365 days", inr: 99900, usd: 3900 });
  });

  it("formats price labels", () => {
    expect((["day", "month", "year"] as PlanId[]).map((p) => priceLabel(p, "razorpay"))).toEqual(["₹49", "₹149", "₹999"]);
    expect(priceLabel("month", "paddle")).toBe("$4.99");
    expect(priceLabel("year", "paddle")).toBe("$39");
  });

  it("maps Paddle price ids to plans", () => {
    const env = { PADDLE_PRICE_MONTH: "pri_m", PADDLE_PRICE_YEAR: "pri_y" };
    expect(planForPaddlePrice("pri_m", env)).toBe("month");
    expect(planForPaddlePrice("pri_y", env)).toBe("year");
    expect(planForPaddlePrice("pri_other", env)).toBeNull();
    expect(planForPaddlePrice("", {})).toBeNull();
  });

  it("guards plan ids", () => {
    expect(isPlanId("year")).toBe(true);
    expect(isPlanId("week")).toBe(false);
    expect(isPlanId(null)).toBe(false);
  });
});
