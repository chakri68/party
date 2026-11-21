import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../src/db.ts";

// node:sqlite prints an ExperimentalWarning on load; drop just that one.
const emit = process.emitWarning;
process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
  const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === "ExperimentalWarning" && String(w).includes("SQLite")) return;
  return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = await import("node:sqlite");
process.emitWarning = emit;

type SqlValue = null | number | bigint | string;

/**
 * Counts round trips, the way a far-away database feels them: each call waits
 * a tick, and a trip is a run of calls that overlap. Two awaited one after the
 * other are 2 trips; two in a Promise.all are 1. `track` times anything else
 * (Turnstile, say) on the same clock.
 */
export function tripCounter(db: Db) {
  let inFlight = 0;
  let trips = 0;
  // Held mode: a call does not finish until the test lets it, so what overlaps
  // is decided by order, not by a timer racing the code under test.
  let holding = false;
  let pending: Array<() => void> = [];
  const track = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (inFlight++ === 0) trips++;
    try {
      if (holding) await new Promise<void>((r) => pending.push(r));
      else await new Promise((r) => setTimeout(r, 1));
      return await fn();
    } finally {
      inFlight--;
    }
  };
  type S = { bind(...a: unknown[]): S; first(): Promise<unknown>; all(): Promise<unknown>; run(): Promise<unknown> };
  const wrap = (st: S): S => ({
    bind: (...a) => wrap(st.bind(...a)),
    first: () => track(() => st.first()),
    all: () => track(() => st.all()),
    run: () => track(() => st.run()),
    // batch runs these synchronously, inside its own single trip.
    runSync: (st as unknown as { runSync: unknown }).runSync,
  } as S);
  const raw = db as unknown as { prepare(sql: string): S; batch(s: unknown[]): Promise<unknown> };
  const counted = {
    prepare: (sql: string) => wrap(raw.prepare(sql)),
    batch: (stmts: unknown[]) => track(() => raw.batch(stmts)),
  } as unknown as Db;
  return {
    db: counted,
    track,
    /** From now on, calls wait for `release`. Use `waitFor` to see them arrive. */
    hold() {
      holding = true;
    },
    /** Resolves once `n` calls are waiting. Throws after 2 s so a hang fails with a clear message. */
    async waitFor(n: number) {
      const deadline = Date.now() + 2000;
      while (pending.length < n) {
        if (Date.now() > deadline) throw new Error(`only ${pending.length} of ${n} calls pending`);
        await new Promise((r) => setImmediate(r));
      }
    },
    /** Lets every waiting call finish; returns how many were waiting. */
    release() {
      const now = pending;
      pending = [];
      for (const r of now) r();
      return now.length;
    },
    get trips() {
      return trips;
    },
    reset() {
      trips = 0;
    },
  };
}

/** A D1 stand-in over in-memory SQLite, with every migration applied. */
export function fakeD1(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(dir, f), "utf8"));
  }

  type Stmt = {
    bind(...a: unknown[]): Stmt;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[]; success: boolean; meta: object }>;
    run(): Promise<{ success: boolean; results: never[]; meta: { changes: number } }>;
    runSync(): { success: boolean; results: unknown[]; meta: { changes: number } };
  };

  const prepare = (sql: string, args: SqlValue[] = []): Stmt => {
    // Synchronous core, so batch can run without yielding to the event loop.
    const runSync = () => {
      const st = sqlite.prepare(sql);
      if (/^\s*(select|with|pragma)\b/i.test(sql)) {
        return { success: true, results: st.all(...args) as unknown[], meta: { changes: 0 } };
      }
      const r = st.run(...args);
      return { success: true, results: [] as unknown[], meta: { changes: Number(r.changes) } };
    };
    return {
      bind: (...a) => prepare(sql, a as SqlValue[]),
      async first<T>() {
        return (sqlite.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: sqlite.prepare(sql).all(...args) as T[], success: true, meta: {} };
      },
      async run() {
        const r = sqlite.prepare(sql).run(...args);
        return { success: true, results: [], meta: { changes: Number(r.changes) } };
      },
      runSync,
    };
  };

  return {
    prepare: prepare as unknown as Db["prepare"],
    // Atomic like D1: BEGIN..COMMIT in one tick, nothing can interleave.
    async batch(stmts: Stmt[]) {
      sqlite.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.runSync());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as Db;
}
