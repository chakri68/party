import { describe, expect, it } from "vitest";
import { ordinal } from "../src/text.ts";

describe("ordinal", () => {
  it("gives 1st, 2nd, 3rd, and th for the teens", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th",
    ]);
  });
});
