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

/** A D1 stand-in over in-memory SQLite, with every migration applied. */
export function fakeD1(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(dir, f), "utf8"));
  }

  const prepare = (sql: string, args: SqlValue[] = []) => ({
    bind: (...a: unknown[]) => prepare(sql, a as SqlValue[]),
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
  });

  return {
    prepare: prepare as unknown as Db["prepare"],
    async batch(stmts: { run(): Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as Db;
}
