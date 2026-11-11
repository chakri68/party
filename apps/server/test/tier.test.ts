import { dominionGame } from "@games/dominion/server";
import { sevensGame } from "@games/sevens/server";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { join, roomOf, send, World } from "./harness.ts";

const games = { sevens: sevensGame, dominion: dominionGame };

describe("room tiers", () => {
  let world: World;
  let room: RoomRuntime;

  beforeEach(() => {
    world = new World();
    world.tierLimits = { premiumGameIds: ["dominion"], freeMaxPlayers: 2 };
    room = world.runtime(games);
  });

  it("claim() with no grant behaves like today", async () => {
    await room.claim();
    const a = await join(world, room, "Asha");
    expect(roomOf(a).tier).toBe("pass");
    expect(roomOf(a).lockedGameIds).toEqual([]);
  });

  it("free room locks premium games", async () => {
    await room.claim({ tier: "free", hostKey: "hk" });
    const a = await join(world, room, "Asha");
    expect(roomOf(a).lockedGameIds).toEqual(["dominion"]);
    await send(room, a, { type: "select-game", gameId: "dominion" });
    const err = a.last("error")!;
    expect(err.code).toBe("needs-pass");
    expect(err.message).toBe("This game needs Host Pass.");
    expect(roomOf(a).gameId).toBe("sevens");
  });

  it("free room caps seats at freeMaxPlayers", async () => {
    await room.claim({ tier: "free", hostKey: "hk" });
    await join(world, room, "Asha");
    await join(world, room, "Ben");
    const c = await join(world, room, "Chitra");
    expect(c.last("error")).toMatchObject({ code: "room-full", fatal: true });
  });

  it("upgrade lifts lock and cap in place", async () => {
    await room.claim({ tier: "free", hostKey: "hk" });
    const a = await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await room.upgrade();
    expect(roomOf(a).tier).toBe("pass");
    expect(roomOf(b).lockedGameIds).toEqual([]);
    const c = await join(world, room, "Chitra");
    expect(c.last("error")).toBeUndefined();
    expect(roomOf(c).seats).toHaveLength(3);
    await send(room, a, { type: "select-game", gameId: "dominion" });
    expect(roomOf(a).gameId).toBe("dominion");
  });

  it("tier never goes down", async () => {
    await room.claim({ tier: "free", hostKey: "hk" });
    await room.upgrade();
    await room.upgrade();
    const again = world.runtime(games);
    await again.load();
    const a = await join(world, again, "Asha");
    expect(roomOf(a).tier).toBe("pass");
  });

  it("host key seats the owner", async () => {
    world.ownerRequired = true;
    await room.claim({ tier: "pass", hostKey: "hk" });
    const a = await join(world, room, "Asha", undefined, "hk");
    expect(roomOf(a).canStart).toBe(true);
    const room2 = new RoomRuntime("K7DY", world.host(), games, "sevens");
    await room2.claim({ tier: "pass", hostKey: "hk" });
    const b = await join(world, room2, "Ben", undefined, "wrong");
    expect(roomOf(b).canStart).toBe(false);
  });

  it("rooms stored before tiers default to pass", async () => {
    await room.claim();
    const stored = structuredClone(world.store.get("room")) as Record<string, unknown>;
    delete stored.tier;
    delete stored.hostKey;
    world.store.set("room", stored);
    const again = world.runtime(games);
    await again.load();
    const a = await join(world, again, "Asha");
    expect(roomOf(a).tier).toBe("pass");
  });

  it("filterText masks names and chat", async () => {
    world.filterText = (s) => s.replace(/darn/gi, "****");
    room = world.runtime(games);
    await room.claim({ tier: "pass", hostKey: "hk" });
    const a = await join(world, room, "darn it");
    expect(roomOf(a).seats[0]!.name).toBe("**** it");
    await send(room, a, { type: "chat", text: "oh darn" });
    expect(a.last("chat")).toMatchObject({ messages: [{ text: "oh ****" }] });
  });
});
