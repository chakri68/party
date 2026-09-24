import { seededRandomInt } from "@games/game-core";
import { PROTOCOL_VERSION, type ServerMessage } from "@games/protocol";
import { sevensGame } from "@games/sevens/server";
import type { SevensPrivateState, SevensPublicState } from "@games/sevens/shared";
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
  private nextId = 0;
  private rng = seededRandomInt(42);

  host(): RoomHost {
    return {
      storage: {
        get: async <T>(k: string) => structuredClone(this.store.get(k)) as T | undefined,
        put: async (k, v) => void this.store.set(k, structuredClone(v)),
        deleteAll: async () => this.store.clear(),
        setAlarm: async (at) => void (this.alarm = at),
        deleteAlarm: async () => void (this.alarm = null),
      },
      connections: () => this.conns.filter((c) => !c.closed),
      now: () => this.clock,
      randomInt: (max) => this.rng(max),
      // Unique in the first 12 chars too: seat ids are token prefixes.
      randomToken: () => `t${(this.nextId++).toString().padStart(4, "0")}-fake-token-xyz`,
    };
  }

  runtime() {
    return new RoomRuntime("K7DX", this.host(), { sevens: sevensGame }, "sevens");
  }

  async connect(room: RoomRuntime): Promise<FakeConn> {
    const c = new FakeConn(`c${this.conns.length}`);
    this.conns.push(c);
    await room.onConnect(c);
    return c;
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

    it("schedules cleanup when the last player leaves, cancels it on return", async () => {
      const a = await join(world, room, "Ana");
      expect(world.alarm).toBeNull();
      await world.disconnect(room, a);
      expect(world.alarm).toBe(world.clock + CLEANUP_AFTER_MS);

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
