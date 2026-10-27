import { describe, expect, it } from "vitest";
import { cleanChatText } from "../src/index.ts";

describe("cleanChatText", () => {
  it("caps at the chat length unless told otherwise", () => {
    expect(cleanChatText("x".repeat(300))).toHaveLength(200);
  });

  it("takes a cap of its own, for clues and definitions", () => {
    expect(cleanChatText("hello world", 5)).toBe("hello");
  });

  it("cuts by code point, so an emoji is never split", () => {
    expect(cleanChatText("😀😀😀", 2)).toBe("😀😀");
  });
});
