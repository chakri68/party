import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The socket the client made, so a test can play server messages into it. */
const sockets: FakeSocket[] = [];

class FakeSocket {
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor() {
    sockets.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  send() {}
  close() {}
  reconnect() {}
  receive(msg: unknown) {
    for (const fn of this.listeners.get("message") ?? []) fn({ data: JSON.stringify(msg) });
  }
}

vi.mock("partysocket", () => ({ PartySocket: FakeSocket }));

const noop = () => {};

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal("window", { location: { host: "test" }, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal("document", { addEventListener: noop, removeEventListener: noop, visibilityState: "visible" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RoomClient voice events", () => {
  it("sends out voice-state, voice-signal and voice-ice", async () => {
    const { RoomClient } = await import("../src/index.ts");
    const client = new RoomClient({ code: "ABCD", name: "A", avatarSeed: "s", getResumeToken: () => undefined });
    const got: [string, unknown][] = [];
    client.on("voice-state", (p) => got.push(["voice-state", p]));
    client.on("voice-signal", (p) => got.push(["voice-signal", p]));
    client.on("voice-ice", (p) => got.push(["voice-ice", p]));
    const socket = sockets[0]!;
    const members = [{ id: "p1", selfMuted: false, hostMuted: false }];
    socket.receive({ type: "voice-state", members });
    socket.receive({ type: "voice-signal", from: "p2", session: "s.0", data: { kind: "ice" } });
    socket.receive({ type: "voice-ice", iceServers: [{ urls: "stun:x" }], expiresAt: 5 });
    expect(got).toEqual([
      ["voice-state", { type: "voice-state", members }],
      ["voice-signal", { type: "voice-signal", from: "p2", session: "s.0", data: { kind: "ice" } }],
      ["voice-ice", { type: "voice-ice", iceServers: [{ urls: "stun:x" }], expiresAt: 5 }],
    ]);
  });

  it("has no stray fields named after the events", async () => {
    const { RoomClient } = await import("../src/index.ts");
    const client = new RoomClient({ code: "ABCD", name: "A", avatarSeed: "s", getResumeToken: () => undefined });
    for (const name of ["voice-state", "voice-signal", "voice-ice"]) expect(Object.hasOwn(client, name), name).toBe(false);
  });
});

describe("RoomClient sound events", () => {
  it("sends out sound", async () => {
    const { RoomClient } = await import("../src/index.ts");
    const client = new RoomClient({ code: "ABCD", name: "A", avatarSeed: "s", getResumeToken: () => undefined });
    const got: unknown[] = [];
    client.on("sound", (p) => got.push(p));
    sockets[0]!.receive({ type: "sound", id: "free:rise", by: "p2" });
    expect(got).toEqual([{ type: "sound", id: "free:rise", by: "p2" }]);
  });
});
