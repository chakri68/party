import { describe, expect, it } from "vitest";
import { PlanForm } from "../client/plan.ts";
import { g, start, toPlan } from "./helpers.ts";

/** Halted at a market, with no medicine in stock and two sick travellers. */
function sickAtMarket() {
  const s = toPlan(start(4, { length: "short" }).state);
  s.caravan.at = "saltmere";
  s.caravan.leg = null;
  s.caravan.stock.medicine = 0;
  s.caravan.health.p1 = 2;
  s.caravan.health.p2 = 1;
  const pub = g.getPublicState(s);
  expect(pub.prices).toBeTruthy();
  return pub;
}

describe("plan form doses", () => {
  it("drop the doses that the medicine no longer covers when a buy is taken back", () => {
    const pub = sickAtMarket();
    const form = new PlanForm();
    const inner = form as unknown as { qty: Record<string, number>; draft: { doses: string[] } | null };
    form.plan(pub);
    inner.qty.medicine = 2;
    inner.draft!.doses = ["p1", "p2"];
    expect(form.plan(pub).doses).toEqual(["p1", "p2"]);
    inner.qty.medicine = 1;
    expect(form.plan(pub).doses).toEqual(["p1"]);
    inner.qty.medicine = 0;
    expect(form.plan(pub).doses).toEqual([]);
  });
});
