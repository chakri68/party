import { describe, expect, it } from "vitest";
import { renderOptions } from "../src/turnstile.ts";

describe("turnstile render options", () => {
  it("uses only documented options and no invisible size", () => {
    const o = renderOptions("site", { ok() {}, fail() {} });
    expect(o).toMatchObject({ sitekey: "site", execution: "execute", appearance: "interaction-only" });
    expect(o).not.toHaveProperty("size");
  });
  it("wires success and failure callbacks", () => {
    const got: string[] = [];
    const o = renderOptions("s", { ok: (t) => got.push(t), fail: () => got.push("fail") });
    (o.callback as (t: string) => void)("tok");
    (o["error-callback"] as () => void)();
    (o["timeout-callback"] as () => void)();
    expect(got).toEqual(["tok", "fail", "fail"]);
  });
});
