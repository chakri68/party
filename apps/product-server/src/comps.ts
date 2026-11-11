import { newId, type Db } from "./db.ts";
import { grant } from "./entitlements.ts";

// A-Z minus I and O, plus 2-9: 32 symbols, so a random byte mod 32 is unbiased.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function group(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % 32]).join("");
}

/** Uppercase, no spaces or dashes. Both the input and the stored code go through this before compare. */
function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

// Matches the stored display form against an already-normalized input.
const BY_CODE = "REPLACE(REPLACE(UPPER(code), '-', ''), ' ', '') = ?";

type CodeRow = { id: string; days: number | null; max_uses: number; revoked_at: number | null };

async function find(db: Db, code: string): Promise<CodeRow | null> {
  return db
    .prepare(`SELECT id, days, max_uses, revoked_at FROM comp_codes WHERE ${BY_CODE}`)
    .bind(normalizeCode(code))
    .first<CodeRow>();
}

/** Stores the display form, e.g. "FAM-7Q2X-K9MD". */
export async function createCode(
  db: Db,
  opts: { maxUses: number; days: number | null; note?: string; prefix?: string },
  now: number,
): Promise<string> {
  const prefix = (opts.prefix ?? "CP").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const code = `${prefix}-${group(4)}-${group(4)}`;
    try {
      await db
        .prepare("INSERT INTO comp_codes (id, code, days, max_uses, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(newId(), code, opts.days, opts.maxUses, opts.note ?? null, now)
        .run();
      return code;
    } catch (e) {
      // 32^8 combinations; a collision is a fluke, a repeat is a bug.
      if (attempt >= 4 || !/UNIQUE/i.test(String(e))) throw e;
    }
  }
}

export type RedeemResult =
  | { ok: true; endsAt: number | null }
  | { ok: false; reason: "unknown" | "revoked" | "used-up" | "already-redeemed" };

export async function redeem(db: Db, userId: string, code: string, now: number): Promise<RedeemResult> {
  const row = await find(db, code);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };

  const have = await db
    .prepare("SELECT 1 AS ok FROM entitlements WHERE user_id = ? AND source = 'comp' AND ref = ?")
    .bind(userId, row.id)
    .first();
  if (have) return { ok: false, reason: "already-redeemed" };

  // The conditional update is the lock: of two users racing for the last use, one sees changes = 0.
  const took = await db
    .prepare("UPDATE comp_codes SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked_at IS NULL")
    .bind(row.id)
    .run();
  if (took.meta.changes !== 1) return { ok: false, reason: "used-up" };

  try {
    await grant(db, userId, { source: "comp", plan: "comp", days: row.days, ref: row.id }, now);
  } catch (e) {
    await db.prepare("UPDATE comp_codes SET uses = uses - 1 WHERE id = ?").bind(row.id).run();
    // Same user raced themselves past the check above; UNIQUE(user_id, source, ref) caught it.
    if (/UNIQUE/i.test(String(e))) return { ok: false, reason: "already-redeemed" };
    throw e;
  }
  return { ok: true, endsAt: row.days === null ? null : now + row.days * 86_400_000 };
}

/** Kills the code and every entitlement it granted. False if the code does not exist. */
export async function revokeCode(db: Db, code: string, now: number): Promise<boolean> {
  const row = await find(db, code);
  if (!row) return false;
  await db.batch([
    db.prepare("UPDATE comp_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, row.id),
    db
      .prepare("UPDATE entitlements SET revoked_at = ? WHERE source = 'comp' AND ref = ? AND revoked_at IS NULL")
      .bind(now, row.id),
  ]);
  return true;
}

export async function listCodes(
  db: Db,
): Promise<Array<{ code: string; uses: number; maxUses: number; days: number | null; note: string | null; revoked: boolean }>> {
  const { results } = await db
    .prepare("SELECT code, uses, max_uses, days, note, revoked_at FROM comp_codes ORDER BY created_at DESC, rowid DESC")
    .all<{ code: string; uses: number; max_uses: number; days: number | null; note: string | null; revoked_at: number | null }>();
  return results.map((r) => ({
    code: r.code,
    uses: r.uses,
    maxUses: r.max_uses,
    days: r.days,
    note: r.note,
    revoked: r.revoked_at !== null,
  }));
}
