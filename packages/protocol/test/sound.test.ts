import { describe, expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION } from "../src/index.ts";

const parse = (m: object) => parseClientMessage(JSON.stringify(m));

describe("sound messages", () => {
  it("is version 13", () => expect(PROTOCOL_VERSION).toBe(13));

  it("parses sound", () => {
    expect(parse({ type: "sound", id: "free:rise", x: 1 })).toEqual({ type: "sound", id: "free:rise" });
    const bad: unknown[] = [
      "rise",
      "Free:rise",
      "free:",
      ":rise",
      "free:Rise",
      "free:a--b",
      "a".repeat(17) + ":x",
      "free:" + "a".repeat(44),
      7,
    ];
    expect(("free:" + "a".repeat(44)).length).toBe(49);
    for (const id of bad) expect(parse({ type: "sound", id }), String(id)).toBeNull();
  });

  it("parses room-sounds", () => {
    expect(parse({ type: "room-sounds", on: false })).toEqual({ type: "room-sounds", on: false });
    expect(parse({ type: "room-sounds", on: "no" })).toBeNull();
    expect(parse({ type: "room-sounds" })).toBeNull();
  });
});
