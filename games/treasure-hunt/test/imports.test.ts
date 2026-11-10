import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SERVER = join(ROOT, "server");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(n) ? [p] : [];
  });
}

/** Every module specifier: import/export … from "x", import "x", import("x"), require("x"). */
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** The server/ specifiers in `src`, as if it lived at `file`. */
function serverImports(file: string, src: string): string[] {
  return [...src.matchAll(SPEC)]
    .map((m) => m[1]!)
    .filter((s) => (s.startsWith(".") ? resolve(file, "..", s).startsWith(SERVER + "/") || resolve(file, "..", s) === SERVER : /treasure-hunt\/server/.test(s)));
}

describe("imports", () => {
  it("nothing under shared/ or client/ imports server/", () => {
    const all = [...files(join(ROOT, "shared")), ...files(join(ROOT, "client"))];
    expect(all.length).toBeGreaterThan(5);
    const bad = all.flatMap((f) => serverImports(f, readFileSync(f, "utf8")).map((s) => `${relative(ROOT, f)}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("the scan catches every way in, and resolves relative paths", () => {
    const client = join(ROOT, "client", "view.ts");
    const deep = join(ROOT, "client", "godot", "bridge.ts");
    const src = [
      `import { makeHunt } from "../server/hunt.ts";`,
      `export { x } from '@games/treasure-hunt/server';`,
      `import "../server/x";`,
      `const m = await import("../server/caches.ts");`,
      `const c = require("../server/clues.ts");`,
      `import { y } from "../shared/generate.ts";`,
      `import { z } from "./server-ish.ts";`,
    ].join("\n");
    expect(serverImports(client, src)).toEqual([
      "../server/hunt.ts",
      "@games/treasure-hunt/server",
      "../server/x",
      "../server/caches.ts",
      "../server/clues.ts",
    ]);
    // One level deeper, "../server" is client/server (not ours); "../../server" is.
    expect(serverImports(deep, `import a from "../server/x"; import b from "../../server/x";`)).toEqual(["../../server/x"]);
  });
});
