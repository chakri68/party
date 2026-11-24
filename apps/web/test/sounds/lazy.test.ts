import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob<string>("../../src/**/*.ts", { query: "?raw", import: "default", eager: true });

const ENCODER_IMPORT = /from\s+["']wasm-media-encoders["']|import\(\s*["']wasm-media-encoders["']\s*\)/;
const filesMatching = (re: RegExp) =>
  Object.entries(SOURCES)
    .filter(([, text]) => re.test(text))
    .map(([path]) => path)
    .sort();

describe("the mp3 encoder", () => {
  it("the encoder loads only with My sounds", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
    expect(filesMatching(ENCODER_IMPORT)).toEqual(["../../src/sounds/encode.ts"]);
  });

  // A static import: `from "..."` (import or export) or a bare side-effect `import "..."`. Not `import(...)`.
  const staticImportOf = (file: string) => new RegExp(`(?:\\bfrom|\\bimport)\\s*["'](?:[^"']*/)?${file}(?:\\.ts|\\.js)?["']`);

  it("finds every kind of static import", () => {
    const re = staticImportOf("my-sounds");
    for (const line of [`import { a } from "./my-sounds.ts";`, `import "./my-sounds.ts";`, `import '../views/my-sounds';`, `export * from "./my-sounds.js";`]) {
      expect(re.test(line), line).toBe(true);
    }
    for (const line of [`import("./my-sounds.ts")`, `import { a } from "./my-sounds-model.ts";`]) expect(re.test(line), line).toBe(false);
  });

  it("only views/my-sounds.ts imports sounds/encode.ts statically", () => {
    expect(filesMatching(staticImportOf("encode"))).toEqual(["../../src/views/my-sounds.ts"]);
  });

  it("no file imports views/my-sounds.ts statically, only with import()", () => {
    expect(filesMatching(staticImportOf("my-sounds"))).toEqual([]);
    expect(filesMatching(/import\(\s*["']\.\/my-sounds\.ts["']\s*\)/)).toEqual(["../../src/views/home.ts", "../../src/views/room.ts"]);
  });
});
