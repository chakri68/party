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
    expect(onBoard(`free:${FREE}`, [])).toBe(true);
    expect(onBoard("free:nope", [])).toBe(false);
    expect(onBoard("memes:bruh", [])).toBe(false);
    expect(onBoard("memes:bruh", ["memes"])).toBe(true);
    expect(onBoard("host:1", ["host"])).toBe(false);
    expect(onBoard(`free:${FREE}`, ["free"])).toBe(true);
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
