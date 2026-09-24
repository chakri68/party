import { seededRandomInt, type AnyGameDefinition } from "@games/game-core";
import {
  GRACE_MS,
  NUDGE_AFTER_MS,
  NUDGE_COOLDOWN_MS,
  PROTOCOL_VERSION,
  SKIP_AFTER_MS,
  type ServerMessage,
} from "@games/protocol";
import { sevensGame } from "@games/sevens/server";
import { makeDeck, type SevensPrivateState, type SevensPublicState } from "@games/sevens/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { CLEANUP_AFTER_MS, RoomRuntime, type Conn, type ConnState, type RoomHost } from "../src/runtime.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeConn implements Conn {
  state: ConnState | null = null;
  inbox: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  setState(s: ConnState) {
    this.state = s;
  }
  send(msg: ServerMessage) {
    // Round-trip through JSON so tests see exactly what goes over the wire.
    this.inbox.push(JSON.parse(JSON.stringify(msg)));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  of<T extends ServerMessage["type"]>(type: T) {
    return this.inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
  last<T extends ServerMessage["type"]>(type: T) {
    return this.of(type).at(-1);
  }
}

class World {
  store = new Map<string, unknown>();
  alarm: number | null = null;
  conns: FakeConn[] = [];
  clock = 1_000_000;
  devTools = false;
  errors: unknown[] = [];
  private nextId = 0;
  private rng = seededRandomInt(42);

  /** Makes the next storage write throw, as a flaky disk would. */
  failNextPut = false;

  host(): RoomHost {
    return {
      storage: {
        get: async <T>(k: string) => structuredClone(this.store.get(k)) as T | undefined,
        put: async (k, v) => {
          if (this.failNextPut) {
            this.failNextPut = false;
            throw new Error("storage write failed");
          }
          this.store.set(k, structuredClone(v));
        },
        deleteAll: async () => this.store.clear(),
        setAlarm: async (at) => void (this.alarm = at),
        deleteAlarm: async () => void (this.alarm = null),
      },
      connections: () => this.conns.filter((c) => !c.closed),
      now: () => this.clock,
      randomInt: (max) => this.rng(max),
      // Unique in the first 12 chars too: seat ids are token prefixes.
      randomToken: () => `t${(this.nextId++).toString().padStart(4, "0")}-fake-token-xyz`,
      devTools: this.devTools,
      logError: (err) => void this.errors.push(err),
    };
  }

  runtime(games: Record<string, AnyGameDefinition> = { sevens: sevensGame }) {
    return new RoomRuntime("K7DX", this.host(), games, "sevens");
  }

  async connect(room: RoomRuntime): Promise<FakeConn> {
    const c = new FakeConn(`c${this.conns.length}`);
    this.conns.push(c);
    await room.onConnect(c);
    return c;
  }

  /** Moves the clock and fires the alarm if it's due, like the DO would. */
  async tick(room: RoomRuntime, ms: number) {
    this.clock += ms;
    if (this.alarm !== null && this.alarm <= this.clock) await room.onAlarm();
  }

  async disconnect(room: RoomRuntime, c: FakeConn) {
    c.closed = { code: 1001, reason: "gone" };
    await room.onClose(c);
  }
}

const send = (room: RoomRuntime, c: Conn, msg: object) => room.onMessage(c, JSON.stringify(msg));

async function join(world: World, room: RoomRuntime, name: string, resumeToken?: string) {
  const c = await world.connect(room);
  await send(room, c, { type: "hello", protocolVersion: PROTOCOL_VERSION });
  await send(room, c, { type: "join", name, avatarSeed: name, resumeToken });
  return c;
}

const roomOf = (c: FakeConn) => c.last("update")!.room;
const gameOf = (c: FakeConn) => roomOf(c).game as SevensPublicState;
const privOf = (c: FakeConn) => c.last("update")!.private as SevensPrivateState;

// ---------------------------------------------------------------------------

describe("room runtime", () => {
  let world: World;
  let room: RoomRuntime;

  beforeEach(async () => {
    world = new World();
    room = world.runtime();
    await room.load();
  });

  it("refuses connections to unclaimed codes", async () => {
    const c = await world.connect(room);
    expect(c.last("error")).toMatchObject({ code: "room-not-found", fatal: true });
    expect(c.closed).not.toBeNull();
  });

  it("claims a code exactly once", async () => {
    expect(await room.claim()).toBe(true);
    expect(await room.claim()).toBe(false);
  });

  describe("claimed", () => {
    beforeEach(async () => {
      await room.claim();
    });

    it("rejects clients on another protocol version", async () => {
      const c = await world.connect(room);
      await send(room, c, { type: "hello", protocolVersion: 999 });
      expect(c.last("error")).toMatchObject({ code: "protocol-mismatch", fatal: true });
      expect(c.closed).not.toBeNull();
    });

    it("joins, welcomes, and makes the first player host", async () => {
      const a = await join(world, room, "Ana");
      const welcome = a.last("welcome")!;
      expect(welcome.resumeToken.length).toBeGreaterThanOrEqual(16);
      const update = a.last("update")!;
      expect(update.snapshot).toBe(true);
      expect(update.room.hostId).toBe(welcome.playerId);
      expect(JSON.stringify(update.room)).not.toContain(welcome.resumeToken);
    });

    it("sends exactly one update per player per transition, with a rising version", async () => {
      const a = await join(world, room, "Ana");
      const before = a.of("update").length;
      const v = a.last("update")!.stateVersion;
      await join(world, room, "Ben");
      expect(a.of("update").length).toBe(before + 1);
      expect(a.last("update")!.stateVersion).toBe(v + 1);
      expect(a.last("update")!.snapshot).toBe(false);
    });

    it("only the host can start, and only with enough players", async () => {
      const a = await join(world, room, "Ana");
      const b = await join(world, room, "Ben");
      await send(room, b, { type: "start-game" });
      expect(b.last("error")?.code).toBe("not-host");
      await send(room, a, { type: "start-game" });
      expect(a.last("error")?.code).toBe("not-enough-players");
    });

    describe("in a game", () => {
      let players: FakeConn[];

      beforeEach(async () => {
        players = [];
        for (const name of ["Ana", "Ben", "Cy", "Dee"]) players.push(await join(world, room, name));
        await send(room, players[0]!, { type: "start-game" });
      });

      const current = () => {
        const id = gameOf(players[0]!).currentPlayerId;
        return players.find((p) => p.last("welcome")!.playerId === id)!;
      };

      it("deals private hands that nobody else receives", () => {
        const hands = players.map((p) => privOf(p).hand.map((c) => c.id));
        expect(hands.flat()).toHaveLength(52);
        for (const p of players) {
          const wire = JSON.stringify(p.inbox);
          const mine = new Set(privOf(p).hand.map((c) => c.id));
          for (const other of hands.flat()) {
            if (!mine.has(other)) {
              // A card another player holds must never reach this socket…
              // unless it was played to the board, which this early it hasn't been.
              expect(wire.includes(`"${other}"`)).toBe(false);
            }
          }
        }
      });

      it("rejects illegal actions back to the sender only", async () => {
        const cur = current();
        const other = players.find((p) => p !== cur)!;
        const card = privOf(other).hand[0]!.id;
        const otherUpdates = other.of("update").length;
        await send(room, other, { type: "game-action", clientActionId: "x1", action: { type: "play-card", cardId: card } });
        expect(other.last("action-rejected")).toMatchObject({ clientActionId: "x1", code: "not-your-turn" });
        expect(other.of("update").length).toBe(otherUpdates);
      });

      it("applies a legal play and broadcasts the event with the new state", async () => {
        const cur = current();
        const card = privOf(cur).playableCardIds[0]!;
        await send(room, cur, { type: "game-action", clientActionId: "a1", action: { type: "play-card", cardId: card } });
        for (const p of players) {
          const u = p.last("update")!;
          expect(u.events[0]).toMatchObject({ type: "card-played", card: { id: card } });
        }
        expect(privOf(cur).hand.map((c) => c.id)).not.toContain(card);
      });

      it("refuses brand-new players mid-game", async () => {
        const late = await join(world, room, "Late");
        expect(late.last("error")).toMatchObject({ code: "game-in-progress", fatal: true });
      });

      it("resumes a seat with the stored token, hand intact", async () => {
        const ben = players[1]!;
        const { playerId, resumeToken } = ben.last("welcome")!;
        const hand = privOf(ben).hand;
        await world.disconnect(room, ben);
        const seat = roomOf(players[0]!).seats.find((s) => s.id === playerId)!;
        expect(seat.presence).toBe("reconnecting");

        const back = await join(world, room, "Ben", resumeToken);
        expect(back.last("welcome")!.playerId).toBe(playerId);
        expect(back.last("update")!.snapshot).toBe(true);
        expect(privOf(back).hand).toEqual(hand);
        expect(roomOf(players[0]!).seats.find((s) => s.id === playerId)!.presence).toBe("connected");
      });

      it("newest tab wins; the old one is told not to reconnect", async () => {
        const ben = players[1]!;
        const { resumeToken } = ben.last("welcome")!;
        await join(world, room, "Ben", resumeToken);
        expect(ben.last("error")).toMatchObject({ code: "replaced-by-new-connection", fatal: true });
        expect(ben.closed).not.toBeNull();
        // …and its close doesn't flip the player to "reconnecting".
        await room.onClose(ben);
        expect(roomOf(players[0]!).seats.every((s) => s.presence === "connected")).toBe(true);
      });

      it("survives a restart: state rehydrates from storage", async () => {
        const hands = players.map((p) => privOf(p).hand);
        const again = world.runtime();
        await again.load();
        const ana = players[0]!;
        await send(again, ana, { type: "ping", timestamp: 1 });
        const back = await join(world, again, "Ana", ana.last("welcome")!.resumeToken);
        expect(privOf(back).hand).toEqual(hands[0]);
        expect(gameOf(back).currentPlayerId).toBe(gameOf(ana).currentPlayerId);
      });

      it("plays to the end, lands in results, and can rematch with the next dealer", async () => {
        const firstDealer = gameOf(players[0]!).dealerId;
        for (let i = 0; roomOf(players[0]!).phase === "playing"; i++) {
          expect(i).toBeLessThan(200);
          const cur = current();
          const card = privOf(cur).playableCardIds[0]!;
          await send(room, cur, { type: "game-action", clientActionId: `a${i}`, action: { type: "play-card", cardId: card } });
        }
        const r = roomOf(players[0]!);
        expect(r.phase).toBe("results");
        expect(r.result?.winnerIds).toHaveLength(1);
        expect(r.awaitingPlayerIds).toEqual([]);

        await send(room, players[0]!, { type: "start-game" });
        expect(roomOf(players[0]!).phase).toBe("playing");
        expect(roomOf(players[0]!).roundNumber).toBe(2);
        const ids = roomOf(players[0]!).seats.map((s) => s.id);
        const nextDealer = gameOf(players[0]!).dealerId;
        expect(ids.indexOf(nextDealer)).toBe((ids.indexOf(firstDealer) + 1) % ids.length);
      });
    });

    it("arms grace first, then cleanup; returning cancels both", async () => {
      const a = await join(world, room, "Ana");
      expect(world.alarm).toBeNull();
      await world.disconnect(room, a);
      // One alarm, earliest timer wins: grace (60 s) before cleanup (6 h).
      expect(world.alarm).toBe(world.clock + GRACE_MS);

      await join(world, room, "Ana", a.last("welcome")!.resumeToken);
      expect(world.alarm).toBeNull();
    });

    it("wipes the room when cleanup fires, freeing the code", async () => {
      const a = await join(world, room, "Ana");
      await world.disconnect(room, a);
      world.clock += CLEANUP_AFTER_MS;
      await room.onAlarm();
      expect(world.store.size).toBe(0);
      expect(await room.claim()).toBe(true);
    });

    it("lets lobby players leave and hands host to the next-oldest seat", async () => {
      const a = await join(world, room, "Ana");
      const b = await join(world, room, "Ben");
      await send(room, a, { type: "leave" });
      expect(a.closed).not.toBeNull();
      expect(roomOf(b).hostId).toBe(b.last("welcome")!.playerId);
      expect(roomOf(b).seats).toHaveLength(1);
    });

    it("drops lobby seats that wandered off when the game starts", async () => {
      const ps = [];
      for (const n of ["A", "B", "C", "D"]) ps.push(await join(world, room, n));
      await world.disconnect(room, ps[3]!);
      await send(room, ps[0]!, { type: "start-game" });
      expect(roomOf(ps[0]!).seats).toHaveLength(3);
      expect(gameOf(ps[0]!).players).toHaveLength(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 2: surviving real phones
// ---------------------------------------------------------------------------

describe("presence, grace and host migration", () => {
  let world: World;
  let room: RoomRuntime;
  beforeEach(async () => {
    world = new World();
    room = world.runtime();
    await room.load();
    await room.claim();
  });

  it("lobby: grace expiry frees the seat and passes host on", async () => {
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    await world.disconnect(room, a);
    expect(roomOf(b).seats.find((s) => s.name === "Ana")!.presence).toBe("reconnecting");
    expect(roomOf(b).hostId).toBe(a.last("welcome")!.playerId); // host keeps it during grace

    await world.tick(room, GRACE_MS);
    expect(roomOf(b).seats.map((s) => s.name)).toEqual(["Ben"]);
    expect(roomOf(b).hostId).toBe(b.last("welcome")!.playerId);
  });

  it("reconnecting within grace keeps everything", async () => {
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    await world.disconnect(room, a);
    await world.tick(room, GRACE_MS - 1);
    const back = await join(world, room, "Ana", a.last("welcome")!.resumeToken);
    await world.tick(room, 10);
    expect(roomOf(b).seats.map((s) => s.presence)).toEqual(["connected", "connected"]);
    expect(roomOf(back).hostId).toBe(back.last("welcome")!.playerId);
  });

  it("host stays put when nobody else is connected, then moves to whoever returns", async () => {
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    const c = await join(world, room, "Cy");
    await send(room, a, { type: "start-game" });
    for (const p of [a, b, c]) await world.disconnect(room, p);
    await world.tick(room, GRACE_MS);
    const ben = await join(world, room, "Ben", b.last("welcome")!.resumeToken);
    expect(roomOf(ben).hostId).toBe(ben.last("welcome")!.playerId);
  });
});

describe("mid-game absence", () => {
  let world: World;
  let room: RoomRuntime;
  let ps: FakeConn[];

  const idOf = (c: FakeConn) => c.last("welcome")!.playerId;
  const observer = () => ps.find((p) => !p.closed)!;
  const current = () => {
    const id = gameOf(observer()).currentPlayerId;
    return ps.find((p) => idOf(p) === id)!;
  };
  const playOnce = async (p = current()) => {
    const card = privOf(p).playableCardIds[0]!;
    await send(room, p, { type: "game-action", clientActionId: "x", action: { type: "play-card", cardId: card } });
  };

  beforeEach(async () => {
    world = new World();
    room = world.runtime();
    await room.load();
    await room.claim();
    ps = [];
    for (const n of ["Ana", "Ben", "Cy", "Dee"]) ps.push(await join(world, room, n));
    await send(room, ps[0]!, { type: "start-game" });
  });

  it("grace expiry mid-game keeps seat and hand, marks them disconnected", async () => {
    const ben = ps[1]!;
    const hand = privOf(ben).hand;
    await world.disconnect(room, ben);
    await world.tick(room, GRACE_MS);
    expect(roomOf(ps[0]!).seats.find((s) => s.id === idOf(ben))!.presence).toBe("disconnected");

    const back = await join(world, room, "Ben", ben.last("welcome")!.resumeToken);
    expect(privOf(back).hand).toEqual(hand);
  });

  it("host migrates mid-game when the host's grace runs out", async () => {
    await world.disconnect(room, ps[0]!);
    await world.tick(room, GRACE_MS);
    expect(roomOf(ps[1]!).hostId).toBe(idOf(ps[1]!));
  });

  it("remove-player waits for grace, then ghosts their cards and locks them out", async () => {
    const victim = ps.find((p) => p !== ps[0])!;
    const token = victim.last("welcome")!.resumeToken;
    await world.disconnect(room, victim);

    await send(room, ps[0]!, { type: "remove-player", playerId: idOf(victim) });
    expect(ps[0]!.last("error")?.code).toBe("too-early");

    await world.tick(room, GRACE_MS);
    await send(room, ps[0]!, { type: "remove-player", playerId: idOf(victim) });
    const r = roomOf(ps[0]!);
    expect(r.seats.find((s) => s.id === idOf(victim))!.presence).toBe("left");
    expect(gameOf(ps[0]!).players.find((p) => p.id === idOf(victim))!.removed).toBe(true);
    expect(r.phase).toBe("playing");

    // Old token no longer resumes; they'd be a newcomer mid-game.
    const again = await join(world, room, "Ghost", token);
    expect(again.last("error")?.code).toBe("game-in-progress");
  });

  it("non-hosts can't remove or skip", async () => {
    await send(room, ps[1]!, { type: "remove-player", playerId: idOf(ps[2]!) });
    expect(ps[1]!.last("error")?.code).toBe("not-host");
    await send(room, ps[1]!, { type: "skip-turn", playerId: idOf(current()) });
    expect(ps[1]!.last("error")?.code).toBe("not-host");
  });

  it("leaving mid-game hands your cards to the board and play goes on", async () => {
    const leaver = ps[3]!;
    await send(room, leaver, { type: "leave" });
    expect(leaver.closed).not.toBeNull();
    ps = ps.filter((p) => p !== leaver);
    expect(roomOf(ps[0]!).seats.find((s) => s.id === idOf(leaver))!.presence).toBe("left");
    // Keep playing to the end with three.
    for (let i = 0; roomOf(ps[0]!).phase === "playing"; i++) {
      expect(i).toBeLessThan(200);
      await playOnce();
    }
    expect(roomOf(ps[0]!).result!.winnerIds[0]).not.toBe(idOf(leaver));
    // Standings still name the leaver; next game drops them.
    expect(roomOf(ps[0]!).seats.some((s) => s.id === idOf(leaver))).toBe(true);
    await send(room, ps[0]!, { type: "start-game" });
    expect(roomOf(ps[0]!).seats).toHaveLength(3);
  });

  it("the game ends when fewer than two players remain", async () => {
    await send(room, ps[3]!, { type: "leave" });
    await send(room, ps[2]!, { type: "leave" });
    expect(roomOf(ps[0]!).phase).toBe("playing");
    await send(room, ps[1]!, { type: "leave" });
    const r = roomOf(ps[0]!);
    expect(r.phase).toBe("results");
    expect(r.result!.winnerIds).toEqual([idOf(ps[0]!)]);
  });

  it("a host leaving mid-game hands host on", async () => {
    await send(room, ps[0]!, { type: "leave" });
    expect(roomOf(ps[1]!).hostId).toBe(idOf(ps[1]!));
  });

  describe("idle players (§12.2)", () => {
    it("nudges only after 30 s, only reach the awaited player, and are rate-limited", async () => {
      const cur = current();
      const other = ps.find((p) => p !== cur)!;
      await send(room, other, { type: "nudge" });
      expect(other.last("error")?.code).toBe("too-early");

      await world.tick(room, NUDGE_AFTER_MS);
      await send(room, other, { type: "nudge" });
      expect(cur.last("nudged")).toEqual({ type: "nudged", byPlayerId: idOf(other) });
      for (const p of ps) if (p !== cur) expect(p.last("nudged")).toBeUndefined();

      await send(room, other, { type: "nudge" });
      expect(other.last("error")?.code).toBe("rate-limited");
      await world.tick(room, NUDGE_COOLDOWN_MS);
      await send(room, other, { type: "nudge" });
      expect(cur.of("nudged")).toHaveLength(2);
    });

    it("you can't nudge yourself", async () => {
      await world.tick(room, NUDGE_AFTER_MS);
      await send(room, current(), { type: "nudge" });
      expect(current().last("error")?.code).toBe("too-early");
    });

    it("host can skip a connected player only after 60 s", async () => {
      const host = ps[0]!;
      const target = current() === host ? (await playOnce(host), current()) : current();
      await send(room, host, { type: "skip-turn", playerId: idOf(target) });
      expect(host.last("error")?.code).toBe("too-early");

      await world.tick(room, SKIP_AFTER_MS);
      await send(room, host, { type: "skip-turn", playerId: idOf(target) });
      expect(host.last("update")!.events).toContainEqual({ type: "turn-skipped", playerId: idOf(target) });
      expect(gameOf(host).currentPlayerId).not.toBe(idOf(target));
    });

    it("host can skip a dropped player straight away", async () => {
      const host = ps[0]!;
      if (current() === host) await playOnce(host);
      const target = current();
      await world.disconnect(room, target);
      await send(room, host, { type: "skip-turn", playerId: idOf(target) });
      expect(gameOf(host).currentPlayerId).not.toBe(idOf(target));
    });

    it("skipping someone whose turn it isn't is refused", async () => {
      const notCur = ps.find((p) => p !== current() && p !== ps[0])!;
      await world.tick(room, SKIP_AFTER_MS);
      await send(room, ps[0]!, { type: "skip-turn", playerId: idOf(notCur) });
      expect(ps[0]!.last("error")?.code).toBe("not-available");
    });

    it("the idle clock restarts on every move", async () => {
      const since = roomOf(ps[0]!).awaitingSince!;
      await world.tick(room, 5_000);
      await playOnce();
      expect(roomOf(ps[0]!).awaitingSince).toBe(since + 5_000);
    });
  });
});

describe("kicking from the lobby", () => {
  it("removes a connected player and tells them, fatally", async () => {
    const world = new World();
    const room = world.runtime();
    await room.load();
    await room.claim();
    const a = await join(world, room, "Ana");
    const b = await join(world, room, "Ben");
    await send(room, a, { type: "remove-player", playerId: b.last("welcome")!.playerId });
    expect(b.last("error")).toMatchObject({ code: "removed", fatal: true });
    expect(b.closed).not.toBeNull();
    expect(roomOf(a).seats.map((s) => s.name)).toEqual(["Ana"]);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: hardening
// ---------------------------------------------------------------------------

describe("hardening", () => {
  async function setup(opts: { devTools?: boolean; games?: Record<string, AnyGameDefinition> } = {}) {
    const world = new World();
    world.devTools = opts.devTools ?? false;
    const room = world.runtime(opts.games);
    await room.load();
    await room.claim();
    const ps: FakeConn[] = [];
    for (const n of ["Ana", "Ben", "Cy", "Dee"]) ps.push(await join(world, room, n));
    return { world, room, ps };
  }

  it("refuses oversized messages without parsing them", async () => {
    const { room, ps } = await setup();
    await room.onMessage(ps[0]!, JSON.stringify({ type: "join", name: "x".repeat(10_000), avatarSeed: "a" }));
    expect(ps[0]!.last("error")?.code).toBe("bad-message");
  });

  it("rolls back a half-applied transition when a game throws, and keeps going", async () => {
    let explode = false;
    const flaky: AnyGameDefinition = {
      ...sevensGame,
      // Runs after the runtime has already swapped in the new game state.
      getAwaitedPlayerIds: (st) => {
        if (explode) throw new Error("kaboom");
        return sevensGame.getAwaitedPlayerIds(st);
      },
    };
    const { world, room, ps } = await setup({ games: { sevens: flaky } });
    await send(room, ps[0]!, { type: "start-game" });

    const cur = ps.find((p) => p.last("welcome")!.playerId === gameOf(ps[0]!).currentPlayerId)!;
    const card = privOf(cur).playableCardIds[0]!;
    const version = cur.last("update")!.stateVersion;
    explode = true;
    await send(room, cur, { type: "game-action", clientActionId: "a", action: { type: "play-card", cardId: card } });
    expect(cur.last("error")).toMatchObject({ code: "server-error", fatal: false });
    expect(cur.last("error")!.message).not.toContain("kaboom");
    expect(world.errors).toHaveLength(1);
    expect(cur.last("update")!.stateVersion).toBe(version); // nothing was broadcast

    // The play never happened: retrying it works.
    explode = false;
    await send(room, cur, { type: "game-action", clientActionId: "b", action: { type: "play-card", cardId: card } });
    expect(cur.last("update")!.events[0]).toMatchObject({ type: "card-played", card: { id: card } });
  });

  it("a failed alarm rolls back and rethrows so the DO retries it", async () => {
    const { world, room, ps } = await setup();
    await world.disconnect(room, ps[3]!);
    world.clock += GRACE_MS;
    world.failNextPut = true;
    await expect(room.onAlarm()).rejects.toThrow("storage write failed");
    // Seat is still there (rolled back), and the retry succeeds.
    await room.onAlarm();
    expect(roomOf(ps[0]!).seats.map((s) => s.name)).toEqual(["Ana", "Ben", "Cy"]);
  });

  describe("debug-start (§41)", () => {
    it("is refused unless the server runs with dev tools", async () => {
      const { room, ps } = await setup();
      await send(room, ps[0]!, { type: "debug-start", seed: 1 });
      expect(ps[0]!.last("error")?.code).toBe("not-available");
      expect(roomOf(ps[0]!).phase).toBe("lobby");
    });

    it("is host-only", async () => {
      const { room, ps } = await setup({ devTools: true });
      await send(room, ps[1]!, { type: "debug-start", seed: 1 });
      expect(ps[1]!.last("error")?.code).toBe("not-host");
    });

    it("a seed reproduces the exact deal", async () => {
      const deal = async () => {
        const { room, ps } = await setup({ devTools: true });
        await send(room, ps[0]!, { type: "debug-start", seed: 1234 });
        return { dealer: gameOf(ps[0]!).dealerId, hands: ps.map((p) => privOf(p).hand.map((c) => c.id)) };
      };
      expect(await deal()).toEqual(await deal());
    });

    it("deals an exact deck order round-robin", async () => {
      const deck = makeDeck("high").map((c) => c.id).reverse();
      const { room, ps } = await setup({ devTools: true });
      await send(room, ps[0]!, { type: "debug-start", deck });
      const hand = new Set(privOf(ps[0]!).hand.map((c) => c.id));
      const offset = deck.findIndex((id) => hand.has(id));
      expect([...hand].sort()).toEqual(deck.filter((_, i) => i % 4 === offset % 4).sort());
    });

    it("explains a bad deck and stays in the lobby", async () => {
      const { room, ps } = await setup({ devTools: true });
      await send(room, ps[0]!, { type: "debug-start", deck: ["hearts-7", "hearts-7"] });
      expect(ps[0]!.last("error")).toMatchObject({ code: "bad-message" });
      expect(ps[0]!.last("error")!.message).toContain("52");
      expect(roomOf(ps[0]!).phase).toBe("lobby");
    });
  });
});
