import { describe, expect, it } from "vitest";
import { createCode, listCodes, redeem, revokeCode } from "../src/comps.ts";
import { grant, tierFor } from "../src/entitlements.ts";
import { fakeD1 } from "./d1.ts";

const DAY = 86_400_000;
const now = 1_800_000_000_000;

async function setup() {
  const db = fakeD1();
  for (const id of ["u1", "u2", "u3"]) {
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, `${id}@x.y`, now).run();
  }
  return db;
}

const usesOf = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await listCodes(db))[0]!.uses;

describe("comp codes", () => {
  it("creates codes shaped PREFIX-XXXX-XXXX from the safe alphabet", async () => {
    const db = await setup();
    const a = await createCode(db, { maxUses: 1, days: null, prefix: "FAM" }, now);
    const b = await createCode(db, { maxUses: 1, days: null }, now);
    expect(a).toMatch(/^FAM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(b).toMatch(/^CP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("redeem valid code gives pass", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 2, days: null }, now);
    expect(await redeem(db, "u1", code, now)).toEqual({ ok: true, endsAt: null });
    expect(await tierFor(db, "u1", now)).toBe("pass");
  });

  it("unknown code", async () => {
    const db = await setup();
    expect(await redeem(db, "u1", "NOPE-AAAA-BBBB", now)).toEqual({ ok: false, reason: "unknown" });
  });

  it("same user twice is already-redeemed and burns no use", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 5, days: null }, now);
    await redeem(db, "u1", code, now);
    expect(await redeem(db, "u1", code, now)).toEqual({ ok: false, reason: "already-redeemed" });
    expect(await usesOf(db)).toBe(1);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM entitlements").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("same user racing themselves gets one entitlement and one use", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 5, days: null }, now);
    const rs = await Promise.all([redeem(db, "u1", code, now), redeem(db, "u1", code, now)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await usesOf(db)).toBe(1);
  });

  it("used-up after maxUses", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 1, days: null }, now);
    await redeem(db, "u1", code, now);
    expect(await redeem(db, "u2", code, now)).toEqual({ ok: false, reason: "used-up" });
    expect(await tierFor(db, "u2", now)).toBe("free");
  });

  it("two users racing for the last use: exactly one wins", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 1, days: null }, now);
    const rs = await Promise.all([redeem(db, "u1", code, now), redeem(db, "u2", code, now)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await usesOf(db)).toBe(1);
  });

  it("matches lowercase with stray spaces", async () => {
    const db = await setup();
    await db
      .prepare("INSERT INTO comp_codes (id, code, days, max_uses, created_at) VALUES ('c1', 'FAM-7Q2X-K9MD', NULL, 1, ?)")
      .bind(now)
      .run();
    expect((await redeem(db, "u1", " fam 7q2x k9md ", now)).ok).toBe(true);
  });

  it("days: 30 ends 30 days out", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 1, days: 30 }, now);
    expect(await redeem(db, "u1", code, now)).toEqual({ ok: true, endsAt: now + 30 * DAY });
  });

  it("revoke kills the code and earlier redemptions", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 3, days: null }, now);
    await redeem(db, "u1", code, now);
    expect(await revokeCode(db, code, now)).toBe(true);
    expect(await tierFor(db, "u1", now)).toBe("free");
    expect(await redeem(db, "u2", code, now)).toEqual({ ok: false, reason: "revoked" });
    expect((await listCodes(db))[0]!.revoked).toBe(true);
    expect(await revokeCode(db, "NOPE-AAAA-BBBB", now)).toBe(false);
  });

  it("listCodes reports fields", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 4, days: 7, note: "for mom", prefix: "MOM" }, now);
    expect(await listCodes(db)).toEqual([{ code, uses: 0, maxUses: 4, days: 7, note: "for mom", revoked: false }]);
  });
  it("redeeming while a pass is active reports the stacked end", async () => {
    const db = await setup();
    await grant(db, "u1", { source: "razorpay", plan: "month", days: 30, ref: "pay_1" }, now);
    const code = await createCode(db, { maxUses: 1, days: 10 }, now);
    expect(await redeem(db, "u1", code, now)).toEqual({ ok: true, endsAt: now + 40 * DAY });
  });

  it("revoking a code pulls a queued paid pass forward", async () => {
    const db = await setup();
    const code = await createCode(db, { maxUses: 1, days: 10 }, now);
    await redeem(db, "u1", code, now);
    await grant(db, "u1", { source: "razorpay", plan: "month", days: 30, ref: "pay_1" }, now);
    await revokeCode(db, code, now + DAY);
    const row = await db.prepare("SELECT starts_at, ends_at FROM entitlements WHERE ref = 'pay_1'").first();
    expect(row).toEqual({ starts_at: now + DAY, ends_at: now + 31 * DAY });
  });
});
