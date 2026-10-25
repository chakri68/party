import { describe, expect, it } from "vitest";
import build from "../client/navigator/godot-build.json";

// The SPA fallback trap (map §3.3): a file godot-build.json names but the
// server doesn't have comes back as index.html with a 200, and Godot dies on
// a parse error. So check the manifest against what export-godot.mjs copied.
// The export isn't in git (D1): on a checkout that never ran it, there's
// nothing to compare, and only the manifest's shape is checked.

// Lazy glob: lists the files, imports none of them (one is a 38 MiB .wasm).
const published = Object.keys(import.meta.glob("../../../apps/web/public/blind-rally/godot/*/*"))
  .map((p) => p.replace("../../../apps/web/public", ""));

describe("godot-build.json", () => {
  it("names one hashed dir and the files Godot's loader derives from index", () => {
    expect(build.hash).toMatch(/^[0-9a-f]{10}$/);
    expect(build.base).toBe(`/blind-rally/godot/${build.hash}/`);
    for (const f of ["index.html", "index.js", "index.wasm", "index.pck"]) expect(build.files).toContain(f);
  });

  it.skipIf(!published.length)("every listed file is in apps/web/public, and only that build is", () => {
    for (const f of build.files) expect(published, f).toContain(build.base + f);
    expect(published.every((p) => p.startsWith(build.base))).toBe(true);
  });
});
