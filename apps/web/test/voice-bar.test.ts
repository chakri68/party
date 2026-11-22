import { describe, expect, it } from "vitest";
import { pttEnabled, voiceBarModel } from "../src/views/voice-bar.ts";
import type { VoiceMemberView, VoiceView } from "../src/voice/voice.ts";

const member = (id: string, extra: Partial<VoiceMemberView> = {}): VoiceMemberView => ({
  id,
  self: false,
  selfMuted: false,
  hostMuted: false,
  speaking: false,
  volume: 1,
  blocked: false,
  link: "connected",
  ...extra,
});

const view = (extra: Partial<VoiceView> = {}): VoiceView => ({
  status: "off",
  mic: "off",
  talking: false,
  deafened: false,
  pttHeld: false,
  mode: "open",
  members: [],
  needsSoundTap: false,
  needsMicTap: false,
  hasTurn: false,
  canPickOutput: false,
  ...extra,
});

describe("voiceBarModel", () => {
  it("hidden when the party has ended", () => {
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "ended").show).toBe("hidden");
    expect(voiceBarModel(view(), "ended").show).toBe("hidden");
  });

  it("shows Join voice when off", () => {
    const m = voiceBarModel(view(), "lobby");
    expect(m.show).toBe("join");
    expect(m.canJoin).toBe(true);
    expect(m.note).toBeNull();
    expect(voiceBarModel(view(), "playing").show).toBe("join");
  });

  it("unsupported shows the browser note and no join", () => {
    const m = voiceBarModel(view({ status: "unsupported" }), "lobby");
    expect(m.note).toBe("Voice does not work in this browser.");
    expect(m.canJoin).toBe(false);
    expect(m.show).not.toBe("bar");
    // Not worth a line in the middle of a game.
    expect(voiceBarModel(view({ status: "unsupported" }), "playing").show).toBe("hidden");
  });

  it("muted with a live mic shows the still-on note", () => {
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").note).toBe("Muted: your mic is still on. Tap Turn off mic to stop it.");
    const m = voiceBarModel(view({ status: "on", mic: "muted" }), "lobby");
    expect(m.show).toBe("bar");
    expect(m.micButton).toEqual({ label: "Unmute", pressed: true, hold: false });
  });

  it("mic off or denied shows Your mic is off", () => {
    for (const mic of ["off", "denied", "lost"] as const) {
      const m = voiceBarModel(view({ status: "on", mic }), "lobby");
      expect(m.note).toBe("Your mic is off");
      expect(m.micButton).toEqual({ label: "Turn on mic", pressed: false, hold: false });
    }
    // Listen-only while joining: the mic line comes first.
    expect(voiceBarModel(view({ status: "joining", mic: "off" }), "lobby").note).toBe("Your mic is off");
  });

  it("joining with a mic shows Connecting voice...", () => {
    expect(voiceBarModel(view({ status: "joining", mic: "on" }), "lobby").note).toBe("Connecting voice...");
  });

  it("an open mic has a plain Mute button and no note", () => {
    const m = voiceBarModel(view({ status: "on", mic: "on" }), "playing");
    expect(m.show).toBe("bar");
    expect(m.micButton).toEqual({ label: "Mute", pressed: false, hold: false });
    expect(m.note).toBeNull();
  });

  it("full shows Voice is full.", () => {
    const m = voiceBarModel(view({ status: "full" }), "lobby");
    expect(m.note).toBe("Voice is full.");
    expect(m.show).toBe("join");
    expect(m.canJoin).toBe(true);
  });

  it("push-to-talk makes the mic a hold button", () => {
    const up = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "playing");
    expect(up.micButton).toEqual({ label: "Talk", pressed: false, hold: true });
    expect(up.note).toBe("Hold to talk");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "playing", true).note).toBe("Hold Space to talk");
    const held = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "playing", true);
    expect(held.micButton.pressed).toBe(true);
    expect(held.note).toBeNull();
    // Muted in push-to-talk: unmute first, holding would do nothing.
    expect(voiceBarModel(view({ status: "on", mic: "muted", mode: "ptt" }), "lobby").micButton.hold).toBe(false);
  });

  it("asks for a tap for sound and for the mic", () => {
    const m = voiceBarModel(view({ status: "on", mic: "lost", needsSoundTap: true, needsMicTap: true }), "playing");
    expect(m.tapSound).toBe(true);
    expect(m.tapMic).toBe(true);
    const none = voiceBarModel(view({ status: "on", mic: "on" }), "playing");
    expect(none.tapSound).toBe(false);
    expect(none.tapMic).toBe(false);
  });

  it("lists who is speaking", () => {
    const m = voiceBarModel(
      view({ status: "on", mic: "on", members: [member("amy", { speaking: true }), member("ben"), member("cat", { speaking: true })] }),
      "playing",
    );
    expect(m.speakingIds).toEqual(["amy", "cat"]);
    expect(voiceBarModel(view(), "lobby").speakingIds).toEqual([]);
  });

  it("the connection dot waits until every link is up", () => {
    expect(voiceBarModel(view({ status: "joining", mic: "on" }), "lobby").connection).toBe("wait");
    const on = (links: VoiceMemberView["link"][]) =>
      voiceBarModel(view({ status: "on", mic: "on", members: [member("me", { self: true, link: null }), ...links.map((link, i) => member(`p${i}`, { link }))] }), "lobby").connection;
    expect(on([])).toBe("good");
    expect(on(["connected", "connected"])).toBe("good");
    expect(on(["connected", "connecting"])).toBe("wait");
    expect(on(["reconnecting"])).toBe("wait");
  });
});

describe("pttEnabled", () => {
  it("only in push-to-talk mode while in voice", () => {
    expect(pttEnabled(view({ status: "on", mode: "ptt" }))).toBe(true);
    expect(pttEnabled(view({ status: "joining", mode: "ptt" }))).toBe(true);
    // Out of voice, Space stays the page's.
    expect(pttEnabled(view({ status: "off", mode: "ptt" }))).toBe(false);
    expect(pttEnabled(view({ status: "full", mode: "ptt" }))).toBe(false);
    expect(pttEnabled(view({ status: "on", mode: "open" }))).toBe(false);
  });
});
