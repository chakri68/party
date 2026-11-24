import { PROTOCOL_VERSION, ROOM_SOUND_LIMIT, SOUND_COOLDOWN_MS } from "@games/protocol";
import { FREE_SOUND_IDS } from "@games/sounds/list";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { onBoard } from "../src/sounds.ts";
import { plainGame, toyGame, toyKnobs } from "./bot-toy.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

const games = { toy: toyGame, plain: plainGame };
const FREE = [...FREE_SOUND_IDS][0]!;

describe("onBoard", () => {
  it("takes free ids on the list and extra packs by name", () => {
    expect(onBoard(`free:${FREE}`, [], false)).toBe(true);
    expect(onBoard("free:nope", [], false)).toBe(false);
    expect(onBoard("memes:bruh", [], false)).toBe(false);
    expect(onBoard("memes:bruh", ["memes"], false)).toBe(true);
    expect(onBoard("host:1", ["host"], false)).toBe(false);
    expect(onBoard(`free:${FREE}`, ["free"], false)).toBe(true);
  });

  it("onBoard host ids", () => {
    expect(onBoard("host:1", [], true)).toBe(true);
    expect(onBoard("host:6", [], true)).toBe(true);
    expect(onBoard("host:7", [], true)).toBe(false);
    expect(onBoard("host:0", [], true)).toBe(false);
    expect(onBoard("host:a", [], true)).toBe(false);
    expect(onBoard("host:1", [], false)).toBe(false);
    expect(onBoard("host:1", ["host"], false)).toBe(false);
  });
});

describe("sound board", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  let c: FakeConn;
  const idOf = (cn: FakeConn) => cn.last("welcome")!.playerId;
  const sound = (cn: FakeConn, id = `free:${FREE}`) => send(room, cn, { type: "sound", id });
  const heard = (...cs: FakeConn[]) => cs.reduce((n, cn) => n + cn.of("sound").length, 0);

  async function build() {
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
    c = await join(world, room, "Cal");
  }

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    await build();
  });

  it("relays to every seated connection, the sender too", async () => {
    const lurker = await world.connect(room);
    await send(room, lurker, { type: "hello", protocolVersion: PROTOCOL_VERSION });
    await sound(a);
    const want = { type: "sound", id: `free:${FREE}`, by: idOf(a) };
    expect(a.last("sound")).toEqual(want);
    expect(b.last("sound")).toEqual(want);
    expect(c.last("sound")).toEqual(want);
    expect(lurker.of("sound")).toEqual([]);
  });

  it("is not room state", async () => {
    const v = a.last("update")!.stateVersion;
    const n = a.of("update").length + b.of("update").length;
    const puts = world.puts;
    await sound(a);
    expect(heard(a)).toBe(1);
    expect(a.last("update")!.stateVersion).toBe(v);
    expect(a.of("update").length + b.of("update").length).toBe(n);
    expect(world.puts).toBe(puts);
  });

  it("drops an id not on the board", async () => {
    await sound(a, "free:nope");
    await sound(b, "memes:bruh");
    expect(heard(a, b, c)).toBe(0);

    world = new World();
    world.soundPacks = ["memes"];
    await build();
    await sound(a, "memes:bruh");
    expect(b.last("sound")).toEqual({ type: "sound", id: "memes:bruh", by: idOf(a) });
  });

  it("one sound per seat every 3 seconds", async () => {
    const errors = a.of("error").length;
    await sound(a);
    await sound(a);
    expect(heard(b)).toBe(1);
    await world.tick(room, SOUND_COOLDOWN_MS - 1);
    await sound(a);
    expect(heard(b)).toBe(1);
    await world.tick(room, 1);
    await sound(a);
    expect(heard(b)).toBe(2);
    expect(a.of("error").length).toBe(errors);
  });

  it("at most 3 in the room inside 3 seconds", async () => {
    const d = await join(world, room, "Dev");
    for (const cn of [a, b, c, d]) await sound(cn);
    expect(heard(d)).toBe(3);
    expect(d.of("sound").map((m) => m.by)).toEqual([idOf(a), idOf(b), idOf(c)]);
    await world.tick(room, ROOM_SOUND_LIMIT.windowMs);
    await sound(d);
    expect(heard(d)).toBe(4);
    expect(d.last("sound")!.by).toBe(idOf(d));
  });

  it("checks the seat before the room, so a room drop still uses the seat's turn", async () => {
    const d = await join(world, room, "Dev");
    await sound(a);
    await sound(b);
    await world.tick(room, 1000);
    await sound(c);
    await sound(d);
    expect(heard(d)).toBe(3);
    await world.tick(room, 2000);
    await sound(d);
    expect(heard(d)).toBe(3);
    await world.tick(room, 1000);
    await sound(d);
    expect(heard(d)).toBe(4);
    expect(d.last("sound")!.by).toBe(idOf(d));
  });

  it("a reconnect does not reset the cooldown", async () => {
    const token = a.last("welcome")!.resumeToken;
    await sound(a);
    await world.disconnect(room, a);
    const back = await join(world, room, "Ana", token);
    expect(idOf(back)).toBe(idOf(a));
    await world.tick(room, 1000);
    await sound(back);
    expect(heard(b)).toBe(1);
  });

  it("sounds off", async () => {
    await send(room, b, { type: "room-sounds", on: false });
    expect(b.last("error")).toMatchObject({ code: "not-host" });
    expect(roomOf(c).sounds).toBe(true);

    const n = c.of("update").length;
    await send(room, a, { type: "room-sounds", on: false });
    expect(c.of("update").length).toBe(n + 1);
    expect(roomOf(b).sounds).toBe(false);

    await sound(b);
    expect(heard(a, b, c)).toBe(0);

    await send(room, a, { type: "room-sounds", on: false });
    expect(c.of("update").length).toBe(n + 1);

    await send(room, a, { type: "room-sounds", on: true });
    expect(roomOf(c).sounds).toBe(true);
    await sound(b);
    expect(heard(c)).toBe(1);
  });

  it("a new host can turn sounds back on", async () => {
    await send(room, a, { type: "room-sounds", on: false });
    await send(room, a, { type: "transfer-host", playerId: idOf(b) });
    await send(room, b, { type: "room-sounds", on: true });
    expect(roomOf(c).sounds).toBe(true);
  });

  it("starts on", () => {
    expect(roomOf(a).sounds).toBe(true);
  });

  it("works in a game", async () => {
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    await sound(b);
    expect(heard(a)).toBe(1);
  });

  it("an ended room drops sounds and refuses the switch", async () => {
    await send(room, a, { type: "end-party" });
    expect(roomOf(a).phase).toBe("ended");
    await sound(a);
    expect(heard(a, b, c)).toBe(0);
    await send(room, a, { type: "room-sounds", on: false });
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
  });
});

describe("host sounds", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  const idOf = (cn: FakeConn) => cn.last("welcome")!.playerId;
  const sound = (cn: FakeConn, id: string) => send(room, cn, { type: "sound", id });
  const heard = (...cs: FakeConn[]) => cs.reduce((n, cn) => n + cn.of("sound").length, 0);

  async function build(library: string | null) {
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    if (library === null) await room.claim();
    else await room.claim({ tier: "pass", hostKey: null, library });
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
  }

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    await build("lib-secret-1");
  });

  it("relays host slots in a room with a library", async () => {
    await sound(a, "host:3");
    const want = { type: "sound", id: "host:3", by: idOf(a) };
    expect(a.last("sound")).toEqual(want);
    expect(b.last("sound")).toEqual(want);
    await world.tick(room, SOUND_COOLDOWN_MS);
    await sound(b, "host:7");
    expect(heard(a, b)).toBe(2);
  });

  it("a room without a library drops host ids", async () => {
    await build(null);
    await sound(a, "host:1");
    expect(heard(a, b)).toBe(0);
    expect(roomOf(a).hostSounds).toBe(false);
  });

  it("hostSounds is in the state, the library id is not", async () => {
    await sound(a, "host:2");
    await send(room, a, { type: "chat", text: "hi" });
    expect(roomOf(a).hostSounds).toBe(true);
    for (const cn of [a, b]) {
      expect(cn.inbox.length).toBeGreaterThan(0);
      for (const m of cn.inbox) expect(JSON.stringify(m)).not.toContain("lib-secret-1");
    }
  });

  it("library() is a plain read", async () => {
    const pending = sound(a, "host:1");
    const lib = room.library();
    expect(lib).toBe("lib-secret-1");
    await pending;
  });

  it("host sounds share the cooldown and the room cap", async () => {
    await sound(a, `free:${FREE}`);
    await world.tick(room, 1000);
    await sound(a, "host:1");
    expect(heard(b)).toBe(1);
    expect(b.last("sound")!.id).toBe(`free:${FREE}`);

    await world.tick(room, SOUND_COOLDOWN_MS);
    const c = await join(world, room, "Cal");
    const d = await join(world, room, "Dev");
    for (const cn of [a, b, c]) await sound(cn, "host:4");
    await sound(d, "host:5");
    expect(heard(d)).toBe(3);
  });
});
