import { describe, expect, it } from "vitest";
import { DUCK_GAIN } from "@games/audio";
import { duckLevel } from "../../src/voice/duck.ts";
import type { VoiceMemberView, VoiceView } from "../../src/voice/voice.ts";

const member = (p: Partial<VoiceMemberView>): VoiceMemberView => ({
  id: "x",
  self: false,
  selfMuted: false,
  hostMuted: false,
  speaking: false,
  volume: 1,
  blocked: false,
  link: "connected",
  ...p,
});
const me = member({ id: "me", self: true });
const other = (p: Partial<VoiceMemberView> = {}) => member({ id: "o", ...p });

const view = (p: Partial<VoiceView>): VoiceView => ({
  status: "on",
  mic: "on",
  talking: false,
  deafened: false,
  pttHeld: false,
  mode: "open",
  members: [],
  needsSoundTap: false,
  needsMicTap: false,
  hasTurn: false,
  canPickOutput: false,
  ...p,
});

describe("duckLevel", () => {
  it("ducks while someone else speaks", () => expect(duckLevel(view({ members: [me, other({ speaking: true })] }), true)).toBe(DUCK_GAIN));

  it("no one speaking: no duck", () => expect(duckLevel(view({ members: [me, other()] }), true)).toBe(1));

  it("my own voice does not duck", () => {
    expect(duckLevel(view({ talking: true, members: [{ ...me, speaking: true }, other()] }), true)).toBe(1);
  });

  it("a person I muted for me does not duck", () => {
    expect(duckLevel(view({ members: [me, other({ speaking: true, blocked: true })] }), true)).toBe(1);
    expect(duckLevel(view({ members: [me, other({ speaking: true, blocked: true }), other({ id: "p", speaking: true })] }), true)).toBe(DUCK_GAIN);
  });

  it("deafened, out of voice, or off in settings: no duck", () => {
    const speaking = [me, other({ speaking: true })];
    expect(duckLevel(view({ deafened: true, members: speaking }), true)).toBe(1);
    for (const status of ["off", "joining", "full", "unsupported"] as const) expect(duckLevel(view({ status, members: speaking }), true)).toBe(1);
    expect(duckLevel(view({ members: speaking }), false)).toBe(1);
  });

  it("the speaker left voice: back to full", () => {
    expect(duckLevel(view({ members: [me, other({ speaking: true })] }), true)).toBe(DUCK_GAIN);
    expect(duckLevel(view({ members: [me] }), true)).toBe(1);
  });
});
