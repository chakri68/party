import { describe, expect, it } from "vitest";
import { globalRule } from "../src/index.ts";

describe("globalRule", () => {
  it("hears and talks to everyone else", () => {
    expect(globalRule("a", ["a", "b", "c"])).toEqual({ canTalk: true, hear: ["b", "c"], sendTo: ["b", "c"], label: "" });
  });

  it("gives separate arrays for hear and sendTo", () => {
    const rule = globalRule("a", ["b"]);
    expect(rule.hear).not.toBe(rule.sendTo);
  });
});
