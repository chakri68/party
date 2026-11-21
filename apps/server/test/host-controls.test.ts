import { GRACE_MS } from "@games/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { plainGame, toyGame, toyKnobs } from "./bot-toy.ts";
import { FakeConn, join, OWNER_KEY, roomOf, send, World } from "./harness.ts";

const games = { toy: toyGame, plain: plainGame };
const LOCKED = { code: "room-locked", message: "The host locked this room.", fatal: true };

describe("lock room", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;

  const tokenOf = (c: FakeConn) => c.last("welcome")!.resumeToken;
  const lock = (c: FakeConn, locked = true) => send(room, c, { type: "lock-room", locked });

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
  });

  it("a locked room refuses a new person, fatally", async () => {
    await lock(a);
    expect(roomOf(a).locked).toBe(true);
    const cy = await join(world, room, "Cy");
    expect(cy.last("error")).toMatchObject(LOCKED);
    expect(cy.closed).not.toBeNull();
    expect(roomOf(a).seats).toHaveLength(2);
  });

  it("only the host locks", async () => {
    await send(room, b, { type: "lock-room", locked: true });
    expect(b.last("error")).toMatchObject({ code: "not-host" });
    expect(roomOf(a).locked).toBe(false);
  });

  it("locking twice sends nothing the second time", async () => {
    await lock(a);
    const version = a.last("update")!.stateVersion;
    const updates = a.of("update").length;
    await lock(a);
    expect(a.last("update")!.stateVersion).toBe(version);
    expect(a.of("update")).toHaveLength(updates);
  });

  it("seats already in come back", async () => {
    await lock(a);
    const token = tokenOf(b);
    await world.disconnect(room, b);
    const b2 = await join(world, room, "Ben", token);
    expect(roomOf(b2).seats.find((s) => s.name === "Ben")!.presence).toBe("connected");
    expect(b2.last("error")).toBeUndefined();
  });

  it("the owner always gets in", async () => {
    await lock(a);
    const o = await join(world, room, "Olu", undefined, OWNER_KEY);
    expect(roomOf(o).seats.map((s) => s.name)).toContain("Olu");
  });

  it("a seat the lobby grace removed gets back in, once", async () => {
    await lock(a);
    const token = tokenOf(b);
    await world.disconnect(room, b);
    await world.tick(room, GRACE_MS);
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana"]);
    const b2 = await join(world, room, "Ben", token);
    expect(roomOf(b2).seats.map((s) => s.name)).toContain("Ben");
    await send(room, b2, { type: "leave" });
    const b3 = await join(world, room, "Ben", token);
    expect(b3.last("error")).toMatchObject(LOCKED);
  });

  it("a seat dropped at Start gets back in", async () => {
    const c = await join(world, room, "Cy");
    const token = tokenOf(c);
    await world.disconnect(room, c);
    await send(room, b, { type: "ready", ready: true });
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    expect(roomOf(a).seats.map((s) => s.name)).not.toContain("Cy");
    await send(room, a, { type: "return-to-lobby" });
    await lock(a);
    const c2 = await join(world, room, "Cy", token);
    expect(roomOf(c2).seats.map((s) => s.name)).toContain("Cy");
  });

  it("removed or left stays out", async () => {
    await lock(a);
    const bt = tokenOf(b);
    await send(room, a, { type: "remove-player", playerId: roomOf(a).seats[1]!.id });
    expect((await join(world, room, "Ben", bt)).last("error")).toMatchObject(LOCKED);
    const c = await join(world, room, "Cy", undefined, OWNER_KEY);
    const ct = tokenOf(c);
    await send(room, c, { type: "leave" });
    expect((await join(world, room, "Cy", ct)).last("error")).toMatchObject(LOCKED);
  });

  it("the lock comes before a computer gives up its seat", async () => {
    await send(room, a, { type: "remove-player", playerId: roomOf(a).seats[1]!.id });
    for (let i = 0; i < 3; i++) await send(room, a, { type: "add-bot" });
    expect(roomOf(a).seats).toHaveLength(4);
    await lock(a);
    const cy = await join(world, room, "Cy");
    expect(cy.last("error")).toMatchObject(LOCKED);
    expect(roomOf(a).seats.filter((s) => s.bot)).toHaveLength(3);
  });

  it("unlock lets people in", async () => {
    await lock(a);
    await lock(a, false);
    const cy = await join(world, room, "Cy");
    expect(roomOf(cy).seats.map((s) => s.name)).toContain("Cy");
  });

  it("the lock lasts through a game", async () => {
    await send(room, b, { type: "ready", ready: true });
    await lock(a);
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    await send(room, a, { type: "return-to-lobby" });
    expect(roomOf(a).locked).toBe(true);
  });

  it("an ended party ignores the lock", async () => {
    await lock(a);
    await send(room, a, { type: "end-party" });
    const cy = await join(world, room, "Cy");
    expect(roomOf(cy).seats.map((s) => s.name)).toContain("Cy");
  });

  it("lock-room is refused in an ended room", async () => {
    await send(room, a, { type: "end-party" });
    await lock(a);
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
  });

  it("the owner can never be removed", async () => {
    const o = await join(world, room, "Olu", undefined, OWNER_KEY);
    const id = roomOf(a).seats.find((s) => s.name === "Olu")!.id;
    expect(roomOf(a).hostId).not.toBe(id);
    await send(room, a, { type: "remove-player", playerId: id });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "You can't remove them." });
    expect(roomOf(a).seats.map((s) => s.name)).toContain("Olu");
    expect(o.closed).toBeNull();
  });
});
