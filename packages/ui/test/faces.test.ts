import { describe, expect, it } from "vitest";
import { faceColor, faceSvg } from "../src/faces.ts";

describe("faceColor", () => {
  it("matches the face's disc", () => {
    for (const seed of ["a", "zed", "p3"]) {
      expect(faceSvg(seed)).toContain(faceColor(seed));
    }
  });

  it("is stable for a seed", () => {
    expect(faceColor("a")).toBe(faceColor("a"));
  });
});
