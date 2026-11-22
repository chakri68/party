import { GRACE_MS, VOICE_CAP } from "@games/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { pruneVoice } from "../src/voice.ts";
import { plainGame, toyGame, toyKnobs } from "./bot-toy.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

const games = { toy: toyGame, plain: plainGame };

describe("pruneVoice", () => {
  const m = (id: string) => ({ id, selfMuted: false, hostMuted: false });
  const seats = [
    { id: "a", presence: "connected" as const },
    { id: "b", presence: "reconnecting" as const },
    { id: "c", presence: "disconnected" as const },
    { id: "d", presence: "left" as const },
    { id: "e", presence: "connected" as const, bot: true as const },
  ];
  it("keeps connected and reconnecting people, in order", () => {
    expect(pruneVoice([m("e"), m("d"), m("b"), m("x"), m("c"), m("a")], seats, "lobby").map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("is empty once the party ended", () => {
    expect(pruneVoice([m("a")], seats, "ended")).toEqual([]);
  });
});

describe("voice roster", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  const idOf = (c: FakeConn) => c.last("welcome")!.playerId;
  const members = (c: FakeConn) => c.last("voice-state")!.members;
  const voiceCount = (...cs: FakeConn[]) => cs.reduce((n, c) => n + c.inbox.filter((m) => m.type.startsWith("voice-")).length, 0);
  const vjoin = (c: FakeConn, muted = false) => send(room, c, { type: "voice-join", muted });

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
  });

  it("a new seat gets voice-state right after welcome, before its update", () => {
    const types = a.inbox.map((m) => m.type);
    const w = types.indexOf("welcome");
    expect(types.indexOf("voice-state")).toBe(w + 1);
    expect(types.indexOf("voice-state")).toBeLessThan(types.indexOf("update"));
    expect(a.of("voice-state")[0]!.members).toEqual([]);
  });

  it("joining sends voice-state to everyone and no update", async () => {
    const v = a.last("update")!.stateVersion;
    const n = b.of("update").length;
    await vjoin(a);
    expect(members(b)).toEqual([{ id: idOf(a), selfMuted: false, hostMuted: false }]);
    expect(members(a)).toEqual(members(b));
    expect(b.of("update")).toHaveLength(n);
    expect(a.last("update")!.stateVersion).toBe(v);
  });

  it("listen only joins muted", async () => {
    await vjoin(a, true);
    expect(members(b)[0]).toMatchObject({ selfMuted: true });
  });

  it("leave and self-mute each send voice-state", async () => {
    await vjoin(a);
    await send(room, a, { type: "voice-self-mute", muted: true });
    expect(members(b)[0]!.selfMuted).toBe(true);
    await send(room, a, { type: "voice-self-mute", muted: false });
    expect(members(b)[0]!.selfMuted).toBe(false);
    await send(room, a, { type: "voice-leave" });
    expect(members(b)).toEqual([]);
  });

  it("a repeated self-mute sends nothing", async () => {
    await vjoin(a);
    await send(room, a, { type: "voice-self-mute", muted: true });
    const n = voiceCount(a, b);
    await send(room, a, { type: "voice-self-mute", muted: true });
    await send(room, b, { type: "voice-self-mute", muted: true });
    await send(room, b, { type: "voice-leave" });
    expect(voiceCount(a, b)).toBe(n);
  });

  it("a host-muted member cannot unmute", async () => {
    await vjoin(a);
    (room as unknown as { data: { voice: { hostMuted: boolean }[] } }).data.voice[0]!.hostMuted = true;
    await send(room, a, { type: "voice-self-mute", muted: false });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "The host muted you" });
  });

  it("the ninth person gets Voice is full.", async () => {
    // The toy game seats 4; a wider table lets nine people in.
    const wide = { ...toyGame, manifest: { ...toyGame.manifest, maxPlayers: 12 } };
    room = new RoomRuntime("K7DX", world.host(), { toy: wide }, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
    const cs = [a, b];
    for (let i = 2; i < VOICE_CAP + 1; i++) cs.push(await join(world, room, `P${i}`));
    for (const c of cs.slice(0, VOICE_CAP)) await vjoin(c);
    const ninth = cs[VOICE_CAP]!;
    await vjoin(ninth);
    expect(ninth.last("error")).toMatchObject({ code: "voice-full", message: "Voice is full.", fatal: false });
    expect(members(a)).toHaveLength(VOICE_CAP);
    expect(ninth.closed).toBeNull();
  });

  it("refuses voice-join after the party ended", async () => {
    await send(room, a, { type: "end-party" });
    await vjoin(b);
    expect(b.last("error")).toMatchObject({ code: "wrong-phase" });
    expect((room as unknown as { data: { voice?: unknown[] } }).data.voice ?? []).toEqual([]);
  });

  it("keeps a reconnecting seat in voice", async () => {
    await vjoin(b);
    await world.disconnect(room, b);
    expect(roomOf(a).seats.find((s) => s.id === idOf(b))!.presence).toBe("reconnecting");
    expect(members(a).map((x) => x.id)).toEqual([idOf(b)]);
  });

  it("drops a seat from voice when lobby grace runs out", async () => {
    await vjoin(b);
    await world.disconnect(room, b);
    await world.tick(room, GRACE_MS);
    expect(members(a)).toEqual([]);
  });

  it("drops a disconnected seat from voice mid-game", async () => {
    await vjoin(b);
    await send(room, a, { type: "start-game" });
    await world.disconnect(room, b);
    await world.tick(room, GRACE_MS);
    expect(roomOf(a).seats.find((s) => s.id === idOf(b))!.presence).toBe("disconnected");
    expect(members(a)).toEqual([]);
  });

  it("a reconnecting seat dropped by Start leaves voice", async () => {
    await vjoin(b);
    await world.disconnect(room, b);
    await send(room, a, { type: "start-game" });
    expect(members(a).map((x) => x.id)).not.toContain(idOf(b));
  });

  it("leave, Remove and End party empty the roster for them", async () => {
    const c = await join(world, room, "Cy");
    await vjoin(a);
    await vjoin(b);
    await vjoin(c);
    await send(room, c, { type: "leave" });
    expect(members(a).map((x) => x.id)).toEqual([idOf(a), idOf(b)]);
    await send(room, a, { type: "remove-player", playerId: idOf(b) });
    expect(members(a).map((x) => x.id)).toEqual([idOf(a)]);
    await send(room, a, { type: "end-party" });
    expect(members(a)).toEqual([]);
  });

  it("switching games sends no voice messages", async () => {
    await vjoin(a);
    await vjoin(b);
    const n = voiceCount(a, b);
    await send(room, a, { type: "start-game" });
    await send(room, a, { type: "return-to-lobby" });
    await send(room, a, { type: "select-game", gameId: "plain" });
    await send(room, a, { type: "start-game" });
    await send(room, a, { type: "end-game" });
    expect(voiceCount(a, b)).toBe(n);
  });

  it("roomOf(a).voice.mode is global, and off once the party ends", async () => {
    expect(roomOf(a).voice.mode).toBe("global");
    await send(room, a, { type: "end-party" });
    expect(roomOf(a).voice.mode).toBe("off");
  });

  it("one storage write per roster change", async () => {
    const p = world.puts;
    await vjoin(a);
    expect(world.puts).toBe(p + 1);
  });
});
