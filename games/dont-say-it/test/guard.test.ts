import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// server/cards.ts holds every card. If a client or shared file imports
// anything under server/, it ships to every browser, guessers included.
const ROOT = join(import.meta.dirname, "..");

function offenders(): string[] {
  const hits: string[] = [];
  for (const side of ["client", "shared"]) {
    const dir = join(ROOT, side);
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|css)$/.test(file)) continue;
      const text = readFileSync(join(dir, file), "utf8");
      if (/server\/cards|\/server(\.ts|\/index|["'])|@games\/dont-say-it\/server/.test(text)) hits.push(`${side}/${file}`);
    }
  }
  return hits;
}

describe("the cards stay on the server", () => {
  it("nothing under client/ or shared/ imports server/", () => {
    expect(offenders()).toEqual([]);
  });
});
