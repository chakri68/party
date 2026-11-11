import { describe, expect, it } from "vitest";
import { activePlan, grant, tierFor } from "../src/entitlements.ts";
import { fakeD1 } from "./d1.ts";

const DAY = 86_400_000;
const now = 1_800_000_000_000;

async function withUser() {
  const db = fakeD1();
  await db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.c', ?)").bind(now).run();
  return db;
}

describe("entitlements", () => {
  it("is free with no rows", async () => {
    expect(await tierFor(await withUser(), "u1", now)).toBe("free");
  });

  it("a 1 day grant is pass until it ends", async () => {
    const db = await withUser();
    await grant(db, "u1", { source: "grant", plan: "day", days: 1, ref: null }, now);
    expect(await tierFor(db, "u1", now)).toBe("pass");
    expect(await tierFor(db, "u1", now + DAY)).toBe("free");
  });

  it("days: null never ends", async () => {
    const db = await withUser();
    await grant(db, "u1", { source: "comp", plan: "forever", days: null, ref: "c1" }, now);
    expect(await tierFor(db, "u1", now + 5000 * DAY)).toBe("pass");
  });

  it("a revoked row is free", async () => {
    const db = await withUser();
    await grant(db, "u1", { source: "grant", plan: "x", days: null, ref: null }, now);
    await db.prepare("UPDATE entitlements SET revoked_at = ?").bind(now).run();
    expect(await tierFor(db, "u1", now)).toBe("free");
  });

  it("activePlan prefers the row with no end", async () => {
    const db = await withUser();
    await grant(db, "u1", { source: "grant", plan: "day", days: 1, ref: "a" }, now);
    await grant(db, "u1", { source: "comp", plan: "forever", days: null, ref: "b" }, now);
    expect(await activePlan(db, "u1", now)).toEqual({ source: "comp", startsAt: now, endsAt: null });
    expect(await activePlan(db, "nobody", now)).toBeNull();
  });

  it("activePlan gives the row's start and end, for the account page's bar", async () => {
    const db = await withUser();
    await grant(db, "u1", { source: "comp", plan: "comp", days: 30, ref: "c" }, now);
    expect(await activePlan(db, "u1", now + 1000)).toEqual({ source: "comp", startsAt: now, endsAt: now + 30 * 86_400_000 });
  });
});
