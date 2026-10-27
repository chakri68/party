import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The dictionary is ~220 KB. If a client or shared file imports it, it ships to every browser.
const GAMES = join(import.meta.dirname, "../../../games");

function offenders(): string[] {
  const hits: string[] = [];
  for (const game of readdirSync(GAMES, { withFileTypes: true })) {
    if (!game.isDirectory()) continue;
    for (const side of ["client", "shared"]) {
      const dir = join(GAMES, game.name, side);
      let files: string[];
      try {
        files = readdirSync(dir, { recursive: true, encoding: "utf8" });
      } catch {
        continue; // this game has no such folder
      }
      for (const file of files) {
        if (!file.endsWith(".ts")) continue;
        if (readFileSync(join(dir, file), "utf8").includes("@games/words/dictionary")) hits.push(`${game.name}/${side}/${file}`);
      }
    }
  }
  return hits;
}

describe("the dictionary stays on the server", () => {
  it("is imported by nothing under games/*/client or games/*/shared", () => {
    expect(offenders()).toEqual([]);
  });
});
