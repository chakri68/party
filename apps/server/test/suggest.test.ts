import { dominionGame } from "@games/dominion/server";
import { parseClientMessage } from "@games/protocol";
import { sevensGame } from "@games/sevens/server";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { join, roomOf, send, World } from "./harness.ts";

const games = { sevens: sevensGame, dominion: dominionGame };

describe("game suggestions", () => {
  let world: World;
  let room: RoomRuntime;

  beforeEach(async () => {
    world = new World();
    room = world.runtime(games);
    await room.claim();
  });

  const suggestionOf = (c: Parameters<typeof roomOf>[0], name: string) =>
    roomOf(c).seats.find((s) => s.name === name)?.suggestion;

  it("a non-host suggests, moves, and takes back their pick", async () => {
    const a = await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "suggest-game", gameId: "dominion" });
    expect(b.last("error")).toBeUndefined();
    expect(suggestionOf(a, "Ben")).toBe("dominion");
    // The host's own game doesn't change.
    expect(roomOf(a).gameId).toBe("sevens");

    await send(room, b, { type: "suggest-game", gameId: "sevens" });
    expect(suggestionOf(a, "Ben")).toBe("sevens");

    await send(room, b, { type: "suggest-game", gameId: null });
    expect(suggestionOf(a, "Ben")).toBeUndefined();
  });

  it("refuses an unknown game", async () => {
    await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "suggest-game", gameId: "chess" });
    expect(b.last("error")?.code).toBe("unknown-game");
    expect(suggestionOf(b, "Ben")).toBeUndefined();
  });

  it("clears on start and is refused mid-game", async () => {
    const a = await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "suggest-game", gameId: "dominion" });
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    expect(suggestionOf(a, "Ben")).toBeUndefined();

    await send(room, b, { type: "suggest-game", gameId: "dominion" });
    expect(b.last("error")?.code).toBe("wrong-phase");
  });

  it("goes away with the player who made it", async () => {
    const a = await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "suggest-game", gameId: "dominion" });
    await send(room, b, { type: "leave" });
    expect(roomOf(a).seats.some((s) => s.suggestion)).toBe(false);
  });

  it("a locked game can still be suggested in a free room", async () => {
    world.tierLimits = { premiumGameIds: ["dominion"], freeMaxPlayers: 8 };
    room = world.runtime(games);
    await room.claim({ tier: "free", hostKey: "hk" });
    const a = await join(world, room, "Asha");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "suggest-game", gameId: "dominion" });
    expect(suggestionOf(a, "Ben")).toBe("dominion");
  });
});

describe("maxSeats", () => {
  it("is the game's max in a pass room and the free cap in a free room", async () => {
    const world = new World();
    world.tierLimits = { premiumGameIds: ["dominion"], freeMaxPlayers: 2 };
    let room = world.runtime(games);
    await room.claim();
    const a = await join(world, room, "Asha");
    expect(roomOf(a).maxSeats).toBe(sevensGame.manifest.maxPlayers);

    room = world.runtime(games);
    await room.claim({ tier: "free", hostKey: "hk" });
    const b = await join(world, room, "Ben");
    expect(roomOf(b).maxSeats).toBe(2);
    await room.upgrade();
    expect(roomOf(b).maxSeats).toBe(sevensGame.manifest.maxPlayers);
  });
});

describe("parseClientMessage suggest-game", () => {
  it("takes a game id or null, nothing else", () => {
    expect(parseClientMessage(JSON.stringify({ type: "suggest-game", gameId: "sevens" }))).toEqual({ type: "suggest-game", gameId: "sevens" });
    expect(parseClientMessage(JSON.stringify({ type: "suggest-game", gameId: null }))).toEqual({ type: "suggest-game", gameId: null });
    expect(parseClientMessage(JSON.stringify({ type: "suggest-game", gameId: 3 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "suggest-game" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "suggest-game", gameId: "x".repeat(65) }))).toBeNull();
  });
});
