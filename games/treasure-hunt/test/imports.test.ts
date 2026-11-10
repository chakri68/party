import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SERVER = join(ROOT, "server");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : [];
  });
}

/** Every module specifier: import/export … from "x", import "x", import("x"). */
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

describe("imports", () => {
  it("nothing under shared/ or client/ imports server/", () => {
    const bad: string[] = [];
    const all = [...files(join(ROOT, "shared")), ...files(join(ROOT, "client"))];
    expect(all.length).toBeGreaterThan(5);
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(SPEC)) {
        const s = m[1]!;
        const hit = s.startsWith(".") ? resolve(f, "..", s).startsWith(SERVER) : /treasure-hunt\/server/.test(s);
        if (hit) bad.push(`${relative(ROOT, f)}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan catches a server import", () => {
    const src = `import { makeHunt } from "../server/hunt.ts";\nexport { x } from '@games/treasure-hunt/server';`;
    expect([...src.matchAll(SPEC)].map((m) => m[1])).toEqual(["../server/hunt.ts", "@games/treasure-hunt/server"]);
  });
});
