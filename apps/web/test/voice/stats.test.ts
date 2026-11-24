import { describe, expect, it } from "vitest";
import { voiceStatsLines } from "../../src/voice/stats.ts";
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

const base: VoiceView = {
  status: "on",
  mic: "on",
  talking: true,
  deafened: false,
  pttHeld: false,
  mode: "open",
  members: [member({ id: "me", self: true, link: null }), member({ id: "b" })],
  needsSoundTap: false,
  needsMicTap: false,
  hasTurn: false,
  canPickOutput: false,
};
const view = base;
const names: Record<string, string> = { b: "Asha", c: "Ravi" };
const nameOf = (id: string) => names[id] ?? id;

describe("voiceStatsLines", () => {
  it("voiceStatsLines: a header line, then one line per peer with - for nulls", () => {
    expect(voiceStatsLines(view, [{ peerId: "b", rttMs: 43, packetsLost: 7, relayed: true }], (id) => (id === "b" ? "Asha" : id))).toEqual([
      "voice: on · mic: on · talking: yes · relay server: no",
      "Asha: connected · rtt 43 ms · lost 7 · relay yes",
    ]);
  });

  it("a peer with no stats yet shows dashes", () => {
    const v: VoiceView = {
      ...base,
      mic: "muted",
      talking: false,
      hasTurn: true,
      members: [member({ id: "c", link: "connecting" }), member({ id: "me", self: true, link: null }), member({ id: "b", link: null })],
    };
    expect(voiceStatsLines(v, [{ peerId: "c", rttMs: null, packetsLost: null, relayed: false }], nameOf)).toEqual([
      "voice: on · mic: muted · talking: no · relay server: yes",
      "Ravi: connecting · rtt - ms · lost - · relay no",
      "Asha: - · rtt - ms · lost - · relay -",
    ]);
  });

  it("out of voice: the header only", () => {
    expect(voiceStatsLines({ ...base, status: "off", mic: "off", talking: false, members: [] }, [], nameOf)).toEqual([
      "voice: off · mic: off · talking: no · relay server: no",
    ]);
  });
});
