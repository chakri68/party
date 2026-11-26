import { TABLE_KEYS, type TableLog } from "@games/game-core";
import { GRACE_MS, VOICE_TALK_LIMIT } from "@games/protocol";
import { FREE_SOUND_IDS } from "@games/sounds/list";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { TABLE_PERSIST_MS, TALK_BURST_CAP_MS } from "../src/table.ts";
import { plainGame, TOY_WINDOW_MS, toyGame, toyKnobs } from "./bot-toy.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

const games = { toy: toyGame, plain: plainGame };
const FREE = [...FREE_SOUND_IDS][0]!;

describe("table counts through the room", () => {
  let world: World;
  let room: RoomRuntime;
  let a: FakeConn;
  let b: FakeConn;
  const idOf = (c: FakeConn) => c.last("welcome")!.playerId;
  const vjoin = (c: FakeConn, count = true, muted = false) => send(room, c, { type: "voice-join", muted, count });
  const on = (c: FakeConn) => send(room, c, { type: "voice-talk", on: true });
  const off = (c: FakeConn, peak = 0.5) => send(room, c, { type: "voice-talk", on: false, peak });
  /** In memory: what the next write would store. */
  const live = () => (room as unknown as { data: { party?: { table?: TableLog; names: Record<string, string> } } }).data.party;
  const seatOf = (c: FakeConn) => live()?.table?.seats[idOf(c)] ?? {};
  const stored = () => world.store.get("room") as { party?: { table?: TableLog; names: Record<string, string> } };
  const connFor = (id: string) => [a, b].find((c) => idOf(c) === id)!;

  /** Talk for `ms`. */
  async function talk(c: FakeConn, ms: number, peak = 0.5) {
    await on(c);
    await world.tick(room, ms);
    await off(c, peak);
  }

  /** Plays the toy game to its call window (nobody awaited), then optionally to results. Returns the winner. */
  async function playToWindow(): Promise<FakeConn> {
    let last: FakeConn = a;
    while (roomOf(a).awaitingPlayerIds.length) {
      last = connFor(roomOf(a).awaitingPlayerIds[0]!);
      await send(room, last, { type: "game-action", clientActionId: `x${Math.random()}`, action: { type: "add", n: 2 } });
    }
    return last;
  }

  beforeEach(async () => {
    toyKnobs.decide = "normal";
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await room.claim();
    a = await join(world, room, "Ana");
    b = await join(world, room, "Ben");
  });

  it("times a burst on the room clock and keeps it in the stored party log", async () => {
    await vjoin(a);
    await talk(a, 10_000);
    await send(room, a, { type: "chat", text: "gg" }); // a normal save
    expect(stored().party!.table!.seats[idOf(a)]!.talkMs).toBe(10_000);
    expect(stored().party!.table!.counted).toEqual([idOf(a)]);
    expect(stored().party!.names[idOf(a)]).toBe("Ana");
  });

  it("talk sends nothing to any phone and writes at most once per 30 s", async () => {
    await vjoin(a);
    await vjoin(b);
    const before = [a.inbox.length, b.inbox.length];
    const puts = world.puts;
    await talk(a, 10_000);
    expect([a.inbox.length, b.inbox.length]).toEqual(before);
    expect(world.puts).toBe(puts);
    await world.tick(room, TABLE_PERSIST_MS);
    await talk(a, 1_000);
    expect(world.puts).toBe(puts + 1);
    expect([a.inbox.length, b.inbox.length]).toEqual(before);
    expect(stored().party!.table!.seats[idOf(a)]!.talkMs).toBe(11_000);
  });

  it("counts nothing from a seat out of voice, muted, or not counting", async () => {
    await talk(a, 5_000); // not in voice
    await vjoin(b, false);
    await talk(b, 5_000); // counting off
    expect(seatOf(a).talkMs).toBeUndefined();
    expect(seatOf(b).talkMs).toBeUndefined();

    await vjoin(a, true, true); // joined muted
    await talk(a, 5_000);
    expect(seatOf(a).talkMs).toBeUndefined();

    await send(room, b, { type: "voice-count", on: true });
    await send(room, a, { type: "host-mute", playerId: idOf(b), muted: true });
    await talk(b, 5_000);
    expect(seatOf(b).talkMs).toBeUndefined();
  });

  it("voice-count turns counting on and off, and is stored", async () => {
    await vjoin(a, false);
    await send(room, a, { type: "voice-count", on: true });
    expect(stored().party!.table!.sessions).toHaveProperty(idOf(a));
    await talk(a, 2_000);
    await send(room, a, { type: "voice-count", on: false });
    expect(stored().party!.table!.sessions).not.toHaveProperty(idOf(a));
    await talk(a, 2_000);
    expect(seatOf(a).talkMs).toBe(2_000);
  });

  it("a disconnect mid-burst closes it, up to the cap", async () => {
    await vjoin(b);
    await on(b);
    await world.tick(room, TALK_BURST_CAP_MS);
    await world.disconnect(room, b);
    await world.tick(room, GRACE_MS);
    expect(a.last("voice-state")!.members).toEqual([]);
    expect(stored().party!.table!.seats[idOf(b)]!.talkMs).toBe(TALK_BURST_CAP_MS);
    expect(stored().party!.table!.sessions).toEqual({});
  });

  it("a host mute mid-burst counts up to the mute", async () => {
    await vjoin(b);
    await on(b);
    await world.tick(room, 7_000);
    await send(room, a, { type: "host-mute", playerId: idOf(b), muted: true });
    await world.tick(room, 20_000);
    await off(b);
    expect(stored().party!.table!.seats[idOf(b)]!.talkMs).toBe(7_000);
  });

  it("leaving voice closes the burst and the session", async () => {
    await vjoin(b);
    await on(b);
    await world.tick(room, 3_000);
    await send(room, b, { type: "voice-leave" });
    expect(stored().party!.table!.seats[idOf(b)]).toMatchObject({ talkMs: 3_000, voiceMs: 3_000 });
  });

  it("a session stored before the room woke is closed once the seat is gone", async () => {
    await vjoin(b);
    // A fresh runtime, as after hibernation: no bursts in memory, the session only in storage.
    room = new RoomRuntime("K7DX", world.host(), games, "toy");
    await room.load();
    await world.tick(room, 4_000);
    await send(room, a, { type: "remove-player", playerId: idOf(b) });
    expect(stored().party!.table!.seats[idOf(b)]!.voiceMs).toBe(4_000);
    expect(stored().party!.table!.sessions).toEqual({});
  });

  it("talk on someone else's turn counts as off-turn; on mine or with nobody awaited it doesn't", async () => {
    await vjoin(a);
    await vjoin(b);
    await send(room, a, { type: "start-game" });
    const turn = connFor(roomOf(a).awaitingPlayerIds[0]!);
    const other = turn === a ? b : a;
    await talk(other, 4_000);
    await talk(turn, 3_000);
    expect(seatOf(other)).toMatchObject({ talkMs: 4_000, offTurnMs: 4_000 });
    expect(seatOf(turn).offTurnMs).toBeUndefined();

    await playToWindow();
    expect(roomOf(a).awaitingPlayerIds).toEqual([]);
    await talk(other, 2_000);
    expect(seatOf(other)).toMatchObject({ talkMs: 6_000, offTurnMs: 4_000 });
  });

  it("talk on results after a win counts as win talk", async () => {
    await vjoin(a);
    await vjoin(b);
    await send(room, a, { type: "start-game" });
    const winner = await playToWindow();
    await world.tick(room, TOY_WINDOW_MS);
    expect(roomOf(a).phase).toBe("results");
    const loser = winner === a ? b : a;
    await talk(winner, 5_000);
    await talk(loser, 5_000);
    expect(seatOf(winner).winTalkMs).toBe(5_000);
    expect(seatOf(loser).winTalkMs).toBeUndefined();
  });

  it("counts sounds relayed, reactions and chat lines", async () => {
    await send(room, a, { type: "sound", id: `free:${FREE}` });
    await send(room, a, { type: "sound", id: `free:${FREE}` }); // cooldown drops it
    expect(a.of("sound")).toHaveLength(1);
    await send(room, a, { type: "emote", emoji: "🔥" });
    await send(room, a, { type: "chat", text: "gg" });
    await send(room, b, { type: "react", messageId: 0, emoji: "🔥" });
    await send(room, b, { type: "react", messageId: 0, emoji: "🔥" }); // takes it back
    expect(seatOf(a)).toEqual({ sounds: 1, reactions: 1, chats: 1 });
    expect(seatOf(b)).toEqual({ reactions: 1 });
    expect(live()!.names).toMatchObject({ [idOf(a)]: "Ana", [idOf(b)]: "Ben" });
    expect(stored().party!.table!.seats[idOf(a)]!.chats).toBe(1);
  });

  it("sound and emote counts are saved at most once per 30 s", async () => {
    await world.tick(room, TABLE_PERSIST_MS);
    let puts = world.puts;
    await send(room, a, { type: "sound", id: `free:${FREE}` });
    expect(world.puts).toBe(puts + 1);
    expect(stored().party!.table!.seats[idOf(a)]!.sounds).toBe(1);
    puts = world.puts;
    await send(room, a, { type: "emote", emoji: "🔥" });
    expect(world.puts).toBe(puts);
    await world.tick(room, TABLE_PERSIST_MS);
    await send(room, a, { type: "emote", emoji: "🔥" });
    expect(world.puts).toBe(puts + 1);
    expect(stored().party!.table!.seats[idOf(a)]!.reactions).toBe(2);
  });

  it("End party closes open bursts and sessions, and the recap has them", async () => {
    await vjoin(a);
    const joined = world.clock;
    await send(room, a, { type: "start-game" });
    await playToWindow();
    await world.tick(room, TOY_WINDOW_MS);
    expect(roomOf(a).phase).toBe("results");
    await talk(a, TALK_BURST_CAP_MS);
    await on(a);
    await world.tick(room, TALK_BURST_CAP_MS);
    await send(room, a, { type: "end-party" });
    const log = stored().party!.table!;
    expect(log.seats[idOf(a)]!.talkMs).toBe(2 * TALK_BURST_CAP_MS);
    expect(log.seats[idOf(a)]!.voiceMs).toBe(world.clock - joined);
    expect(log.sessions).toEqual({});
    const recap = roomOf(a).recap!;
    expect(recap.table.find((x) => x.id === "chatty")).toMatchObject({ who: ["Ana"], line: "Talked for 4 minutes." });
  });

  it("never puts table counts in room state", async () => {
    await vjoin(a);
    await vjoin(b);
    await talk(a, 2_000);
    await send(room, a, { type: "chat", text: "hi" });
    await send(room, a, { type: "start-game" });
    await talk(a, 2_000);
    const late = await join(world, room, "Cy"); // gets a snapshot
    for (const c of [a, b, late]) {
      // The room's "sounds" flag and a chat line's "reactions" share names, but never hold counts.
      const text = JSON.stringify(c.inbox);
      for (const key of TABLE_KEYS) expect(text).not.toMatch(new RegExp(`"${key}":[0-9]`));
      expect(text).not.toContain("talkMs");
    }
  });

  it("drops talk messages over the limit", async () => {
    await vjoin(a);
    const pairs = VOICE_TALK_LIMIT.burst / 2;
    for (let i = 0; i < pairs; i++) await talk(a, 100);
    await talk(a, 100); // over the limit: neither counted
    expect(seatOf(a).talkMs).toBe(pairs * 100);
  });
});
