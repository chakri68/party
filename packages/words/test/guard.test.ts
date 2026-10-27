import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Anything a client or shared file imports ships to every browser. Two things
// must not: the dictionary (~220 KB), and a game's server/ folder, which is
// where the answers live (Imposter's words, Bluff's real definitions, Don't
// Say It's cards, the Bomb's category lists).
const GAMES = join(import.meta.dirname, "../../../games");

/**
 * Server imports a client is allowed, each with its reason. Dominion's replay
 * re-runs the match in the browser after it's over, on purpose, and loads the
 * rules lazily so nobody pays for them until they watch. Nothing in them is secret.
 */
const ALLOWED: Record<string, readonly string[]> = {
  "dominion/client/view.ts": ["../server/replay.ts", "../server/projection.ts", "../server/game.ts"],
};

/** Every client/ and shared/ source file, as [game, path relative to games/]. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
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
      for (const file of files) if (/\.(ts|css)$/.test(file)) out.push([game.name, join(game.name, side, file)]);
    }
  }
  return out;
}

/** What a file imports: static, re-export, side-effect, dynamic, CSS @import. Comments aren't stripped, so a quoted import in one counts. */
function specifiers(text: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\()?\s*)["']([^"']+)["']/g;
  return [...text.matchAll(re)].map((m) => m[1]!);
}

/** Does this specifier, from this file, land in any game's server/? */
function intoServer(file: string, spec: string): boolean {
  if (/^@games\/[^/]+\/server(\/|$)/.test(spec)) return true;
  if (!spec.startsWith(".")) return false;
  const target = relative(GAMES, resolve(GAMES, dirname(file), spec)).split(sep);
  return target.length > 1 && target[1] === "server" && !target[0]!.startsWith("..");
}

describe("the guard's parser", () => {
  it("finds every import shape", () => {
    const text = [
      'import { a } from "../server/words.ts";',
      "import type { B } from '../server/types.ts';",
      'export * from "../server/x.ts";',
      'import "../server/side.ts";',
      'const m = await import("../server/lazy.ts");',
      '@import url("../server/a.css");',
    ].join("\n");
    expect(specifiers(text)).toEqual(["../server/words.ts", "../server/types.ts", "../server/x.ts", "../server/side.ts", "../server/lazy.ts", "../server/a.css"]);
    expect(intoServer("bluff/client/view.ts", "../server/words.ts")).toBe(true);
    expect(intoServer("bluff/client/deep/x.ts", "../../server")).toBe(true);
    expect(intoServer("bluff/shared/x.ts", "@games/imposter/server/words.ts")).toBe(true);
    expect(intoServer("bluff/client/view.ts", "../shared/types.ts")).toBe(false);
    expect(intoServer("bluff/client/view.ts", "@games/game-core")).toBe(false);
  });
});

describe("secrets stay on the server", () => {
  it("nothing under games/*/client or games/*/shared imports a server/ folder", () => {
    const hits: string[] = [];
    for (const [, file] of sources()) {
      const allowed = ALLOWED[file.split(sep).join("/")] ?? [];
      for (const spec of specifiers(readFileSync(join(GAMES, file), "utf8"))) {
        if (intoServer(file, spec) && !allowed.includes(spec)) hits.push(`${file} → ${spec}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the dictionary is imported by nothing under games/*/client or games/*/shared", () => {
    const hits = sources()
      .filter(([, file]) => readFileSync(join(GAMES, file), "utf8").includes("@games/words/dictionary"))
      .map(([, file]) => file);
    expect(hits).toEqual([]);
  });
});
