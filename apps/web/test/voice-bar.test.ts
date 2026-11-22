import { describe, expect, it } from "vitest";
import { joinAllowed, joinLines, pttEnabled, voiceBarModel, voiceMenuItem } from "../src/views/voice-bar.ts";
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
  });

  it("in a game, out of voice: no row", () => {
    for (const status of ["off", "full", "unsupported"] as const) {
      const m = voiceBarModel(view({ status }), "playing");
      expect(m.show, status).toBe("hidden");
      expect(m.note).toBeNull();
      expect(m.keepNoteRow).toBe(false);
    }
    // The lobby and results still say why.
    expect(voiceBarModel(view({ status: "full" }), "results").note).toBe("Voice is full.");
  });

  it("in a game, in voice: header mic", () => {
    const states: Partial<VoiceView>[] = [
      { mic: "on" },
      { mic: "muted" },
      { mic: "off" },
      { mic: "on", mode: "ptt" },
      { mic: "on", mode: "ptt", pttHeld: true },
    ];
    for (const st of states) {
      for (const status of ["on", "joining"] as const) {
        const m = voiceBarModel(view({ status, ...st }), "playing");
        expect(m.show, JSON.stringify(st)).toBe("header");
        expect(m.note).toBeNull();
        expect(m.keepNoteRow).toBe(false);
      }
    }
    // The lobby and results keep the row.
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "lobby").show).toBe("bar");
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "results").show).toBe("bar");
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "lobby").keepNoteRow).toBe(false);
  });

  it("in a game, the note goes in the mic name", () => {
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "playing").micName).toBe("Unmute. Muted: your mic is still on.");
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "playing").micName).toBe("Mute");
    expect(voiceBarModel(view({ status: "on", mic: "off" }), "playing").micName).toBe("Turn on mic. Your mic is off.");
    expect(voiceBarModel(view({ status: "joining", mic: "on" }), "playing").micName).toBe("Mute. Connecting voice...");
    // Push-to-talk: the hint, and the name does not change on every press.
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "playing").micName).toBe("Talk. Hold to talk.");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "playing", true).micName).toBe("Talk. Hold Space to talk.");
    // Out of a game: the plain label, the note has its own line.
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").micName).toBe("Unmute");
  });

  it("in a game, the note in the mic name is still read out, but not the push-to-talk hint", () => {
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "playing").spoken).toBe("Muted: your mic is still on.");
    expect(voiceBarModel(view({ status: "on", mic: "on" }), "playing").spoken).toBe("");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "playing").spoken).toBe("");
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").spoken).toBe("Muted: your mic is still on. Tap Turn off mic to stop it.");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "lobby").spoken).toBe("");
  });

  it("tap prompts still show in a game", () => {
    const m = voiceBarModel(view({ status: "on", mic: "lost", needsSoundTap: true }), "playing");
    expect(m.tapSound).toBe(true);
    expect(m.show).toBe("header");
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
    const m = voiceBarModel(view({ status: "on", mic: "on" }), "lobby");
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
    const up = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "lobby");
    expect(up.micButton).toEqual({ label: "Talk", pressed: false, hold: true });
    expect(up.note).toBe("Hold to talk");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "lobby", true).note).toBe("Hold Space to talk");
    expect(voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "playing", true).micButton.pressed).toBe(true);
    const held = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt", pttHeld: true }), "lobby", true);
    expect(held.micButton.pressed).toBe(true);
    // The line stays while held, so the game does not move on every press.
    expect(held.note).toBe("Talking");
    expect(held.noteLive).toBe(false);
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

describe("the people button and the note", () => {
  it("counts the people in voice", () => {
    const m = voiceBarModel(view({ status: "on", mic: "on", members: [member("me", { self: true, link: null }), member("ben")] }), "lobby");
    expect(m.peopleLabel).toBe("People in voice (2)");
  });

  it("the push-to-talk hint is not read out on every press; other notes are", () => {
    const ptt = voiceBarModel(view({ status: "on", mic: "on", mode: "ptt" }), "lobby", true);
    expect(ptt.note).toBe("Hold Space to talk");
    expect(ptt.noteLive).toBe(false);
    expect(voiceBarModel(view({ status: "on", mic: "muted" }), "lobby").noteLive).toBe(true);
    expect(voiceBarModel(view({ status: "full" }), "lobby").noteLive).toBe(true);
  });
});

describe("joining", () => {
  it("joins only while the Join voice button is up and the bar is alive", () => {
    const off = voiceBarModel(view(), "lobby");
    expect(joinAllowed(off, false)).toBe(true);
    // The bar was destroyed while the explainer was open.
    expect(joinAllowed(off, true)).toBe(false);
    // The party ended, or a fatal hid the bar.
    expect(joinAllowed(voiceBarModel(view(), "ended"), false)).toBe(false);
    expect(joinAllowed(null, false)).toBe(false);
    // Already joining from another tap.
    expect(joinAllowed(voiceBarModel(view({ status: "joining", mic: "on" }), "lobby"), false)).toBe(false);
    expect(joinAllowed(voiceBarModel(view({ status: "unsupported" }), "lobby"), false)).toBe(false);
  });

  it("in a game, joins from the room menu while out of voice", () => {
    expect(joinAllowed(voiceBarModel(view(), "playing"), false)).toBe(true);
    expect(joinAllowed(voiceBarModel(view(), "playing"), true)).toBe(false);
    expect(joinAllowed(voiceBarModel(view({ status: "joining", mic: "on" }), "playing"), false)).toBe(false);
    expect(joinAllowed(voiceBarModel(view({ status: "on", mic: "on" }), "playing"), false)).toBe(false);
    // Full: Join voice stays, like the button today, so a player can try again.
    expect(joinAllowed(voiceBarModel(view({ status: "full" }), "playing"), false)).toBe(true);
    expect(joinAllowed(voiceBarModel(view({ status: "full" }), "playing"), false)).toBe(joinAllowed(voiceBarModel(view({ status: "full" }), "lobby"), false));
    // The menu has no Join voice where voice cannot work.
    expect(joinAllowed(voiceBarModel(view({ status: "unsupported" }), "playing"), false)).toBe(false);
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
  it("Join voice out of voice (also when full, to try again), Voice in voice, nothing where voice cannot work", () => {
    expect(voiceMenuItem(view({ status: "off" }))).toBe("join");
    expect(voiceMenuItem(view({ status: "on" }))).toBe("voice");
    expect(voiceMenuItem(view({ status: "joining" }))).toBe("voice");
    expect(voiceMenuItem(view({ status: "full" }))).toBe("join");
    expect(voiceMenuItem(view({ status: "unsupported" }))).toBeNull();
  });
});
