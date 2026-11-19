import type { AnyGameDefinition, PartyLog } from "@games/game-core";
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

describe("bots in a game", () => {
  const STUCK = "A computer player got stuck, so the game ended.";
  /** One bot that never gives up the turn: its skip leaves it awaited. */
  const hogGame = {
    ...toyGame,
    skipTurn: (st: { phase: string }, pid: string) => ({
      state: st,
      events: [{ visibility: { kind: "public" as const }, event: { type: "skipped", playerId: pid } }],
    }),
  } as AnyGameDefinition;
  /** Room for six computers. */
  const bigGame = { ...toyGame, manifest: { ...toyGame.manifest, maxPlayers: 8 } } as AnyGameDefinition;

  let world: World;
  let room: RoomRuntime;
  let people: FakeConn[];

  const pub = (c: FakeConn) => roomOf(c).game as ToyPublic;
  const idOf = (c: FakeConn) => c.last("welcome")!.playerId;
  const data = () =>
    world.store.get("room") as {
      phase: string;
      hostId: string | null;
      timers: Record<string, number>;
      seats: { id: string; presence: string; ready: boolean; bot?: true }[];
      party?: PartyLog;
    };
  const botTimers = () => Object.entries(data().timers).filter(([k]) => k.startsWith("bot:"));
  const events = (c: FakeConn) => c.of("update").flatMap((u) => u.events as { type: string; playerId?: string }[]);

  async function setUp(game: AnyGameDefinition = toyGame) {
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), { toy: game }, "toy");
    await room.load();
    await room.claim();
  }

  async function table(names: string[], botCount: number) {
    people = [];
    for (const n of names) people.push(await join(world, room, n));
    for (let i = 0; i < botCount; i++) await send(room, people[0]!, { type: "add-bot" });
    await send(room, people[0]!, { type: "start-game" });
    expect(roomOf(people[0]!).phase).toBe("playing");
    return people[0]!;
  }

  /** Whoever's turn it is, if a person: they add 1. */
  async function peopleMove() {
    const a = people[0]!;
    if (roomOf(a).phase !== "playing") return;
    const p = people.find((c) => idOf(c) === pub(a).turnId);
    if (p) await send(room, p, { type: "game-action", clientActionId: "x", action: { type: "add", n: 1 } });
  }

  async function playUntil(done: () => boolean, max = 300) {
    for (let i = 0; i < max && !done(); i++) {
      await peopleMove();
      if (done()) break;
      await world.tick(room, 3000);
    }
    expect(done()).toBe(true);
  }

  /** Gets to a bot's turn with its timer pending. */
  async function toBotTurn() {
    const a = people[0]!;
    await playUntil(() => roomOf(a).phase === "playing" && bots(a).some((b) => b.id === pub(a).turnId));
    expect(botTimers().map(([k]) => k)).toContain(`bot:${pub(a).turnId}`);
  }

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    await setUp();
  });

  it("bots take their turns after a short think", async () => {
    const a = await table(["Ana"], 3);
    await toBotTurn();
    const before = a.of("update").length;
    const total = pub(a).total;
    await world.tick(room, 1599);
    expect(a.of("update").length).toBe(before);
    await world.tick(room, 1001);
    expect(pub(a).total).toBeGreaterThan(total);

    await playUntil(() => roomOf(a).phase === "results");
    expect(roomOf(a).result!.winnerIds).toHaveLength(1);
  });

  it("a person's move goes out before any bot moves", async () => {
    const a = await table(["Ana"], 1);
    await playUntil(() => pub(a).turnId === idOf(a));
    const total = pub(a).total;
    await send(room, a, { type: "game-action", clientActionId: "x", action: { type: "add", n: 1 } });
    const update = a.last("update")!;
    expect(update.events).toEqual([{ type: "moved", total: total + 1 }]);
    expect(pub(a).total).toBe(total + 1);
    expect(roomOf(a).awaitingPlayerIds).toEqual([bots(a)[0]!.id]);
    // The bot's move waits on its own timer.
    expect(botTimers()).toHaveLength(1);
    expect(botTimers()[0]![1]).toBeGreaterThan(world.clock);
  });

  it("bots take optional moves, and bots due together share one commit", async () => {
    const a = await table(["Ana"], 2);
    await playUntil(() => pub(a).phase === "window");
    expect(roomOf(a).awaitingPlayerIds).toEqual([]);
    expect(botTimers()).toHaveLength(2);
    const before = a.of("update").length;
    await world.tick(room, 2600);
    expect(a.of("update").length).toBe(before + 1);
    expect(pub(a).phase).toBe("window");
    expect(pub(a).callers.sort()).toEqual(bots(a).map((b) => b.id).sort());
  });

  for (const [knob, reason] of [["null", "returns nothing"], ["throw", "throws"], ["illegal", "breaks a rule"]] as const) {
    it(`a bot that ${reason} on its turn: skip first, then back to the lobby`, async () => {
      toyKnobs.decide = knob;
      const a = await table(["Ana", "Ben"], 2);
      const [b1, b2] = bots(a);
      await toBotTurn();
      const stuck = pub(a).turnId!;
      // A throw in the alarm must not reach the rollback and rethrow.
      world.clock += 3000;
      await expect(room.onAlarm()).resolves.toBeUndefined();
      expect(events(a)).toContainEqual({ type: "skipped", playerId: stuck });
      expect(roomOf(a).phase).toBe("playing");
      // b1 sits before b2: if b1 was skipped, b2 is next and stuck too.
      if (stuck === b2!.id) await playUntil(() => pub(a).turnId === b1!.id);
      await playUntil(() => roomOf(a).phase === "lobby");

      for (const c of people) {
        expect(c.last("error")).toEqual({ type: "error", code: "game-ended", message: STUCK, fatal: false });
        expect(c.closed).toBeNull();
      }
      expect(roomOf(a).game).toBeNull();
      expect(botTimers()).toEqual([]);
      expect(Object.keys(data().timers).some((k) => k.startsWith("game:"))).toBe(false);
      expect(data().party?.games ?? []).toHaveLength(0);
      expect(bots(a).every((s) => s.ready)).toBe(true);
      if (knob === "throw") expect(world.errors).toContainEqual(new Error("toy bot broke"));
      else expect(world.errors.length).toBeGreaterThan(0);
    });
  }

  it("a bot stuck off its turn ends the game at once, with no skip", async () => {
    const skipped: string[] = [];
    await setUp({
      ...toyGame,
      skipTurn: (st: unknown, pid: string, ctx: never) => {
        skipped.push(pid);
        return toyGame.skipTurn!(st, pid, ctx);
      },
    } as AnyGameDefinition);
    toyKnobs.decide = "bad-call";
    const a = await table(["Ana"], 1);
    await playUntil(() => pub(a).phase === "window");
    expect(roomOf(a).awaitingPlayerIds).toEqual([]);
    await world.tick(room, 2600);
    expect(roomOf(a).phase).toBe("lobby");
    expect(a.last("error")).toEqual({ type: "error", code: "game-ended", message: STUCK, fatal: false });
    expect(skipped).toEqual([]);
    expect(events(a).some((e) => e.type === "skipped")).toBe(false);
    expect(data().party?.games ?? []).toHaveLength(0);
  });

  it("a timer cleared or re-set by an earlier timer in the same alarm doesn't fire", async () => {
    // Every move re-sets a "clock" game timer, due just after the bot's think time.
    const fired: number[] = [];
    await setUp({
      ...toyGame,
      handleAction: (st: unknown, pid: string, action: unknown, ctx: never) => {
        const res = toyGame.handleAction(st, pid, action, ctx);
        if (!res.ok) return res;
        const timers = [...(res.transition.timers ?? []), { kind: "set" as const, timerId: "clock", delayMs: 3000 }];
        return { ok: true, transition: { ...res.transition, timers } };
      },
      onTimer: (st: unknown, timerId: string, ctx: never) => {
        if (timerId !== "clock") return toyGame.onTimer!(st, timerId, ctx);
        fired.push(world.clock);
        return { state: st, events: [] };
      },
    } as AnyGameDefinition);
    const a = await table(["Ana"], 1);
    await playUntil(() => roomOf(a).phase === "playing" && pub(a).turnId === idOf(a));
    await send(room, a, { type: "game-action", clientActionId: "x", action: { type: "add", n: 1 } });
    const clockAt = data().timers["game:clock"]!;
    expect(botTimers()[0]![1]).toBeLessThan(clockAt);
    fired.length = 0;
    const version = (data() as unknown as { stateVersion: number }).stateVersion;

    // Both are due: the bot moves first, which re-sets the clock.
    await world.tick(room, 3000);
    expect((data() as unknown as { stateVersion: number }).stateVersion).toBe(version + 1);
    expect(fired).toEqual([]);
    expect(data().timers["game:clock"]).toBe(world.clock + 3000);
  });

  it("the in-a-row cap: a bot that keeps the turn is skipped, then the game ends", async () => {
    await setUp(hogGame);
    toyKnobs.decide = "hog";
    const a = await table(["Ana"], 1);
    await toBotTurn();
    const moved = events(a).filter((e) => e.type === "moved").length;
    await playUntil(() => roomOf(a).phase === "lobby", 100);
    const after = events(a);
    expect(after.filter((e) => e.type === "skipped")).toHaveLength(1);
    // 51 moves trip the cap and the skip; the next one, still in a row, ends it.
    expect(after.filter((e) => e.type === "moved").length - moved).toBe(52);
    expect(a.last("error")).toMatchObject({ code: "game-ended", message: STUCK });
  });

  it("a bot that keeps the turn moves again quickly", async () => {
    await setUp(hogGame);
    toyKnobs.decide = "hog";
    await table(["Ana"], 1);
    await toBotTurn();
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [, at] = botTimers()[0]!;
      gaps.push(at - world.clock);
      await world.tick(room, at - world.clock);
    }
    // The first move is a full think; the ones after it, in the same turn, are short.
    expect(gaps[0]).toBeGreaterThanOrEqual(1600);
    expect(gaps[0]).toBeLessThanOrEqual(2600);
    for (const g of gaps.slice(1)) {
      expect(g).toBeGreaterThanOrEqual(900);
      expect(g).toBeLessThanOrEqual(1300);
    }
  });

  it("a stuck computer's reason reaches every seat after the update", async () => {
    toyKnobs.decide = "bad-call";
    const a = await table(["Ana", "Ben"], 1);
    await playUntil(() => roomOf(a).phase === "lobby");
    expect(a.last("welcome")!.playerId).toBe(roomOf(a).hostId);
    for (const c of people) {
      const last = c.inbox.at(-1)!;
      expect(last).toEqual({ type: "error", code: "game-ended", message: STUCK, fatal: false });
      // The update that brought everyone back to the lobby came first.
      const prev = c.inbox.at(-2)!;
      expect(prev.type).toBe("update");
      expect((prev as { room: { phase: string } }).room.phase).toBe("lobby");
    }
  });

  it("bots take turns against each other without tripping the cap", async () => {
    const a = await table(["Ana"], 3);
    // Ana is out of it: only the bots move, and the game still ends normally.
    await playUntil(() => roomOf(a).phase === "results");
    expect(a.of("error").filter((e) => e.code === "game-ended")).toHaveLength(0);
  });

  it("bots pause while no person is connected, and pick up on reconnect", async () => {
    const a = await table(["Ana"], 1);
    await toBotTurn();
    const token = a.last("welcome")!.resumeToken;
    const total = pub(a).total;
    const stored = () => (data() as unknown as { game: { state: { total: number } } }).game.state.total;
    await world.disconnect(room, a);
    for (let i = 0; i < 5; i++) await world.tick(room, 3000);
    expect(stored()).toBe(total);
    expect(botTimers()).toEqual([]);

    const back = await join(world, room, "Ana", token);
    people = [back];
    expect(pub(back).total).toBe(total);
    await world.tick(room, 3000);
    expect(pub(back).total).toBeGreaterThan(total);
  });

  it("the game ends when every person has left", async () => {
    const a = await table(["Ana"], 2);
    await send(room, a, { type: "leave" });
    expect(data().phase).toBe("lobby");
    expect(data().hostId).toBeNull();
    expect(botTimers()).toEqual([]);
    expect(data().seats.every((s) => s.bot)).toBe(true);
    expect(a.of("error").filter((e) => e.code === "game-ended")).toHaveLength(0);
    for (let i = 0; i < 5; i++) await world.tick(room, 3000);
    expect(data().phase).toBe("lobby");

    const b = await join(world, room, "Ben");
    expect(roomOf(b)).toMatchObject({ phase: "lobby", hostId: idOf(b) });
    expect(bots(b)).toHaveLength(2);
  });

  it("a reload mid-game keeps bots playing", async () => {
    const a = await table(["Ana"], 1);
    await toBotTurn();
    const total = pub(a).total;
    const room2 = new RoomRuntime("K7DX", world.host(), { toy: toyGame }, "toy");
    await room2.load();
    expect(data().seats.filter((s) => s.bot).every((s) => s.presence === "connected")).toBe(true);
    expect(botTimers()).toHaveLength(1);
    room = room2;
    await world.tick(room2, 3000);
    expect(pub(a).total).toBeGreaterThan(total);
  });

  async function delays(): Promise<number[]> {
    const a = people[0]!;
    const out: number[] = [];
    for (let i = 0; i < 40 && out.length < 12 && roomOf(a).phase === "playing" && pub(a).phase === "count"; i++) {
      await peopleMove();
      const [entry] = botTimers();
      if (!entry) {
        await world.tick(room, 3000);
        continue;
      }
      out.push(entry[1] - world.clock);
      await world.tick(room, entry[1] - world.clock);
    }
    expect(out.length).toBeGreaterThan(3);
    return out;
  }

  it("think time shrinks at big tables, down to a floor", async () => {
    await table(["Ana"], 3);
    for (const d of await delays()) {
      expect(d).toBeGreaterThanOrEqual(1600);
      expect(d).toBeLessThanOrEqual(2600);
    }
    await setUp(bigGame);
    await table(["Ana"], 6);
    for (const d of await delays()) {
      // 4 / 6 of 1.6 to 2.6 s.
      expect(d).toBeGreaterThanOrEqual(1067);
      expect(d).toBeLessThanOrEqual(1733);
    }
    await setUp(bigGame);
    await table(["Ana"], 7);
    for (const d of await delays()) {
      // 4 / 7 of 1.6 to 2.6 s is 0.91 to 1.49 s; the floor holds the low end at 1 s.
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(1486);
    }
  });

  it("the think-time floor holds when the roll is lowest", async () => {
    await setUp(bigGame);
    // The lowest roll at 7 bots is round(1600 * 4 / 7) = 914 ms, under the 1000 ms floor.
    (world as unknown as { rng: (max: number) => number }).rng = () => 0;
    await table(["Ana"], 7);
    for (const d of await delays()) expect(d).toBe(1000);
  });

  it("bot seats stay ready after results and after back to lobby", async () => {
    const a = await table(["Ana"], 2);
    await playUntil(() => roomOf(a).phase === "results");
    expect(botTimers()).toEqual([]);
    expect(bots(a).every((s) => s.ready)).toBe(true);
    expect(roomOf(a).seats.find((s) => s.id === idOf(a))!.ready).toBe(false);
    await send(room, a, { type: "return-to-lobby" });
    expect(roomOf(a).phase).toBe("lobby");
    expect(bots(a).every((s) => s.ready)).toBe(true);

    await send(room, a, { type: "start-game" });
    await send(room, a, { type: "return-to-lobby" });
    expect(bots(a).every((s) => s.ready)).toBe(true);
    expect(botTimers()).toEqual([]);
  });

  it("bots win games but get no awards", async () => {
    const a = await table(["Ana"], 1);
    const bot = bots(a)[0]!;
    let botWon = false;
    for (let game = 0; game < 20 && !botWon; game++) {
      if (game > 0) await send(room, a, { type: "start-game" });
      await playUntil(() => roomOf(a).phase === "results");
      botWon = roomOf(a).result!.winnerIds.includes(bot.id);
    }
    expect(botWon).toBe(true);
    // The bot called first in the window: the game counted it.
    const party = data().party!;
    expect(party.games.length).toBeGreaterThan(0);
    await send(room, a, { type: "end-party" });
    const recap = roomOf(a).recap!;
    expect(recap.gamesPlayed).toBe(party.games.length);
    for (const award of recap.awards) expect(award.who).not.toContain(bot.name);
    const log = data().party!;
    for (const g of log.games) {
      expect(g.players).not.toContain(bot.id);
      expect(g.winnerIds).not.toContain(bot.id);
      expect(g.loserIds ?? []).not.toContain(bot.id);
      expect(Object.keys(g.stats)).not.toContain(bot.id);
    }
    expect(Object.keys(log.names)).not.toContain(bot.id);
    // Ana is the only one the recap can name.
    expect(recap.awards.flatMap((x) => x.who).every((n) => n === "Ana")).toBe(true);
  });
});
