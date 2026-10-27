// The room runtime's test fakes: an in-memory Durable Object host, sockets that
// keep what they're sent, and a hand-cranked clock. Shared by every runtime test.

import { seededRandomInt, type AnyGameDefinition } from "@games/game-core";
import { PROTOCOL_VERSION, type ServerMessage } from "@games/protocol";
import { sevensGame } from "@games/sevens/server";
import { RoomRuntime, type Conn, type ConnState, type RoomHost } from "../src/runtime.ts";


// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

export class FakeConn implements Conn {
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

export class World {
  store = new Map<string, unknown>();
  alarm: number | null = null;
  conns: FakeConn[] = [];
  clock = 1_000_000;
  devTools = false;
  /** Off by default so older tests don't all need an owner; the gate has its own tests. */
  ownerRequired = false;
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
      isOwnerKey: (key) => key === OWNER_KEY,
      ownerRequired: this.ownerRequired,
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

export const send = (room: RoomRuntime, c: Conn, msg: object) => room.onMessage(c, JSON.stringify(msg));

export const OWNER_KEY = "correct-horse-battery-staple";

export async function join(world: World, room: RoomRuntime, name: string, resumeToken?: string, ownerKey?: string) {
  const c = await world.connect(room);
  await send(room, c, { type: "hello", protocolVersion: PROTOCOL_VERSION });
  await send(room, c, { type: "join", name, avatarSeed: name, resumeToken, ownerKey });
  return c;
}

export const roomOf = (c: FakeConn) => c.last("update")!.room;
