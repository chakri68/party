import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOOT_LINKS } from "../src/header.ts";
import shellConfig from "../../web/vite.config.ts";
import config, { thirdParty } from "../vite.config.ts";

// The room shell's My sounds screen ships an LGPL encoder. Its notice lives in
// apps/web/public, which this site's build doesn't copy, so a plugin emits it.
describe("/THIRD_PARTY.md", () => {
  it("the build emits the shell's notice as it is", () => {
    const emitted: Array<{ fileName?: string; source?: unknown }> = [];
    const plugin = thirdParty();
    const hook = plugin.generateBundle as (this: unknown) => void;
    hook.call({ emitFile: (f: { fileName?: string; source?: unknown }) => (emitted.push(f), "id") });
    const notice = readFileSync(new URL("../../web/public/THIRD_PARTY.md", import.meta.url), "utf8");
    expect(emitted).toEqual([{ type: "asset", fileName: "THIRD_PARTY.md", source: notice }]);
    expect(notice).toContain("LGPL");
  });

  it("the build keeps the encoder in its own file, with its notice, as the shell's build does", () => {
    const built = (typeof config === "function" ? config({ mode: "production", command: "build" }) : config) as {
      build: { rolldownOptions: { output: { comments: unknown; codeSplitting: { groups: Array<{ name: string; test: RegExp }> } } } };
    };
    const out = built.build.rolldownOptions.output;
    expect(out.comments).toEqual({ legal: true });
    const group = out.codeSplitting.groups.find((g) => g.name === "encode")!;
    expect(group.test.test("/x/node_modules/wasm-media-encoders/dist/esm/index.js")).toBe(true);
    expect(group.test.test("/x/apps/web/src/sounds/encode.ts")).toBe(true);
    expect(group.test.test("/x/apps/web/src/sounds/library.ts")).toBe(false);
    // The same rules as the shell's own build, so the two can't drift apart.
    const shell = (shellConfig as { build: typeof built.build }).build.rolldownOptions.output;
    expect(out.comments).toEqual(shell.comments);
    expect(out.codeSplitting).toEqual(shell.codeSplitting);
  });

  it("the footer links to it", () => {
    expect(FOOT_LINKS).toContainEqual(["Licences", "/THIRD_PARTY.md"]);
  });
});
