import type { RoomPublicState } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { ROOM_MENU_LABELS, roomMenuItems } from "../src/views/room-menu.ts";

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

  it("empty outside a game", () => {
    const o = { board: true, voice: "join", pausable: true } as const;
    expect(roomMenuItems(room({ phase: "lobby" }), "amy", o)).toEqual([]);
    expect(roomMenuItems(room({ phase: "results" }), "amy", o)).toEqual([]);
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
