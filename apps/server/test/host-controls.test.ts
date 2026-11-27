import { GRACE_MS } from "@games/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { blackjackGame } from "@games/blackjack/server";
import { sevensGame } from "@games/sevens/server";
import { nightfallGame } from "@games/nightfall/server";
import { notMyProblemGame } from "@games/not-my-problem/server";
import type { AnyGameDefinition, GameContext } from "@games/game-core";
import { RoomRuntime } from "../src/runtime.ts";
import { plainGame, TOY_WINDOW_MS, toyGame, toyKnobs, type ToyPublic, type ToyState } from "./bot-toy.ts";
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

  it("a refused join keeps the way back open", async () => {
    const c = await join(world, room, "Cy");
    const token = tokenOf(c);
    await world.disconnect(room, c);
    await send(room, b, { type: "ready", ready: true });
    await send(room, a, { type: "start-game" });
    await lock(a);
    const early = await join(world, room, "Cy", token);
    expect(early.last("error")).toMatchObject({ code: "game-in-progress" });
    await send(room, a, { type: "return-to-lobby" });
    const c2 = await join(world, room, "Cy", token);
    expect(roomOf(c2).seats.map((s) => s.name)).toContain("Cy");
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

describe("make host", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  let c: FakeConn;

  const idOf = (name: string) => roomOf(a).seats.find((s) => s.name === name)!.id;
  const give = (from: FakeConn, playerId: string) => send(room, from, { type: "transfer-host", playerId });
  const CANT = { code: "not-available", message: "You can't make them host.", fatal: false };

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
    c = await join(world, room, "Cy");
  });

  it("hands the host role over at once", async () => {
    const before = [a, b, c].map((p) => p.of("update").length);
    await give(a, idOf("Ben"));
    expect(roomOf(c).hostId).toBe(idOf("Ben"));
    expect([a, b, c].map((p) => p.of("update").length)).toEqual(before.map((n) => n + 1));
  });

  it("refuses what it can't do", async () => {
    await send(room, a, { type: "add-bot" });
    const bot = roomOf(a).seats.find((s) => s.bot)!.id;
    await world.disconnect(room, c);
    expect(roomOf(a).seats.find((s) => s.name === "Cy")!.presence).toBe("reconnecting");
    const version = a.last("update")!.stateVersion;
    for (const id of [idOf("Ana"), bot, idOf("Cy"), "nobody"]) {
      await give(a, id);
      expect(a.last("error")).toEqual({ type: "error", ...CANT });
    }
    expect(a.last("update")!.stateVersion).toBe(version);
    expect(roomOf(a).hostId).toBe(idOf("Ana"));
  });

  it("only the host", async () => {
    await give(b, idOf("Cy"));
    expect(b.last("error")).toMatchObject({ code: "not-host" });
    expect(roomOf(a).hostId).toBe(idOf("Ana"));
  });

  it("the old host doesn't take it back", async () => {
    const token = a.last("welcome")!.resumeToken;
    await give(a, idOf("Ben"));
    await world.disconnect(room, a);
    const a2 = await join(world, room, "Ana", token);
    expect(roomOf(a2).hostId).toBe(idOf("Ben"));
    await world.disconnect(room, b);
    await world.tick(room, GRACE_MS);
    expect(roomOf(a2).seats.map((s) => s.name)).not.toContain("Ben");
    expect(roomOf(a2).hostId).toBe(idOf("Ana"));
  });

  it("works mid-game", async () => {
    await send(room, b, { type: "ready", ready: true });
    await send(room, c, { type: "ready", ready: true });
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
    await give(a, idOf("Ben"));
    expect(roomOf(a).hostId).toBe(idOf("Ben"));
    await send(room, a, { type: "return-to-lobby" });
    expect(a.last("error")).toMatchObject({ code: "not-host" });
  });

  it("refused in an ended room", async () => {
    await send(room, a, { type: "end-party" });
    await give(a, idOf("Ben"));
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
  });
});

describe("restart", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  let c: FakeConn;
  let problem: string | null;
  let awayCalls: { id: string; seen: boolean }[];

  const fixture: AnyGameDefinition = { ...toyGame, setupProblem: () => problem };
  const recording: AnyGameDefinition = {
    ...fixture,
    onPlayerDisconnected: (st: { players: string[] }, id: string) => {
      awayCalls.push({ id, seen: st.players.includes(id) });
      return { state: st, events: [] };
    },
  } as AnyGameDefinition;

  const stored = () => structuredClone(world.store.get("room") as { game: { gameId: string; state: unknown }; phase: string });
  const idOf = (name: string) => roomOf(a).seats.find((s) => s.name === name)!.id;
  const restart = (who: FakeConn) => send(room, who, { type: "restart-game" });
  const startAll = async (...others: FakeConn[]) => {
    for (const o of others) await send(room, o, { type: "ready", ready: true });
    await send(room, a, { type: "start-game" });
  };
  const open = async (games: Record<string, AnyGameDefinition>, id: string, names = ["Ana", "Ben", "Cy"]) => {
    room = new RoomRuntime("K7DX", world.host(), games, id);
    await room.load();
    await room.claim();
    const conns: FakeConn[] = [];
    for (const n of names) conns.push(await join(world, room, n));
    [a, b, c] = conns as [FakeConn, FakeConn, FakeConn];
  };

  beforeEach(() => {
    toyKnobs.decide = "normal";
    world = new World();
    problem = null;
    awayCalls = [];
  });

  it("starts the same game again in one update", async () => {
    await open({ sevens: sevensGame }, "sevens");
    await startAll(b, c);
    const first = roomOf(a);
    const turn = first.game as { currentPlayerId: string };
    const mover = [a, b, c].find((p) => p.last("welcome")!.playerId === turn.currentPlayerId)!;
    const card = (mover.last("update")!.private as { playableCardIds: string[] }).playableCardIds[0]!;
    await send(room, mover, { type: "game-action", clientActionId: "x", action: { type: "play-card", cardId: card } });
    const before = [a, b, c].map((p) => p.of("update").length);
    await restart(a);
    expect([a, b, c].map((p) => p.of("update").length)).toEqual(before.map((n) => n + 1));
    const now = roomOf(a);
    expect(now.phase).toBe("playing");
    expect(now.gameId).toBe(first.gameId);
    expect(now.settings).toEqual(first.settings);
    expect(now.roundNumber).toBe(first.roundNumber + 1);
    const hands = [a, b, c].map((p) => (p.last("update")!.private as { hand: unknown[] }).hand.length);
    expect(hands.reduce((x, y) => x + y, 0)).toBe(52);
    expect(a.last("error")).toBeUndefined();
  });

  it("keeps reconnecting seats", async () => {
    await open({ toy: recording }, "toy");
    await startAll(b, c);
    await world.disconnect(room, c);
    awayCalls = [];
    await restart(a);
    expect(roomOf(a).seats.map((s) => s.name)).toContain("Cy");
    expect((stored().game.state as { players: string[] }).players).toContain(idOf("Cy"));
    expect(roomOf(a).seats.find((s) => s.name === "Cy")!.presence).toBe("reconnecting");
    expect(awayCalls).toEqual([{ id: idOf("Cy"), seen: true }]);
    await world.tick(room, GRACE_MS);
    expect(roomOf(a).seats.find((s) => s.name === "Cy")!.presence).toBe("disconnected");
    expect(roomOf(a).phase).toBe("playing");
  });

  it("drops disconnected seats", async () => {
    await open({ toy: fixture }, "toy");
    await startAll(b, c);
    await world.disconnect(room, c);
    await world.tick(room, GRACE_MS);
    await restart(a);
    expect(roomOf(a).phase).toBe("playing");
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana", "Ben"]);
  });

  describe("refused before ending anything", () => {
    const expectUntouched = async (code: string, message?: string) => {
      const state = stored();
      const version = a.last("update")!.stateVersion;
      await restart(a);
      expect(a.last("error")).toMatchObject({ code, ...(message && { message }) });
      expect(roomOf(a).phase).toBe("playing");
      expect(stored()).toEqual(state);
      expect(a.last("update")!.stateVersion).toBe(version);
    };

    it("without the owner", async () => {
      world.ownerRequired = true;
      room = new RoomRuntime("K7DX", world.host(), { toy: fixture }, "toy");
      await room.load();
      await room.claim();
      a = await join(world, room, "Ana");
      b = await join(world, room, "Ben");
      const o = await join(world, room, "Olu", undefined, OWNER_KEY);
      await startAll(b, o);
      expect(roomOf(a).phase).toBe("playing");
      await world.disconnect(room, o);
      await expectUntouched("cannot-start");
    });

    it("with too few players", async () => {
      await open({ sevens: sevensGame }, "sevens", ["Ana", "Ben"]);
      await startAll(b);
      await world.disconnect(room, b);
      await world.tick(room, GRACE_MS);
      await expectUntouched("not-enough-players");
    });

    it("with a bad setup", async () => {
      await open({ toy: fixture }, "toy");
      await startAll(b, c);
      problem = "Bad deck";
      await expectUntouched("bad-setup", "Bad deck");
    });
  });

  it("leaves no recap entry", async () => {
    await open({ toy: fixture }, "toy");
    await startAll(b, c);
    await restart(a);
    await send(room, a, { type: "return-to-lobby" });
    await send(room, a, { type: "end-party" });
    expect(roomOf(a).phase).toBe("ended");
    expect(roomOf(a).recap).toBeNull();
  });

  it("only the host, only mid-game", async () => {
    await open({ toy: fixture }, "toy");
    await restart(a);
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
    await startAll(b, c);
    await restart(b);
    expect(b.last("error")).toMatchObject({ code: "not-host" });
    expect(roomOf(a).roundNumber).toBe(1);
    // Finish the game for the results phase.
    const turnOf = () => (roomOf(a).game as { turnId: string | null }).turnId;
    for (let i = 0; i < 20 && roomOf(a).phase === "playing" && turnOf(); i++) {
      const mover = [a, b, c].find((p) => p.last("welcome")!.playerId === turnOf())!;
      await send(room, mover, { type: "game-action", clientActionId: `n${i}`, action: { type: "add", n: 2 } });
    }
    await world.tick(room, 10_000);
    expect(roomOf(a).phase).toBe("results");
    await restart(a);
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
  });
});

describe("pause", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;

  /** The room's think time for a bot at a small table, at most. */
  const BOT_THINK_MAX_MS = 1600 + 1001;
  const pauseToy: AnyGameDefinition = {
    ...toyGame,
    manifest: { ...toyGame.manifest, pausable: true },
    pause: (s: unknown) => ({ state: s, events: [] }),
    // Relays every stream, so a dropped one shows.
    onStream: (s: unknown, _id: string, data: unknown) => ({ state: s, relay: data, persist: false }),
  } as AnyGameDefinition;
  const pauseGame = (who: FakeConn, paused = true) => send(room, who, { type: "pause-game", paused });
  const stored = () =>
    world.store.get("room") as { timers: Record<string, number>; pause?: { at: number; timers: Record<string, number> } };
  const loopTimers = () => Object.keys(stored().timers).filter((k) => k.startsWith("game:") || k.startsWith("bot:"));
  const pub = (c: FakeConn) => roomOf(c).game as ToyPublic;
  const idOf = (c: FakeConn) => c.last("welcome")!.playerId;

  const open = async (games: Record<string, AnyGameDefinition>, id: string, names = ["Ana", "Ben"]) => {
    room = new RoomRuntime("K7DX", world.host(), games, id);
    await room.load();
    await room.claim();
    const conns: FakeConn[] = [];
    for (const n of names) conns.push(await join(world, room, n));
    [a, b] = conns as [FakeConn, FakeConn];
    return conns;
  };
  const start = async () => {
    await send(room, a, { type: "start-game" });
    expect(roomOf(a).phase).toBe("playing");
  };
  /** People add 2 in turn until the toy reaches 10 and its window opens. */
  const playTo10 = async (people = [a, b]) => {
    for (let i = 0; i < 20 && pub(a).phase === "count"; i++) {
      const mover = people.find((p) => idOf(p) === pub(a).turnId)!;
      await send(room, mover, { type: "game-action", clientActionId: `m${i}`, action: { type: "add", n: 2 } });
    }
    expect(pub(a).phase).toBe("window");
  };

  beforeEach(() => {
    toyKnobs.decide = "normal";
    world = new World();
  });

  it("holds the game timer by time left", async () => {
    await open({ toy: pauseToy }, "toy");
    await start();
    await playTo10();
    await world.tick(room, 2000);
    await pauseGame(a);
    expect(roomOf(a).paused).toBe(true);
    await world.tick(room, 60_000);
    expect(roomOf(a).phase).toBe("playing");
    expect(stored().timers).not.toHaveProperty("game:window");
    await pauseGame(a, false);
    expect(roomOf(a).paused).toBe(false);
    await world.tick(room, TOY_WINDOW_MS - 2001);
    expect(roomOf(a).phase).toBe("playing");
    await world.tick(room, 1);
    expect(roomOf(a).phase).toBe("results");
  });

  it("computers wait while paused", async () => {
    await open({ toy: pauseToy }, "toy", ["Ana"]);
    await send(room, a, { type: "add-bot" });
    await start();
    const bot = roomOf(a).seats.find((s) => s.bot)!.id;
    if (pub(a).turnId !== bot) {
      await send(room, a, { type: "game-action", clientActionId: "m", action: { type: "add", n: 1 } });
    }
    expect(pub(a).turnId).toBe(bot);
    const key = `bot:${bot}`;
    const left = stored().timers[key]! - world.clock;
    const total = pub(a).total;
    await pauseGame(a);
    await world.tick(room, 10_000);
    expect(pub(a).total).toBe(total);
    expect(Object.keys(stored().timers).filter((k) => k.startsWith("bot:"))).toEqual([]);
    await pauseGame(a, false);
    expect(stored().timers[key]).toBe(world.clock + left);
    await world.tick(room, BOT_THINK_MAX_MS);
    expect(pub(a).total).toBeGreaterThan(total);
  });

  it("refuses moves while paused", async () => {
    await open({ toy: pauseToy }, "toy");
    await start();
    await pauseGame(a);
    const version = a.last("update")!.stateVersion;
    const mover = [a, b].find((p) => idOf(p) === pub(a).turnId)!;
    const other = mover === a ? b : a;
    const PAUSED = { code: "wrong-phase", message: "The game is paused." };
    await send(room, mover, { type: "game-action", clientActionId: "p1", action: { type: "add", n: 1 } });
    expect(mover.last("action-rejected")).toMatchObject({ clientActionId: "p1", ...PAUSED });
    await world.tick(room, 120_000);
    await send(room, a, { type: "skip-turn", playerId: idOf(mover) });
    expect(a.last("error")).toMatchObject(PAUSED);
    await send(room, other, { type: "nudge" });
    expect(other.last("error")).toMatchObject(PAUSED);
    const inbox = [a.inbox.length, b.inbox.length];
    await send(room, mover, { type: "stream", data: { x: 1 } });
    expect([a.inbox.length, b.inbox.length]).toEqual(inbox);
    expect(a.last("update")!.stateVersion).toBe(version);
  });

  it("awaitingSince moves on by the time paused", async () => {
    await open({ toy: pauseToy }, "toy");
    await start();
    const t0 = roomOf(a).awaitingSince!;
    await pauseGame(a);
    await world.tick(room, 30_000);
    await pauseGame(a, false);
    expect(roomOf(a).awaitingSince).toBe(t0 + 30_000);
  });

  it("only the host, only mid-game, only games that pause", async () => {
    await open({ toy: pauseToy, plain: { ...plainGame } }, "toy");
    await pauseGame(a);
    expect(a.last("error")).toMatchObject({ code: "wrong-phase" });
    await start();
    await pauseGame(b);
    expect(b.last("error")).toMatchObject({ code: "not-host" });
    expect(roomOf(a).paused).toBe(false);
    await pauseGame(a);
    const updates = a.of("update").length;
    await pauseGame(a);
    expect(a.of("update")).toHaveLength(updates);
    await send(room, a, { type: "return-to-lobby" });
    await send(room, a, { type: "select-game", gameId: "plain" });
    await start();
    await pauseGame(a);
    expect(a.last("error")).toMatchObject({ code: "not-available", message: "This game can't pause." });
    expect(roomOf(a).paused).toBe(false);
  });

  it("the new host can resume", async () => {
    await open({ toy: pauseToy }, "toy", ["Ana", "Ben", "Cy"]);
    await start();
    await pauseGame(a);
    await send(room, a, { type: "leave" });
    expect(roomOf(b).hostId).toBe(idOf(b));
    expect(roomOf(b).paused).toBe(true);
    await pauseGame(b, false);
    expect(roomOf(b).paused).toBe(false);
  });

  it("timers set during a pause wait for resume, and hooks see the clock stopped", async () => {
    const seen: number[] = [];
    const late: AnyGameDefinition = {
      ...pauseToy,
      onPlayerDisconnected: (s: unknown, _id: string, ctx: GameContext) => {
        seen.push(ctx.now);
        return { state: s, events: [], timers: [{ kind: "set", timerId: "late", delayMs: 4000 }] };
      },
    } as AnyGameDefinition;
    await open({ toy: late }, "toy");
    await start();
    await pauseGame(a);
    const P = world.clock;
    await world.tick(room, 10_000);
    await world.disconnect(room, b);
    expect(seen).toEqual([P]);
    expect(stored().timers).not.toHaveProperty("game:late");
    await pauseGame(a, false);
    const R = world.clock;
    expect(stored().timers["game:late"]).toBe(R + 4000);
  });

  it("a game that ends while paused drops the pause", async () => {
    const ending: AnyGameDefinition = {
      ...pauseToy,
      onPlayerRemoved: (s: ToyState, id: string) => ({
        state: { ...s, phase: "done" as const, winner: s.players.find((p) => p !== id)! },
        events: [],
      }),
    } as AnyGameDefinition;
    await open({ toy: ending }, "toy");
    await start();
    await pauseGame(a);
    await send(room, b, { type: "leave" });
    expect(roomOf(a).phase).toBe("results");
    expect(roomOf(a).paused).toBe(false);
    expect(stored().pause).toBeUndefined();
    expect(loopTimers()).toEqual([]);
  });

  it("back to lobby and restart clear the pause", async () => {
    await open({ toy: pauseToy }, "toy");
    await start();
    await pauseGame(a);
    await send(room, a, { type: "return-to-lobby" });
    expect(roomOf(a).paused).toBe(false);
    await start();
    await pauseGame(a);
    expect(roomOf(a).paused).toBe(true);
    await send(room, a, { type: "restart-game" });
    expect(roomOf(a).phase).toBe("playing");
    expect(roomOf(a).paused).toBe(false);
    // The new game's timers run.
    await playTo10();
    await world.tick(room, TOY_WINDOW_MS);
    expect(roomOf(a).phase).toBe("results");
  });

  it("Nightfall through the room", async () => {
    await open({ nightfall: nightfallGame }, "nightfall", ["Ana", "Ben", "Cy", "Dev", "Eli"]);
    await start();
    const game = () => roomOf(a).game as { phase: string; deadline: number; pausedAt: number | null };
    const D = game().deadline;
    expect(game().phase).toBe("reveal");
    await world.tick(room, 5000);
    await pauseGame(a);
    expect(game().pausedAt).toBe(world.clock);
    await world.tick(room, 60_000);
    await pauseGame(a, false);
    expect(game().deadline).toBe(D + 60_000);
    expect(game().pausedAt).toBeNull();
    await world.tick(room, D + 60_000 - world.clock - 1);
    expect(game().phase).toBe("reveal");
    await world.tick(room, 1);
    expect(game().phase).toBe("night");
  });

  it("Blackjack through the room", async () => {
    await open({ blackjack: blackjackGame }, "blackjack");
    await start();
    const game = () => roomOf(a).game as { step: string; clock: { endsAt: number } | null; pausedAt: number | null };
    expect(game().step).toBe("betting");
    const D = game().clock!.endsAt;
    await world.tick(room, 5000);
    await pauseGame(a);
    expect(game().pausedAt).toBe(world.clock);
    await world.tick(room, 60_000);
    await pauseGame(a, false);
    expect(game().clock!.endsAt).toBe(D + 60_000);
    expect(game().pausedAt).toBeNull();
    await world.tick(room, D + 60_000 - world.clock - 1);
    expect(game().step).toBe("betting");
    await world.tick(room, 1);
    // Nobody bet: the round is skipped.
    expect(game().step).toBe("settle");
    expect(world.errors).toEqual([]);
  });

  it("Not My Problem through the room", async () => {
    const conns = await open({ "not-my-problem": notMyProblemGame }, "not-my-problem", ["Ana", "Ben", "Cy"]);
    await start();
    const game = () =>
      roomOf(a).game as { step: string; token: number; deadline: number; drawCount: number; turnPlayerId: string };
    const D = game().deadline;
    const { token, drawCount, turnPlayerId } = game();
    expect(game().step).toBe("action");
    const mover = conns.find((c) => idOf(c) === turnPlayerId)!;
    await world.tick(room, 5000);
    await pauseGame(a);
    // Past the old deadline: the turn doesn't time out, and the turn player can't draw.
    await world.tick(room, 60_000);
    expect(world.clock).toBeGreaterThan(D);
    await send(room, mover, { type: "game-action", clientActionId: "d1", action: { type: "draw", token } });
    expect(mover.last("action-rejected")).toMatchObject({ clientActionId: "d1", code: "wrong-phase", message: "The game is paused." });
    expect(game()).toMatchObject({ step: "action", token, drawCount, turnPlayerId });
    await pauseGame(a, false);
    expect(game().deadline).toBe(D + 60_000);
    await world.tick(room, D + 60_000 - world.clock - 1);
    expect(game()).toMatchObject({ step: "action", token, drawCount });
    await world.tick(room, 1);
    // The turn timed out: the turn player drew.
    expect(game().token).toBeGreaterThan(token);
    expect(game().drawCount).toBe(drawCount - 1);
    expect(world.errors).toEqual([]);
  });

  it("a fresh runtime from the same storage can resume with the same deadline", async () => {
    const names = ["Ana", "Ben", "Cy", "Dev", "Eli"];
    const conns = await open({ nightfall: nightfallGame }, "nightfall", names);
    await start();
    const D = (roomOf(a).game as { deadline: number }).deadline;
    const tokens = conns.map((c) => c.last("welcome")!.resumeToken);
    await world.tick(room, 5000);
    await pauseGame(a);
    // The room is evicted: every socket is gone and a new runtime reads the same storage.
    for (const c of conns) c.closed = { code: 1001, reason: "evicted" };
    room = new RoomRuntime("K7DX", world.host(), { nightfall: nightfallGame }, "nightfall");
    await room.load();
    await world.tick(room, 30_000);
    const back: FakeConn[] = [];
    for (const [i, n] of names.entries()) back.push(await join(world, room, n, tokens[i]));
    const ana = back[0]!;
    expect(roomOf(ana).paused).toBe(true);
    await send(room, ana, { type: "pause-game", paused: false });
    const game = () => roomOf(ana).game as { phase: string; deadline: number };
    expect(game().deadline).toBe(D + 30_000);
    expect(game().phase).toBe("reveal");
    await world.tick(room, game().deadline - world.clock);
    expect(game().phase).toBe("night");
    expect(world.errors).toEqual([]);
  });
});
