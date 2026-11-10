import { describe, expect, it } from "vitest";
import build from "../client/godot/godot-build.json";

// Blind Rally's check, for this game's export. A file godot-build.json names
// but Vite doesn't have comes back as the SPA's index.html with a 200, and
// Godot dies on a parse error. The export isn't in git: on a checkout that
// never ran it, only the manifest's shape is checked.

// Lazy glob: lists the files, imports none of them (one is a big .wasm).
const published = Object.keys(import.meta.glob("../../../apps/web/public/treasure-hunt/godot/*/*"))
  .map((p) => p.replace("../../../apps/web/public", ""));

describe("godot-build.json", () => {
  it("names one hashed dir and the files Godot's loader derives from index", () => {
    expect(build.hash).toMatch(/^[0-9a-f]{10}$/);
    expect(build.base).toBe(`/treasure-hunt/godot/${build.hash}/`);
    for (const f of ["index.html", "index.js", "index.wasm", "index.pck"]) expect(build.files).toContain(f);
  });

  it.skipIf(!published.length)("every listed file is in apps/web/public, and only that build is", () => {
    for (const f of build.files) expect(published, f).toContain(build.base + f);
    expect(published.every((p) => p.startsWith(build.base))).toBe(true);
  });
});
