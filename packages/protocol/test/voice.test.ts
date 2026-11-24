import { describe, expect, it } from "vitest";
import { FATAL_ERRORS, parseClientMessage, PROTOCOL_VERSION, VOICE_SIGNAL_MAX_LENGTH } from "../src/index.ts";

const parse = (m: object) => parseClientMessage(JSON.stringify(m));

describe("voice messages", () => {
  it("parses voice-join with its muted flag", () => {
    expect(parse({ type: "voice-join", muted: true })).toEqual({ type: "voice-join", muted: true });
    expect(parse({ type: "voice-join" })).toBeNull();
  });
  it("parses voice-leave and voice-ice-request with no fields", () => {
    expect(parse({ type: "voice-leave", x: 1 })).toEqual({ type: "voice-leave" });
    expect(parse({ type: "voice-ice-request" })).toEqual({ type: "voice-ice-request" });
  });
  it("parses voice-self-mute", () => {
    expect(parse({ type: "voice-self-mute", muted: false })).toEqual({ type: "voice-self-mute", muted: false });
    expect(parse({ type: "voice-self-mute", muted: "no" })).toBeNull();
  });
  it("parses voice-signal with an object payload", () => {
    const m = { type: "voice-signal", to: "abc", session: "s1", data: { kind: "ice", candidates: [] } };
    expect(parse(m)).toEqual(m);
    expect(parse({ ...m, data: "text" })).toBeNull();
    expect(parse({ ...m, session: "" })).toBeNull();
    expect(parse({ ...m, to: "x".repeat(65) })).toBeNull();
  });
  it("refuses a voice-signal over VOICE_SIGNAL_MAX_LENGTH", () => {
    const big = { type: "voice-signal", to: "abc", session: "s1", data: { sdp: "x".repeat(VOICE_SIGNAL_MAX_LENGTH) } };
    expect(parse(big)).toBeNull();
  });
  it("is version 14", () => expect(PROTOCOL_VERSION).toBe(14));
  it("parses host-mute for one seat and for all", () => {
    expect(parse({ type: "host-mute", playerId: "p2", muted: true })).toEqual({ type: "host-mute", playerId: "p2", muted: true });
    expect(parse({ type: "host-mute", playerId: "all", muted: false })).toEqual({ type: "host-mute", playerId: "all", muted: false });
    expect(parse({ type: "host-mute", playerId: "", muted: true })).toBeNull();
    expect(parse({ type: "host-mute", playerId: "p2" })).toBeNull();
    expect(parse({ type: "host-mute", playerId: "x".repeat(65), muted: true })).toBeNull();
  });
  it("voice-full is not fatal", () => expect(FATAL_ERRORS.has("voice-full")).toBe(false));
});
