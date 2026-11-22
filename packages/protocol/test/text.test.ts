import { describe, expect, it } from "vitest";
import { cleanChatText, FATAL_ERRORS, parseClientMessage } from "../src/index.ts";

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

describe("parseClientMessage: host controls", () => {
  const parse = (m: object) => parseClientMessage(JSON.stringify(m));

  it("lock-room needs a boolean", () => {
    expect(parse({ type: "lock-room", locked: true })).toEqual({ type: "lock-room", locked: true });
    expect(parse({ type: "lock-room", locked: "yes" })).toBeNull();
    expect(parse({ type: "lock-room" })).toBeNull();
  });

  it("transfer-host needs a short id", () => {
    expect(parse({ type: "transfer-host", playerId: "abc" })).toEqual({ type: "transfer-host", playerId: "abc" });
    expect(parse({ type: "transfer-host" })).toBeNull();
    expect(parse({ type: "transfer-host", playerId: 5 })).toBeNull();
    expect(parse({ type: "transfer-host", playerId: "x".repeat(65) })).toBeNull();
  });

  it("restart-game takes no fields", () => {
    expect(parse({ type: "restart-game", junk: 1 })).toEqual({ type: "restart-game" });
  });

  it("pause-game needs a boolean", () => {
    expect(parse({ type: "pause-game", paused: false })).toEqual({ type: "pause-game", paused: false });
    expect(parse({ type: "pause-game", paused: 0 })).toBeNull();
  });

  it("room-locked is fatal", () => {
    expect(FATAL_ERRORS.has("room-locked")).toBe(true);
  });
});
