import type { RoomPhase, RoomPublicState } from "@games/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardSound } from "../src/sounds/packs.ts";
import { SoundBoardView, soundBoardModel } from "../src/views/sound-board.ts";

/** Just enough DOM for SoundBoardView to build its elements. */
class FakeEl {
  hidden = false;
  className = "";
  innerHTML = "";
  textContent = "";
  style = { setProperty() {} };
  classList = { add() {}, remove() {} };
  private attrs = new Map<string, string>();
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  children: unknown[] = [];
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === "hidden") this.hidden = true;
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  append(...c: unknown[]) {
    this.children.push(...c);
  }
  replaceChildren(...c: unknown[]) {
    this.children = c;
  }
  contains() {
    return true;
  }
  focus() {}
  click() {
    for (const fn of this.listeners.get("click") ?? []) fn({});
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const room = (r: { hostId: string; phase: RoomPhase; sounds: boolean; hostSounds?: boolean }): RoomPublicState => r as RoomPublicState;
const SOUNDS: BoardSound[] = [
  { id: "free:rise", name: "Rise", ms: 900, url: "/a.mp3" },
  { id: "memes:bruh", name: "Bruh", ms: 800, url: "/b.mp3" },
];

describe("the sound board model", () => {
  it("no button once the party has ended", () => {
    const r = room({ hostId: "amy", phase: "ended", sounds: true });
    expect(soundBoardModel(r, "amy", SOUNDS, true).button).toBe(false);
    expect(soundBoardModel(r, "ben", SOUNDS, true).button).toBe(false);
  });

  it("everyone has the button while sounds are on, and only the host when they are off", () => {
    for (const phase of ["lobby", "playing", "results"] as const) {
      const on = room({ hostId: "amy", phase, sounds: true });
      expect(soundBoardModel(on, "amy", SOUNDS, true).button).toBe(true);
      expect(soundBoardModel(on, "ben", SOUNDS, true).button).toBe(true);
      const off = room({ hostId: "amy", phase, sounds: false });
      expect(soundBoardModel(off, "amy", SOUNDS, true).button).toBe(true);
      expect(soundBoardModel(off, "ben", SOUNDS, true).button).toBe(false);
    }
  });

  it("the host gets the switch", () => {
    const on = room({ hostId: "amy", phase: "lobby", sounds: true });
    expect(soundBoardModel(on, "amy", SOUNDS, true).hostSwitch).toEqual({
      label: "Sounds: on",
      pressed: true,
      message: { type: "room-sounds", on: false },
    });
    const off = room({ hostId: "amy", phase: "playing", sounds: false });
    expect(soundBoardModel(off, "amy", SOUNDS, true).hostSwitch).toEqual({
      label: "Sounds: off",
      pressed: false,
      message: { type: "room-sounds", on: true },
    });
    expect(soundBoardModel(on, "ben", SOUNDS, true).hostSwitch).toBeNull();
  });

  it("no tiles while sounds are off", () => {
    const off = room({ hostId: "amy", phase: "lobby", sounds: false });
    expect(soundBoardModel(off, "amy", SOUNDS, true).tiles).toEqual([]);
    expect(soundBoardModel(off, "ben", SOUNDS, true).tiles).toEqual([]);
    const on = room({ hostId: "amy", phase: "lobby", sounds: true });
    expect(soundBoardModel(on, "ben", SOUNDS, true).tiles).toEqual([
      { id: "free:rise", name: "Rise" },
      { id: "memes:bruh", name: "Bruh" },
    ]);
  });

  it("notes", () => {
    const on = room({ hostId: "amy", phase: "lobby", sounds: true });
    const off = room({ hostId: "amy", phase: "lobby", sounds: false });
    // First match wins: the host's room switch, then this phone, then an empty list.
    expect(soundBoardModel(off, "amy", [], false).note).toBe("Sounds are off for everyone.");
    expect(soundBoardModel(on, "amy", [], false).note).toBe("Sounds are off on this phone. Turn them on in Settings.");
    expect(soundBoardModel(on, "ben", [], false).note).toBe("Sounds are off on this phone. Turn them on in Settings.");
    expect(soundBoardModel(on, "ben", [], true).note).toBe("No sounds yet.");
    expect(soundBoardModel(on, "ben", SOUNDS, true).note).toBeNull();
    expect(soundBoardModel(on, "amy", SOUNDS, true).note).toBeNull();
  });

  it("host tiles follow the others", () => {
    const r = room({ hostId: "amy", phase: "lobby", sounds: true, hostSounds: true });
    const list: BoardSound[] = [
      ...SOUNDS,
      { id: "host:1", name: "Horn", ms: 700, url: "/api/rooms/K7DX/sounds/1?v=0123456789" },
      { id: "host:3", name: "Clap", ms: 600, url: "/api/rooms/K7DX/sounds/3?v=0123456789" },
    ];
    expect(soundBoardModel(r, "ben", list, true).tiles.map((t) => t.id)).toEqual(["free:rise", "memes:bruh", "host:1", "host:3"]);
  });

});

describe("the sound board view", () => {
  it("onOpen runs once per real open, not on toggle(true) while open", () => {
    vi.stubGlobal("Node", FakeEl);
    vi.stubGlobal("document", { createElement: () => new FakeEl(), addEventListener() {}, removeEventListener() {} });
    let opens = 0;
    const board = { list: () => [], onChange: () => () => {}, tap: () => "sent" as const, coolingMs: () => 0 };
    const view = new SoundBoardView(board, { send() {}, toast() {}, playHere: () => true, onOpen: () => opens++ });
    expect(opens).toBe(0);
    view.toggle(true);
    expect(opens).toBe(1);
    view.toggle(true);
    expect(opens).toBe(1);
    view.toggle(false);
    view.toggle(false);
    expect(opens).toBe(1);
    view.toggle();
    expect(opens).toBe(2);
    view.toggle();
    expect(opens).toBe(2);
    view.destroy();
  });
});
