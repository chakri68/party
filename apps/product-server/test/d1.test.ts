import { describe, expect, it } from "vitest";
import { fakeD1 } from "./d1.ts";

const user = (db: ReturnType<typeof fakeD1>, id: string, email: string) =>
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)").bind(id, email);

describe("fakeD1 batch", () => {
  it("concurrent batches both succeed and land", async () => {
    const db = fakeD1();
    await Promise.all([
      db.batch([user(db, "a", "a@x"), user(db, "b", "b@x")]),
      db.batch([user(db, "c", "c@x"), user(db, "d", "d@x")]),
    ]);
    const r = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(r?.n).toBe(4);
  });

  it("rolls back the whole batch on a constraint violation", async () => {
    const db = fakeD1();
    await user(db, "a", "dup@x").run();
    await expect(db.batch([user(db, "b", "b@x"), user(db, "c", "dup@x")])).rejects.toThrow();
    const r = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(r?.n).toBe(1);
  });

  it("batched selects return results", async () => {
    const db = fakeD1();
    const [res] = (await db.batch([db.prepare("SELECT 1 AS x")])) as { results: { x: number }[] }[];
    expect(res?.results).toEqual([{ x: 1 }]);
  });
});
