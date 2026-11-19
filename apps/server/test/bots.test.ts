import { NUDGE_AFTER_MS } from "@games/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { CLEANUP_AFTER_MS, RoomRuntime } from "../src/runtime.ts";
import { plainGame, toyGame, toyKnobs, type ToyPublic } from "./bot-toy.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

const games = { toy: toyGame, plain: plainGame };
const bots = (c: FakeConn) => roomOf(c).seats.filter((s) => s.bot);
const stored = (world: World) => world.store.get("room") as { hostId: string | null; timers: Record<string, number> };

describe("computer seats", () => {
  let world: World;
  let room: RoomRuntime;

  async function setUp(grant?: Parameters<RoomRuntime["claim"]>[0]) {
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim(grant);
  }

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    await setUp();
  });

  it("host adds a computer in the lobby", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    const [bot] = bots(a);
    expect(bot).toMatchObject({ bot: true, name: "Asha", ready: true, presence: "connected", avatarSeed: "bot-Asha" });
    expect(bot!.id).toMatch(/^bot-.{8}$/);
    expect(roomOf(a).botGameIds).toContain("toy");
    expect(roomOf(a).botGameIds).not.toContain("plain");
    // Seat secrets stay off the wire for bots too.
    expect(JSON.stringify(roomOf(a).seats)).not.toContain("resumeToken");
  });

  it("only the host, only in lobby or results, only for bot games", async () => {
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    await send(room, b, { type: "add-bot" });
    expect(b.last("error")).toMatchObject({ code: "not-host", fatal: false });
    await send(room, b, { type: "remove-bots" });
    expect(b.last("error")).toMatchObject({ code: "not-host", fatal: false });

    await send(room, a, { type: "select-game", gameId: "plain" });
    await send(room, a, { type: "add-bot" });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "This game can't have computers.", fatal: false });
    expect(bots(a)).toHaveLength(0);

    await send(room, a, { type: "select-game", gameId: "toy" });
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    await send(room, a, { type: "add-bot" });
    expect(a.last("error")).toMatchObject({ code: "wrong-phase", fatal: false });
    await send(room, a, { type: "remove-bots" });
    expect(a.last("error")).toMatchObject({ code: "wrong-phase", fatal: false });
  });

  it("names skip ones already seated", async () => {
    const a = await join(world, room, "asha");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "add-bot" });
    expect(bots(a).map((s) => s.name)).toEqual(["Ravi", "Meera"]);
  });

  it("stops at the table's max", async () => {
    const a = await join(world, room, "Ana");
    for (let i = 0; i < 3; i++) await send(room, a, { type: "add-bot" });
    expect(roomOf(a).seats).toHaveLength(4);
    await send(room, a, { type: "add-bot" });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "The table is full.", fatal: false });
    expect(a.closed).toBeNull();
    expect(roomOf(a).seats).toHaveLength(4);
  });

  it("a person joining a full lobby bumps the newest bot", async () => {
    const a = await join(world, room, "Ana");
    for (let i = 0; i < 3; i++) {
      world.clock += 10;
      await send(room, a, { type: "add-bot" });
    }
    const b = await join(world, room, "Ben");
    expect(b.closed).toBeNull();
    expect(b.last("welcome")).toBeDefined();
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana", "Asha", "Ravi", "Ben"]);
  });

  it("a full table of people still turns the next person away", async () => {
    const people = [];
    for (const name of ["Ana", "Ben", "Cid", "Dev"]) people.push(await join(world, room, name));
    const e = await join(world, room, "Eve");
    expect(e.last("error")).toMatchObject({ code: "room-full", fatal: true });
  });

  it("free room: bots stop at the free cap, and a person still gets in", async () => {
    world = new World();
    world.tierLimits = { premiumGameIds: [], freeMaxPlayers: 3 };
    await setUp({ tier: "free", hostKey: null });
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "add-bot" });
    expect(roomOf(a).seats).toHaveLength(3);
    await send(room, a, { type: "add-bot" });
    expect(a.last("error")).toMatchObject({ code: "not-available", fatal: false });
    expect(roomOf(a).seats).toHaveLength(3);

    const b = await join(world, room, "Ben");
    expect(b.closed).toBeNull();
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana", "Asha", "Ben"]);
  });

  it("remove-bots takes every computer out; remove-player takes one", async () => {
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "add-bot" });
    const [first] = bots(a);
    await send(room, a, { type: "remove-player", playerId: first!.id });
    expect(bots(a).map((s) => s.name)).toEqual(["Ravi"]);
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "remove-bots" });
    expect(bots(a)).toHaveLength(0);
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana", "Ben"]);
    expect(b.closed).toBeNull();
  });

  it("a bot is never host", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "leave" });
    await room.onClose(a);
    expect(stored(world).hostId).toBeNull();
    expect(stored(world).timers.cleanup).toBe(world.clock + CLEANUP_AFTER_MS);

    // The next person in takes the host role, and finds the computers still seated.
    const b = await join(world, room, "Ben");
    expect(roomOf(b).hostId).toBe(b.last("welcome")!.playerId);
    expect(bots(b)).toHaveLength(2);
  });

  it("host migration skips bots", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    world.clock += 10;
    const b = await join(world, room, "Ben");
    await send(room, a, { type: "leave" });
    expect(roomOf(b).hostId).toBe(b.last("welcome")!.playerId);
  });

  it("picking a game without bots is refused while computers sit", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "select-game", gameId: "plain" });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "Remove computers to play this", fatal: false });
    expect(roomOf(a).gameId).toBe("toy");

    await send(room, a, { type: "remove-bots" });
    await send(room, a, { type: "select-game", gameId: "plain" });
    expect(roomOf(a).gameId).toBe("plain");
  });

  it("starting a game without bots is refused while computers sit", async () => {
    // A room stored with computers at a game that can't have them.
    world.store.set("room", {
      ...structuredClone(world.store.get("room") as object),
      gameId: "plain",
      seats: [
        { id: "bot-aaaaaaaa", name: "Asha", avatarSeed: "bot-Asha", resumeToken: "", ready: true, presence: "connected", joinedAt: 0, owner: false, bot: true },
      ],
    });
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "start-game" });
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "Remove computers to play this" });
    expect(roomOf(a).phase).toBe("lobby");
  });

  it("starts a game with one person and a computer", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    expect(roomOf(a).seats).toHaveLength(2);
  });

  it("nudges never target a bot", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    await send(room, a, { type: "start-game" });
    const ana = a.last("welcome")!.playerId;
    if ((roomOf(a).game as ToyPublic).turnId === ana) {
      await send(room, a, { type: "game-action", clientActionId: "x", action: { type: "add", n: 1 } });
    }
    expect(roomOf(a).awaitingPlayerIds).toEqual([bots(a)[0]!.id]);
    world.clock += NUDGE_AFTER_MS;
    await send(room, a, { type: "nudge" });
    expect(a.last("error")).toMatchObject({ code: "too-early" });
  });

  it("a reload leaves bots seated and connected, with no grace timer", async () => {
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    const botId = bots(a)[0]!.id;
    const room2 = new RoomRuntime("K7DX", world.host(), games, "toy");
    world.conns = [];
    await room2.load();
    const data = world.store.get("room") as { seats: { id: string; presence: string }[]; timers: Record<string, number> };
    expect(data.seats.find((s) => s.id === botId)!.presence).toBe("connected");
    expect(Object.keys(data.timers)).not.toContain(`grace:${botId}`);
  });

  it("a room stored before bots loads and plays", async () => {
    world = new World();
    world.store.set("room", {
      code: "K7DX",
      createdAt: world.clock,
      phase: "lobby",
      stateVersion: 3,
      hostId: null,
      seats: [],
      gameId: "toy",
      settings: {},
      match: { roundNumber: 0, nextDealerSeat: 0 },
      game: null,
      awaiting: [],
      awaitingSince: null,
      lastNudgeAt: 0,
      timers: {},
    });
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    const a = await join(world, room, "Ana");
    await join(world, room, "Ben");
    expect(roomOf(a).botGameIds).toEqual(["toy"]);
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
  });
});
