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

  // Task 8 turns these on when views/my-sounds.ts exists.
  it.todo("only views/my-sounds.ts imports sounds/encode.ts statically");
  it.todo("no file imports views/my-sounds.ts statically, only with import()");
});
