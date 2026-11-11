import { describe, expect, it } from "vitest";
import { prune } from "../src/prune.ts";
import { fakeD1 } from "./d1.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("prune", () => {
  it("drops rows past each cutoff and keeps the rest", async () => {
    const db = fakeD1();
    const exec = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
    await exec("INSERT INTO users (id, email, created_at) VALUES ('u', 'a@x.com', 0)");
    // login_tokens: gone once expired for more than a day
    await exec("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('old', 'a@x.com', ?)", NOW - DAY - 1);
    await exec("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('recent', 'a@x.com', ?)", NOW - DAY + 1);
    // rooms: gone once older than a day
    await exec("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES ('OLD1', 'free', 'h', ?)", NOW - DAY - 1);
    await exec("INSERT INTO rooms (code, tier, ip_hash, created_at) VALUES ('NEW1', 'free', 'h', ?)", NOW - DAY + 1);
    // sessions: gone as soon as they expire
    await exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('dead', 'u', ?)", NOW - 1);
    await exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('live', 'u', ?)", NOW + 1);

    await prune(db, NOW);

    const ids = async (sql: string) => (await db.prepare(sql).all<{ k: string }>()).results.map((r) => r.k);
    expect(await ids("SELECT token_hash AS k FROM login_tokens")).toEqual(["recent"]);
    expect(await ids("SELECT code AS k FROM rooms")).toEqual(["NEW1"]);
    expect(await ids("SELECT token_hash AS k FROM sessions")).toEqual(["live"]);
    expect(await ids("SELECT id AS k FROM users")).toEqual(["u"]);
  });
});
