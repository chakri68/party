import type { RoomPublicState } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { focusPhase, ROOM_MENU_LABELS, roomMenuItems } from "../src/views/room-menu.ts";

const room = (extra: Partial<RoomPublicState> = {}): RoomPublicState =>
  ({ hostId: "amy", phase: "playing", paused: false, ...extra }) as RoomPublicState;

describe("the room menu", () => {
  it("player menu in a game", () => {
    expect(roomMenuItems(room(), "ben", { board: true, voice: "join", pausable: true })).toEqual([
      "sounds",
      "reactions",
      "join-voice",
      "settings",
      "home",
    ]);
  });

  it("host menu, pausable, paused", () => {
    expect(roomMenuItems(room({ paused: true }), "amy", { board: true, voice: "voice", pausable: true })).toEqual([
      "sounds",
      "reactions",
      "voice",
      "settings",
      "resume",
      "restart",
      "end-game",
      "home",
    ]);
  });

  it("host menu, pausable, running", () => {
    const items = roomMenuItems(room(), "amy", { board: true, voice: "voice", pausable: true });
    expect(items).toContain("pause");
    expect(items).not.toContain("resume");
  });

  it("no pause for a game without it", () => {
    const items = roomMenuItems(room(), "amy", { board: true, voice: "join", pausable: false });
    expect(items).toContain("restart");
    expect(items).not.toContain("pause");
    expect(items).not.toContain("resume");
  });

  it("no board, no voice", () => {
    expect(roomMenuItems(room(), "ben", { board: false, voice: null, pausable: true })).toEqual(["reactions", "settings", "home"]);
  });

  it("host handover", () => {
    const o = { board: true, voice: "join", pausable: false } as const;
    const before = roomMenuItems(room({ hostId: "amy" }), "amy", o);
    const after = roomMenuItems(room({ hostId: "ben" }), "amy", o);
    expect(before).toContain("restart");
    expect(before).toContain("end-game");
    expect(after).toEqual(before.filter((i) => i !== "restart" && i !== "end-game"));
  });

  it("no host actions when they cannot reach the room", () => {
    const items = roomMenuItems(room(), "amy", { board: true, voice: "voice", pausable: true, hostActions: false });
    expect(items).toEqual(["sounds", "reactions", "voice", "settings", "home"]);
  });

  it("lobby and results: the same list, never the host items", () => {
    const o = { board: true, voice: "join", pausable: true } as const;
    for (const phase of ["lobby", "results"] as const) {
      expect(roomMenuItems(room({ phase }), "amy", o), phase).toEqual(["sounds", "reactions", "join-voice", "settings", "home"]);
      expect(roomMenuItems(room({ phase }), "ben", o)).toEqual(roomMenuItems(room({ phase }), "amy", o));
      expect(roomMenuItems(room({ phase, paused: true }), "amy", { ...o, voice: "voice" })).toEqual(["sounds", "reactions", "voice", "settings", "home"]);
    }
  });

  it("empty when the party is over", () => {
    const o = { board: true, voice: "join", pausable: true } as const;
    expect(roomMenuItems(room({ phase: "ended" }), "amy", o)).toEqual([]);
  });

  it("focus screens: lobby, playing and results", () => {
    expect(focusPhase("lobby")).toBe(true);
    expect(focusPhase("playing")).toBe(true);
    expect(focusPhase("results")).toBe(true);
    expect(focusPhase("ended")).toBe(false);
    expect(focusPhase(null)).toBe(false);
  });

  it("labels every item in plain words", () => {
    expect(ROOM_MENU_LABELS).toEqual({
      sounds: "Sound board",
      reactions: "Reactions",
      "join-voice": "Join voice",
      voice: "Voice",
      settings: "Sound and vibration",
      pause: "Pause",
      resume: "Resume",
      restart: "Restart",
      "end-game": "End game",
      home: "Home",
    });
  });
});
