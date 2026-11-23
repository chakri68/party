import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH } from "@games/protocol";
import { randomName } from "../src/names.ts";

describe("randomName", () => {
  it("is two plain words that fit a name", () => {
    for (let i = 0; i < 300; i++) {
      const n = randomName();
      expect(n).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(n.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    }
  });
  it("avoids the name it is given", () => {
    for (let i = 0; i < 300; i++) expect(randomName("Happy Tiger")).not.toBe("Happy Tiger");
  });
});
