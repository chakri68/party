import { describe, expect, it } from "vitest";
import { hostVoiceAction, joinAllowed, joinLines, pttEnabled, voiceBarModel, voiceMenuItem, voiceSettingChecks } from "../src/views/voice-bar.ts";
import { DEFAULT_VOICE_PREFS } from "../src/voice/prefs.ts";
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

const FOCUS = ["lobby", "playing", "results"] as const;

describe("voiceBarModel", () => {
  it("hidden when the party has ended", () => {
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "ended").show).toBe("hidden");
    expect(voiceBarModel(view(), "ended").show).toBe("hidden");
    expect(voiceBarModel(view(), "ended").menu).toBeNull();
  });

  it("on every room screen, out of voice: no row, Join voice in the menu", () => {
    for (const phase of FOCUS) {
      for (const status of ["off", "full", "unsupported"] as const) {
        const m = voiceBarModel(view({ status }), phase);
        expect(m.show, `${phase} ${status}`).toBe("hidden");
        expect(m.spoken).toBe("");
      }
      expect(voiceBarModel(view(), phase).menu, phase).toBe("join");
      // Full keeps Join voice, so a player can try again.
      expect(voiceBarModel(view({ status: "full" }), phase).menu).toBe("join");
      // No Join voice; the menu says why instead.
      expect(voiceBarModel(view({ status: "unsupported" }), phase).menu).toBe("unsupported");
    }
  });

  it("on every room screen, in voice: header mic, Voice in the menu", () => {
    const states: Partial<VoiceView>[] = [
      { mic: "on" },
      { mic: "muted" },
      { mic: "off" },
      { mic: "on", mode: "ptt" },
      { mic: "on", mode: "ptt", pttHeld: true },
    ];
    for (const phase of FOCUS) {
      for (const st of states) {
        for (const status of ["on", "joining"] as const) {
          const m = voiceBarModel(view({ status, ...st }), phase);
          expect(m.show, `${phase} ${JSON.stringify(st)}`).toBe("header");
          expect(m.menu).toBe("voice");
        }
      }
    }
  });

  it("the note goes in the mic name, on every room screen", () => {
    for (const phase of FOCUS) {
      expect(voiceBarModel(view({ status: "on", mic: "muted" }), phase).micName).toBe("Unmute. Muted: your mic is still on.");
      expect(voiceBarModel(view({ status: "on", mic: "on" }), phase).micName).toBe("Mute");
      expect(voiceBarModel(view({ status: "on", mic: "off" }), phase).micName).toBe("Turn on mic. Your mic is off.");
      expect(voiceBarModel(view({ status: "joining", mic: "on" }), phase).micName).toBe("Mute. Connecting voice...");
      // Push-to-talk: the hint, and the name does not change on every press.
      expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), phase).micName).toBe("Talk. Hold to talk.");
      expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), phase, true).micName).toBe("Talk. Hold Space to talk.");
    }
    // Party over: no header mic, the plain label.
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "ended").micName).toBe("Unmute");
  });

  it("the note in the mic name is read out, but not the push-to-talk hint", () => {
    for (const phase of FOCUS) {
      expect(voiceBarModel(view({ status: "on", mic: "muted" }), phase).spoken).toBe("Muted: your mic is still on.");
      expect(voiceBarModel(view({ status: "on", mic: "on" }), phase).spoken).toBe("");
      expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), phase).spoken).toBe("");
    }
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "ended").spoken).toBe("");
  });

  it("tap prompts still show on every room screen", () => {
    for (const phase of FOCUS) {
      const m = voiceBarModel(view({ status: "on", mic: "lost", needsSoundTap: true }), phase);
      expect(m.tapSound).toBe(true);
      expect(m.show).toBe("header");
    }
  });

  it("the mic button: toggle, unmute, or hold to talk", () => {
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").micButton).toEqual({ label: "Unmute", pressed: true, hold: false });
    for (const mic of ["off", "denied", "lost"] as const) {
      expect(voiceBarModel(view({ status: "on", mic }), "lobby").micButton).toEqual({ label: "Turn on mic", pressed: false, hold: false });
    }
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "lobby").micButton).toEqual({ label: "Mute", pressed: false, hold: false });
  });

  it("push-to-talk makes the mic a hold button", () => {
    const up = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "lobby");
    expect(up.micButton).toEqual({ label: "Talk", pressed: false, hold: true });
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "playing", true).micButton.pressed).toBe(true);
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "lobby", true).micButton.pressed).toBe(true);
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

describe("joining", () => {
  it("joins only while the menu's Join voice is up and the bar is alive", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      expect(joinAllowed(voiceBarModel(view(), phase), false), phase).toBe(true);
      // The bar was destroyed while the explainer was open.
      expect(joinAllowed(voiceBarModel(view(), phase), true)).toBe(false);
      // Already joining from another tap, or in voice.
      expect(joinAllowed(voiceBarModel(view({ status: "joining", mic: "on" }), phase), false)).toBe(false);
      expect(joinAllowed(voiceBarModel(view({ status: "on", mic: "on" }), phase), false)).toBe(false);
      // Full: Join voice stays, so a player can try again.
      expect(joinAllowed(voiceBarModel(view({ status: "full" }), phase), false)).toBe(true);
      // The menu has no Join voice where voice cannot work.
      expect(joinAllowed(voiceBarModel(view({ status: "unsupported" }), phase), false)).toBe(false);
    }
    // The party ended, or a fatal hid the bar.
    expect(joinAllowed(voiceBarModel(view(), "ended"), false)).toBe(false);
    expect(joinAllowed(null, false)).toBe(false);
  });

  it("the explainer says the browser will ask, unless the mic is blocked", () => {
    expect(joinLines("prompt")).toEqual(["Talk with the room while you play.", "Your browser will ask to use the mic.", "No one records your voice."]);
    expect(joinLines("unknown")).toEqual(joinLines("prompt"));
    const denied = joinLines("denied");
    expect(denied).not.toContain("Your browser will ask to use the mic.");
    expect(denied).toContain("Your browser blocks the mic for this site. To talk, allow the mic in the browser settings.");
    expect(denied).toContain("No one records your voice.");
  });
});

describe("voiceMenuItem", () => {
  it("Join voice out of voice (also when full, to try again), Voice in voice, a note where voice cannot work", () => {
    expect(voiceMenuItem(view({ status: "off" }))).toBe("join");
    expect(voiceMenuItem(view({ status: "on" }))).toBe("voice");
    expect(voiceMenuItem(view({ status: "joining" }))).toBe("voice");
    expect(voiceMenuItem(view({ status: "full" }))).toBe("join");
    expect(voiceMenuItem(view({ status: "unsupported" }))).toBe("unsupported");
  });
});

describe("host mute", () => {
  it("host-muted shows The host muted you.", () => {
    for (const mode of ["open", "ptt"] as const) {
      const m = voiceBarModel(view({ status: "on", mic: "muted", mode, members: [member("me", { self: true, hostMuted: true, selfMuted: true })] }), "playing");
      expect(m.micName, mode).toBe("Unmute. The host muted you.");
      expect(m.spoken).toBe("The host muted you.");
    }
    // Not host-muted: the old note.
    const own = voiceBarModel(view({ status: "on", mic: "muted", members: [member("me", { self: true, selfMuted: true })] }), "playing");
    expect(own.micName).toBe("Unmute. Muted: your mic is still on.");
    // Someone else host-muted: not my note.
    const other = voiceBarModel(view({ status: "on", mic: "on", members: [member("me", { self: true }), member("ben", { hostMuted: true })] }), "playing");
    expect(other.micName).toBe("Mute");
  });

  it("hostVoiceAction: Mute, Allow to talk, null for self and for others", () => {
    expect(hostVoiceAction(member("ben"), true)).toEqual({ label: "Mute", message: { type: "host-mute", playerId: "ben", muted: true } });
    expect(hostVoiceAction(member("ben", { hostMuted: true }), true)).toEqual({
      label: "Allow to talk",
      message: { type: "host-mute", playerId: "ben", muted: false },
    });
    expect(hostVoiceAction(member("me", { self: true }), true)).toBeNull();
    expect(hostVoiceAction(member("ben"), false)).toBeNull();
  });
});

describe("voiceSettingChecks", () => {
  it("has Count my talk time for the recap, bound to countTalk, after Keep the screen on", () => {
    const rows = voiceSettingChecks(DEFAULT_VOICE_PREFS, true);
    const labels = rows.map((r) => r.label);
    const i = labels.indexOf("Count my talk time for the recap");
    expect(i).toBe(labels.indexOf("Keep the screen on in voice") + 1);
    const row = rows[i]!;
    expect(row.checked).toBe(true);
    expect(row.patch(false)).toEqual({ countTalk: false });
    expect(row.patch(true)).toEqual({ countTalk: true });
    expect(voiceSettingChecks({ ...DEFAULT_VOICE_PREFS, countTalk: false }, true)[i]!.checked).toBe(false);
  });

  it("Hide my network address needs a relay server", () => {
    const hide = (hasTurn: boolean) => voiceSettingChecks(DEFAULT_VOICE_PREFS, hasTurn).find((r) => r.label === "Hide my network address")!;
    expect(hide(false).disabled).toBe(true);
    expect(hide(true).disabled).toBe(false);
  });
});
