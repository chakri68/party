import { describe, expect, it } from "vitest";
import { cleanChatText, parseClientMessage } from "../src/index.ts";

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

describe("parseClientMessage: computer seats", () => {
  it("parses add-bot and remove-bots, ignoring extra fields", () => {
    expect(parseClientMessage(JSON.stringify({ type: "add-bot" }))).toEqual({ type: "add-bot" });
    expect(parseClientMessage(JSON.stringify({ type: "remove-bots" }))).toEqual({ type: "remove-bots" });
    expect(parseClientMessage(JSON.stringify({ type: "add-bot", junk: [1, 2], name: "Hacker" }))).toEqual({ type: "add-bot" });
    expect(parseClientMessage(JSON.stringify({ type: "remove-bots", seatId: "x" }))).toEqual({ type: "remove-bots" });
  });
});
