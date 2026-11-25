import type { RoomPublicState } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { focusPhase, slimHeader } from "../src/views/focus.ts";
import { ROOM_MENU_LABELS, roomMenuItems } from "../src/views/room-menu.ts";

const room = (extra: Partial<RoomPublicState> = {}): RoomPublicState =>
  ({ hostId: "amy", phase: "playing", paused: false, ...extra }) as RoomPublicState;

describe("the room menu", () => {
  it("player menu in a game", () => {
    expect(roomMenuItems(room(), "ben", { voice: "join", pausable: true })).toEqual([
      "join-voice",
      "settings",
      "home",
    ]);
  });

  it("host menu, pausable, paused", () => {
    expect(roomMenuItems(room({ paused: true }), "amy", { voice: "voice", pausable: true })).toEqual([
      "voice",
      "settings",
      "resume",
      "restart",
      "end-game",
      "home",
    ]);
  });

  it("host menu, pausable, running", () => {
    const items = roomMenuItems(room(), "amy", { voice: "voice", pausable: true });
    expect(items).toContain("pause");
    expect(items).not.toContain("resume");
  });

  it("no pause for a game without it", () => {
    const items = roomMenuItems(room(), "amy", { voice: "join", pausable: false });
    expect(items).toContain("restart");
    expect(items).not.toContain("pause");
    expect(items).not.toContain("resume");
  });

  it("no voice", () => {
    expect(roomMenuItems(room(), "ben", { voice: null, pausable: true })).toEqual(["settings", "home"]);
  });

  it("host handover", () => {
    const o = { voice: "join", pausable: false } as const;
    const before = roomMenuItems(room({ hostId: "amy" }), "amy", o);
    const after = roomMenuItems(room({ hostId: "ben" }), "amy", o);
    expect(before).toContain("restart");
    expect(before).toContain("end-game");
    expect(after).toEqual(before.filter((i) => i !== "restart" && i !== "end-game"));
  });

  it("no host actions when they cannot reach the room", () => {
    const items = roomMenuItems(room(), "amy", { voice: "voice", pausable: true, hostActions: false });
    expect(items).toEqual(["voice", "settings", "home"]);
  });

  it("lobby and results: the same list, never the host items", () => {
    const o = { voice: "join", pausable: true } as const;
    for (const phase of ["lobby", "results"] as const) {
      expect(roomMenuItems(room({ phase }), "amy", o), phase).toEqual(["join-voice", "settings", "home"]);
      expect(roomMenuItems(room({ phase }), "ben", o)).toEqual(roomMenuItems(room({ phase }), "amy", o));
      expect(roomMenuItems(room({ phase, paused: true }), "amy", { ...o, voice: "voice" })).toEqual(["voice", "settings", "home"]);
    }
  });

  it("says when voice does not work here, where Join voice would be, on every room screen", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      expect(roomMenuItems(room({ phase }), "ben", { voice: "unsupported", pausable: true }), phase).toEqual([
        "no-voice",
        "settings",
        "home",
      ]);
    }
  });

  it("never lists the sound board or reactions: they are header buttons", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      const items: string[] = roomMenuItems(room({ phase }), "amy", { voice: "voice", pausable: true });
      expect(items).not.toContain("sounds");
      expect(items).not.toContain("reactions");
    }
  });

  it("party over: sound settings and home only, no voice or host items", () => {
    const o = { voice: "join", pausable: true } as const;
    expect(roomMenuItems(room({ phase: "ended" }), "amy", o)).toEqual(["settings", "home"]);
  });

  it("My sounds for the host who owns sounds", () => {
    const o = { voice: "join", pausable: true, mySounds: true } as const;
    for (const phase of ["lobby", "playing", "results"] as const) {
      const items = roomMenuItems(room({ phase }), "amy", o);
      expect(items[items.indexOf("settings") + 1], phase).toBe("my-sounds");
      expect(roomMenuItems(room({ phase }), "ben", o), phase).not.toContain("my-sounds");
      expect(roomMenuItems(room({ phase }), "amy", { ...o, mySounds: false }), phase).not.toContain("my-sounds");
    }
    expect(roomMenuItems(room({ phase: "ended" }), "amy", o)).toEqual(["settings", "home"]);
  });

  it("lists Mute all and Allow all to talk after the voice item for the host in lobby, game and results", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      for (const voice of ["voice", "join", "unsupported"] as const) {
        const items = roomMenuItems(room({ phase }), "amy", { voice, pausable: true, muteAll: ["mute-all"] });
        expect(items[1], `${phase} ${voice}`).toBe("mute-all");
        expect(items, `${phase} ${voice}`).not.toContain("allow-all");
      }
      const allow = roomMenuItems(room({ phase }), "amy", { voice: "voice", pausable: true, muteAll: ["allow-all"] });
      expect(allow.slice(0, 3), phase).toEqual(["voice", "allow-all", "settings"]);
      // Some muted: both, Mute all first.
      const both = roomMenuItems(room({ phase }), "amy", { voice: "voice", pausable: true, muteAll: ["mute-all", "allow-all"] });
      expect(both.slice(0, 4), phase).toEqual(["voice", "mute-all", "allow-all", "settings"]);
      // Only ever for the host.
      const ben = roomMenuItems(room({ phase }), "ben", { voice: "voice", pausable: true, muteAll: ["mute-all", "allow-all"] });
      expect(ben, phase).not.toContain("mute-all");
      expect(ben, phase).not.toContain("allow-all");
    }
  });

  it("no Mute all when muteAll is empty or the party has ended", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      for (const muteAll of [[], undefined]) {
        const items: string[] = roomMenuItems(room({ phase }), "amy", { voice: "voice", pausable: true, muteAll });
        expect(items).not.toContain("mute-all");
        expect(items).not.toContain("allow-all");
      }
    }
    expect(roomMenuItems(room({ phase: "ended" }), "amy", { voice: "voice", pausable: true, muteAll: ["mute-all", "allow-all"] })).toEqual(["settings", "home"]);
  });

  it("focus screens: lobby, playing and results", () => {
    expect(focusPhase("lobby")).toBe(true);
    expect(focusPhase("playing")).toBe(true);
    expect(focusPhase("results")).toBe(true);
    expect(focusPhase("ended")).toBe(false);
    expect(focusPhase(null)).toBe(false);
  });

  it("slim header on the focus screens and party over", () => {
    expect(slimHeader("lobby")).toBe(true);
    expect(slimHeader("playing")).toBe(true);
    expect(slimHeader("results")).toBe(true);
    expect(slimHeader("ended")).toBe(true);
    expect(slimHeader(null)).toBe(false);
  });

  it("labels every item in plain words", () => {
    expect(ROOM_MENU_LABELS).toEqual({
      "join-voice": "Join voice",
      voice: "Voice",
      "mute-all": "Mute all",
      "allow-all": "Allow all to talk",
      settings: "Sound and vibration",
      "my-sounds": "My sounds",
      pause: "Pause",
      resume: "Resume",
      restart: "Restart",
      "end-game": "End game",
      home: "Home",
      "no-voice": "Voice does not work in this browser.",
    });
  });
});
