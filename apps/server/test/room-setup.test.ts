import { cheatGame } from "@games/cheat/server";
import { scribblGame } from "@games/scribbl/server";
import { sevensGame } from "@games/sevens/server";
import { beforeEach, describe, expect, it } from "vitest";
import { CLEANUP_AFTER_MS, type RoomGrant, type RoomSetup } from "../src/runtime.ts";
import { join, roomOf, send, World } from "./harness.ts";

const games = { sevens: sevensGame, cheat: cheatGame, scribbl: scribblGame };
type Stored = { gameId: string; seats: { bot?: boolean }[]; timers: Record<string, number>; settings: unknown };

describe("room setup at claim", () => {
  let world: World;
  beforeEach(() => {
    world = new World();
  });

  async function make(setup?: RoomSetup, grant?: RoomGrant) {
    const room = world.runtime(games);
    const claimed = await room.claim(grant, setup);
    return Object.assign(room, { claimed });
  }
  const stored = () => world.store.get("room") as Stored;
  const botCount = () => stored().seats.filter((s) => s.bot).length;

  it("seats the default count and uses the game's defaults", async () => {
    await make({ gameId: "cheat" });
    expect(stored().gameId).toBe("cheat");
    expect(botCount()).toBe(3);
    expect(stored().settings).toEqual(cheatGame.defaultSettings);
  });

  it("seats computers exactly like add-bot", async () => {
    const room = await make({ gameId: "cheat", computers: 2 });
    const a = await join(world, room, "Ana");
    await send(room, a, { type: "add-bot" });
    const bots = roomOf(a).seats.filter((s) => s.bot);
    expect(bots.map((s) => s.name)).toEqual(["Asha", "Ravi", "Meera"]);
    for (const b of bots) expect(b).toMatchObject({ ready: true, presence: "connected", bot: true, avatarSeed: "bot-" + b.name });
    expect(new Set(bots.map((b) => b.id)).size).toBe(3);
    expect(bots[0]!.id).toMatch(/^bot-.{8}$/);
  });

  it("uses the asked count, clamped to 1..max-1", async () => {
    await make({ gameId: "cheat", computers: 2 });
    expect(botCount()).toBe(2);
    for (const [n, want] of [[99, 9], [0, 1], [-3, 1]] as const) {
      world = new World();
      await make({ gameId: "cheat", computers: n });
      expect(botCount()).toBe(want);
    }
  });

  it("never passes the free seat cap", async () => {
    world.tierLimits = { premiumGameIds: [], freeMaxPlayers: 8 };
    await make({ gameId: "cheat", computers: 99 }, { tier: "free", hostKey: "hk" });
    expect(botCount()).toBe(7);
  });

  it("falls back to the default for a count that is not a whole number", async () => {
    for (const n of [NaN, Infinity, 2.5]) {
      world = new World();
      await make({ gameId: "cheat", computers: n });
      expect(botCount(), String(n)).toBe(3);
    }
  });

  it("makes the default empty room for an unknown game, a game without computers, or a locked game", async () => {
    const cases: [RoomSetup, RoomGrant | undefined][] = [
      [{ gameId: "nope", computers: 2 }, undefined],
      [{ gameId: "scribbl", computers: 2 }, undefined],
      [{ gameId: "cheat", computers: 2 }, { tier: "free", hostKey: "hk" }],
    ];
    for (const [setup, grant] of cases) {
      world = new World();
      world.tierLimits = { premiumGameIds: ["cheat"], freeMaxPlayers: 8 };
      expect((await make(setup, grant)).claimed).toBe(true);
      expect(stored().gameId).toBe("sevens");
      expect(stored().seats).toEqual([]);
    }
  });

  it("a locked game is fine for a pass room", async () => {
    world.tierLimits = { premiumGameIds: ["cheat"], freeMaxPlayers: 8 };
    await make({ gameId: "cheat" }, { tier: "pass", hostKey: "hk" });
    expect(stored().gameId).toBe("cheat");
    expect(botCount()).toBe(3);
  });

  it("the first person to join is host and owner, and computers keep their seats", async () => {
    world.ownerRequired = true;
    const room = await make({ gameId: "cheat", computers: 3 }, { tier: "pass", hostKey: "hk" });
    const a = await join(world, room, "Ana", undefined, "hk");
    const r = roomOf(a);
    expect(r.canStart).toBe(true);
    expect(r.seats).toHaveLength(4);
    expect(r.seats.filter((s) => s.bot)).toHaveLength(3);
    expect(r.hostId).toBe(r.seats.find((s) => !s.bot)!.id);
    expect((world.store.get("room") as { seats: { bot?: boolean; owner: boolean }[] }).seats.find((s) => !s.bot)!.owner).toBe(true);
  });

  it("a person joining a full 4-seat table bumps only one computer", async () => {
    world.tierLimits = { premiumGameIds: [], freeMaxPlayers: 4 };
    const room = await make({ gameId: "cheat", computers: 3 }, { tier: "free", hostKey: "hk" });
    expect(botCount()).toBe(3);
    const a = await join(world, room, "Ana");
    expect(roomOf(a).seats.filter((s) => s.bot)).toHaveLength(3);
    const b = await join(world, room, "Ben");
    expect(roomOf(b).seats).toHaveLength(4);
    expect(roomOf(b).seats.filter((s) => s.bot)).toHaveLength(2);
  });

  it("still cleans the room up when the time comes, with computers seated", async () => {
    const room = await make({ gameId: "cheat" });
    expect(stored().timers.cleanup).toBe(world.clock + CLEANUP_AFTER_MS);
    expect(world.alarm).toBe(world.clock + CLEANUP_AFTER_MS);
    await world.tick(room, CLEANUP_AFTER_MS);
    expect(world.store.size).toBe(0);
  });
});
