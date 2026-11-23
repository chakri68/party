import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The landing, account and pricing pages must not load the room shell: it brings
// its global CSS and every game. Only play.ts may import it. Type imports are fine.
const SHELL_IMPORT = /^import (?!type)[^;]*from "@games\/web/m;

describe("pages outside the room", () => {
  for (const file of ["api", "landing", "account", "buy", "header", "turnstile", "motion", "menu"]) {
    it(`${file}.ts has no runtime import from the shell`, () => {
      const src = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
      expect(src).not.toMatch(SHELL_IMPORT);
    });
  }
});
