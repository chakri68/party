import { GRACE_MS, VOICE_CAP, type IceServer } from "@games/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { ICE_FAIL_BACKOFF_MS, ICE_REUSE_MARGIN_MS, pruneVoice, STUN_ONLY, TURN_TTL_S, VOICE_SIGNAL_LIMIT } from "../src/voice.ts";
import { plainGame, TOY_WINDOW_MS, toyGame, toyKnobs } from "./bot-toy.ts";
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
    expect(pruneVoice([m("e"), m("d"), m("b"), m("x"), m("c"), m("a")], seats, "lobby", null).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("is empty once the party ended", () => {
    expect(pruneVoice([m("a")], seats, "ended", "a")).toEqual([]);
  });
  it("clears the host's own host mute, on a copy", () => {
    const hm = { id: "a", selfMuted: true, hostMuted: true };
    const other = { id: "b", selfMuted: true, hostMuted: true };
    const out = pruneVoice([hm, other], seats, "lobby", "a");
    expect(out).toEqual([{ id: "a", selfMuted: true, hostMuted: false }, other]);
    expect(hm.hostMuted).toBe(true);
    expect(pruneVoice([hm], seats, "lobby", null)).toEqual([hm]);
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
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "The host muted you." });
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

  it("switching games, through results, sends no voice messages", async () => {
    await vjoin(a);
    await vjoin(b);
    const n = voiceCount(a, b);
    await send(room, a, { type: "start-game" });
    await send(room, a, { type: "return-to-lobby" });
    await send(room, a, { type: "select-game", gameId: "plain" });
    await send(room, a, { type: "start-game" });
    // Play it to the end: count to 10, then the call window closes.
    const turnOf = () => (roomOf(a).game as { turnId: string | null }).turnId;
    for (let i = 0; i < 20 && roomOf(a).phase === "playing" && turnOf(); i++) {
      const mover = turnOf() === idOf(a) ? a : b;
      await send(room, mover, { type: "game-action", clientActionId: `n${i}`, action: { type: "add", n: 2 } });
    }
    await world.tick(room, TOY_WINDOW_MS);
    expect(roomOf(a).phase).toBe("results");
    await send(room, a, { type: "return-to-lobby" });
    expect(roomOf(a).phase).toBe("lobby");
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    expect(voiceCount(a, b)).toBe(n);
    expect(members(a).map((x) => x.id)).toEqual([idOf(a), idOf(b)]);
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

  describe("host mute", () => {
    let c: FakeConn;
    const hmute = (from: FakeConn, playerId: string, muted: boolean) => send(room, from, { type: "host-mute", playerId, muted });
    const entry = (of: FakeConn) => members(b).find((x) => x.id === idOf(of));

    beforeEach(async () => {
      c = await join(world, room, "Cy");
      await vjoin(b);
      await vjoin(c);
    });

    it("host-mute mutes one member: hostMuted and selfMuted, voice-state only, same version", async () => {
      const v = b.last("update")!.stateVersion;
      const n = b.of("update").length;
      const p = world.puts;
      await hmute(a, idOf(c), true);
      expect(entry(c)).toEqual({ id: idOf(c), selfMuted: true, hostMuted: true });
      expect(entry(b)).toEqual({ id: idOf(b), selfMuted: false, hostMuted: false });
      expect(b.of("update")).toHaveLength(n);
      expect(b.last("update")!.stateVersion).toBe(v);
      expect(world.puts).toBe(p + 1);
    });

    it("lifting a host mute leaves the person self-muted", async () => {
      await hmute(a, idOf(c), true);
      await hmute(a, idOf(c), false);
      expect(entry(c)).toEqual({ id: idOf(c), selfMuted: true, hostMuted: false });
      await send(room, c, { type: "voice-self-mute", muted: false });
      expect(entry(c)).toEqual({ id: idOf(c), selfMuted: false, hostMuted: false });
    });

    it("mute all mutes everyone in voice but the host; a later joiner is not muted", async () => {
      await vjoin(a);
      await hmute(a, "all", true);
      expect(members(b)).toEqual([
        { id: idOf(b), selfMuted: true, hostMuted: true },
        { id: idOf(c), selfMuted: true, hostMuted: true },
        { id: idOf(a), selfMuted: false, hostMuted: false },
      ]);
      const d = await join(world, room, "Dev");
      await vjoin(d);
      expect(entry(d)).toEqual({ id: idOf(d), selfMuted: false, hostMuted: false });
    });

    it("allow all clears hostMuted for everyone and leaves them self-muted", async () => {
      await hmute(a, "all", true);
      await hmute(a, "all", false);
      expect(members(b)).toEqual([
        { id: idOf(b), selfMuted: true, hostMuted: false },
        { id: idOf(c), selfMuted: true, hostMuted: false },
      ]);
    });

    it("host-mute from a non-host changes nothing", async () => {
      const n = voiceCount(a, b, c);
      const p = world.puts;
      await hmute(b, idOf(c), true);
      await hmute(b, "all", true);
      expect(b.last("error")).toMatchObject({ code: "not-host" });
      expect(voiceCount(a, b, c)).toBe(n);
      expect(world.puts).toBe(p);
      expect(entry(c)).toEqual({ id: idOf(c), selfMuted: false, hostMuted: false });
    });

    it("host-mute of someone not in voice says They are not in voice.", async () => {
      await hmute(a, "nobody", true);
      expect(a.last("error")).toMatchObject({ code: "not-available", message: "They are not in voice." });
      await vjoin(a);
      await hmute(a, idOf(a), true);
      expect(a.last("error")).toMatchObject({ code: "not-available", message: "You can't mute yourself here." });
      expect(entry(a)).toEqual({ id: idOf(a), selfMuted: false, hostMuted: false });
    });

    it("the host is never host-muted after Make host or a new host", async () => {
      await hmute(a, idOf(c), true);
      await send(room, a, { type: "transfer-host", playerId: idOf(c) });
      expect(entry(c)).toEqual({ id: idOf(c), selfMuted: true, hostMuted: false });
      const stored = (room as unknown as { data: { voice: { id: string; hostMuted: boolean }[] } }).data.voice;
      expect(stored.find((x) => x.id === idOf(c))!.hostMuted).toBe(false);
      // The new host mutes b; a and then c leave, so b becomes host and is free.
      await hmute(c, idOf(b), true);
      expect(entry(b)).toMatchObject({ hostMuted: true });
      await send(room, a, { type: "leave" });
      await send(room, c, { type: "leave" });
      expect(roomOf(b).hostId).toBe(idOf(b));
      expect(entry(b)).toEqual({ id: idOf(b), selfMuted: true, hostMuted: false });
    });

    it("host-mute with nothing to change sends no voice-state", async () => {
      await hmute(a, idOf(c), true);
      await hmute(a, idOf(b), false);
      const n = voiceCount(a, b, c);
      const p = world.puts;
      await hmute(a, idOf(c), true);
      await hmute(a, idOf(b), false);
      await hmute(a, "all", true);
      await hmute(a, "all", true);
      // The one real change ("all" muting b) sent once.
      expect(voiceCount(a, b, c)).toBe(n + 3);
      expect(world.puts).toBe(p + 1);
    });
  });
});

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("voice signals and ICE", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  let c: FakeConn;
  const idOf = (x: FakeConn) => x.last("welcome")!.playerId;
  const vjoin = async (x: FakeConn) => {
    await send(room, x, { type: "voice-join", muted: false });
    await flushPromises();
  };
  const sig = (from: FakeConn, to: FakeConn, data: unknown = { sdp: "x" }) =>
    send(room, from, { type: "voice-signal", to: idOf(to), session: "s1", data });
  const TURN: IceServer[] = [{ urls: ["turn:t.example:3478"], username: "u", credential: "p" }];
  let calls: number;

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    calls = 0;
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
    c = await join(world, room, "Cy");
  });

  it("a signal reaches only its target", async () => {
    await vjoin(a);
    await vjoin(b);
    await vjoin(c);
    await sig(a, b);
    expect(b.last("voice-signal")).toEqual({ type: "voice-signal", from: idOf(a), session: "s1", data: { sdp: "x" } });
    expect(c.of("voice-signal")).toHaveLength(0);
    expect(a.of("voice-signal")).toHaveLength(0);
  });

  it("drops a signal to or from a seat not in voice, or to itself", async () => {
    await vjoin(a);
    await vjoin(b);
    await sig(a, c);
    await sig(c, a);
    await sig(a, a);
    expect(a.of("voice-signal")).toHaveLength(0);
    expect(c.of("voice-signal")).toHaveLength(0);
    expect(a.of("error")).toHaveLength(0);
  });

  it("drops signals past the rate limit", async () => {
    await vjoin(a);
    await vjoin(b);
    for (let i = 0; i < VOICE_SIGNAL_LIMIT.burst + 10; i++) await sig(a, b, { i });
    expect(b.of("voice-signal")).toHaveLength(VOICE_SIGNAL_LIMIT.burst);
    world.clock += VOICE_SIGNAL_LIMIT.windowMs;
    await sig(a, b, { late: 1 });
    expect(b.of("voice-signal")).toHaveLength(VOICE_SIGNAL_LIMIT.burst + 1);
  });

  it("relaying a signal writes nothing", async () => {
    await vjoin(a);
    await vjoin(b);
    const puts = world.puts;
    await sig(a, b);
    await send(room, a, { type: "voice-ice-request" });
    await flushPromises();
    expect(world.puts).toBe(puts);
  });

  it("joining voice with no TURN gives STUN only", async () => {
    await vjoin(a);
    expect(a.last("voice-ice")).toEqual({ type: "voice-ice", iceServers: STUN_ONLY, expiresAt: world.clock + TURN_TTL_S * 1000 });
  });

  it("hands out TURN servers and fetches once for the room", async () => {
    world.turn = async () => (calls++, TURN);
    await vjoin(a);
    await vjoin(b);
    expect(a.last("voice-ice")!.iceServers).toEqual(TURN);
    expect(b.last("voice-ice")!.iceServers).toEqual(TURN);
    expect(calls).toBe(1);
  });

  it("fetches again when the cached ones are near expiry", async () => {
    world.turn = async () => (calls++, TURN);
    await vjoin(a);
    world.clock += TURN_TTL_S * 1000 - ICE_REUSE_MARGIN_MS - 1;
    await send(room, a, { type: "voice-ice-request" });
    await flushPromises();
    expect(calls).toBe(1);
    world.clock += 2;
    await send(room, a, { type: "voice-ice-request" });
    await flushPromises();
    expect(calls).toBe(2);
  });

  it("only members may ask for ICE servers, and not too often", async () => {
    await send(room, b, { type: "voice-ice-request" });
    await flushPromises();
    expect(b.of("voice-ice")).toHaveLength(0);
    await vjoin(a);
    for (let i = 0; i < 5; i++) await send(room, a, { type: "voice-ice-request" });
    await flushPromises();
    expect(a.of("voice-ice")).toHaveLength(4); // the join, then three requests
  });

  it("a failed TURN fetch gives STUN only, and waits a minute to retry", async () => {
    world.turn = async () => (calls++, null);
    await vjoin(a);
    expect(a.last("voice-ice")).toEqual({ type: "voice-ice", iceServers: STUN_ONLY, expiresAt: world.clock + ICE_FAIL_BACKOFF_MS });
    await vjoin(b);
    expect(calls).toBe(1);
    expect(b.last("voice-ice")!.iceServers).toEqual(STUN_ONLY);
    world.clock += ICE_FAIL_BACKOFF_MS;
    world.turn = async () => (calls++, TURN);
    await send(room, a, { type: "voice-ice-request" });
    await flushPromises();
    expect(calls).toBe(2);
    expect(a.last("voice-ice")!.iceServers).toEqual(TURN);
  });

  it("a throwing TURN fetch gives STUN only", async () => {
    world.turn = async () => {
      throw new Error("down");
    };
    await vjoin(a);
    expect(a.last("voice-ice")!.iceServers).toEqual(STUN_ONLY);
  });

  it("a hung TURN fetch does not hold up the room", async () => {
    world.turn = () => new Promise(() => {});
    await send(room, a, { type: "voice-join", muted: false });
    await send(room, a, { type: "ready", ready: true });
    expect(roomOf(b).seats.find((s) => s.id === idOf(a))!.ready).toBe(true);
  });

  it("no voice-ice for a seat that left voice before the fetch came back", async () => {
    let done!: (v: IceServer[]) => void;
    world.turn = () => new Promise((r) => (done = r));
    await send(room, a, { type: "voice-join", muted: false });
    await send(room, a, { type: "voice-leave" });
    done(TURN);
    await flushPromises();
    expect(a.of("voice-ice")).toHaveLength(0);
  });
});
