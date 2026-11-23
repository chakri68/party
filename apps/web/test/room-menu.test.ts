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
      settings: "Sound and vibration",
      pause: "Pause",
      resume: "Resume",
      restart: "Restart",
      "end-game": "End game",
      home: "Home",
      "no-voice": "Voice does not work in this browser.",
    });
  });
});
