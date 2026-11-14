import type { AnyGameDefinition } from "@games/game-core";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

// The actor wins on "win". Each "lie" counts against them. A computer player
// ("bot") sits in every game, the way Dominion's do: winner sometimes, never awarded.
const coinGame: AnyGameDefinition = {
  manifest: { id: "coin", name: "Coin", description: "", minPlayers: 2, maxPlayers: 3, icon: "cards" },
  defaultSettings: {},
  parseSettings: () => ({}),
  parseAction: (a) => (a && typeof a === "object" ? a : null),
  createGame: (players) => ({ state: { players: players.map((p) => p.id), winner: null, stats: {} }, events: [] }),
  handleAction: (st, pid, a: { type: string }) => {
    const next = structuredClone(st);
    if (a.type === "win") next.winner = pid;
    if (a.type === "bot") next.winner = "bot";
    if (a.type === "lie") next.stats[pid] = { liesTold: (next.stats[pid]?.liesTold ?? 0) + 1 };
    if (a.type === "lie") next.stats.bot = { liesTold: 9 };
    return { ok: true, transition: { state: next, events: [] } };
  },
  getPublicState: (st) => ({ players: st.players }),
  getPrivateState: () => null,
  getAwaitedPlayerIds: (st) => st.players,
  getResult: (st) =>
    st.winner
      ? { winnerIds: [st.winner], standings: [...st.players, "bot"].map((playerId: string) => ({ playerId, value: 0 })), names: { bot: "Robo" } }
      : null,
  partyStats: (st) => st.stats,
};

const act = (room: RoomRuntime, c: FakeConn, type: string) =>
  send(room, c, { type: "game-action", clientActionId: `x${Math.random()}`, action: { type } });

describe("party log and End party", () => {
  let world: World;
  let room: RoomRuntime;
  let ps: FakeConn[];

  /** Host is ps[0]. */
  async function seat(...names: string[]) {
    for (const n of names) ps.push(await join(world, room, n));
  }

  async function playOne(winner: FakeConn, ...lies: FakeConn[]) {
    await send(room, ps[0]!, { type: "start-game" });
    for (const l of lies) await act(room, l, "lie");
    await act(room, winner, "win");
  }

  const stored = () => world.store.get("room") as { party?: { games: { winnerIds: string[]; players: string[]; stats: object }[]; names: Record<string, string> } };

  beforeEach(async () => {
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), { coin: coinGame }, "coin");
    await room.load();
    await room.claim();
    ps = [];
  });

  it("logs a finished game once, without the computer player", async () => {
    await seat("Ana", "Ben");
    await playOne(ps[1]!, ps[0]!);
    expect(roomOf(ps[0]!).phase).toBe("results");
    await send(room, ps[0]!, { type: "return-to-lobby" });
    const party = stored().party!;
    expect(party.games).toHaveLength(1);
    const ids = roomOf(ps[0]!).seats.map((s) => s.id);
    expect(party.games[0]).toMatchObject({ gameId: "coin", players: ids, winnerIds: [ids[1]], stats: { [ids[0]!]: { liesTold: 1 } } });
    expect(party.names).toEqual({ [ids[0]!]: "Ana", [ids[1]!]: "Ben" });
  });

  it("drops a computer winner from the log", async () => {
    await seat("Ana", "Ben");
    await send(room, ps[0]!, { type: "start-game" });
    await act(room, ps[0]!, "bot");
    expect(stored().party!.games[0]!.winnerIds).toEqual([]);
  });

  it("logs nothing for a game ended early", async () => {
    await seat("Ana", "Ben");
    await send(room, ps[0]!, { type: "start-game" });
    await send(room, ps[0]!, { type: "return-to-lobby" });
    expect(stored().party?.games ?? []).toHaveLength(0);
  });

  it("refuses End party from a player, and mid-game", async () => {
    await seat("Ana", "Ben");
    await send(room, ps[1]!, { type: "end-party" });
    expect(ps[1]!.last("error")).toMatchObject({ code: "not-host" });
    await send(room, ps[0]!, { type: "start-game" });
    await send(room, ps[0]!, { type: "end-party" });
    expect(ps[0]!.last("error")).toMatchObject({ code: "wrong-phase" });
    expect(roomOf(ps[0]!).phase).toBe("playing");
  });

  it("ends the party: everyone gets the recap, games are refused, chat still works", async () => {
    await seat("Ana", "Ben");
    await playOne(ps[1]!);
    await send(room, ps[0]!, { type: "start-game" });
    await act(room, ps[1]!, "win");
    world.clock += 30 * 60_000;
    await send(room, ps[0]!, { type: "end-party" });

    for (const p of ps) {
      const r = roomOf(p);
      expect(r.phase).toBe("ended");
      expect(r.game).toBeNull();
      expect(r.recap).toMatchObject({ gamesPlayed: 2, minutes: 30, topGameId: "coin", awards: [{ id: "champion", who: ["Ben"] }] });
    }
    for (const type of ["start-game", "return-to-lobby"]) {
      await send(room, ps[0]!, { type });
      expect(ps[0]!.last("error")).toMatchObject({ code: "wrong-phase" });
    }
    await send(room, ps[0]!, { type: "select-game", gameId: "coin" });
    expect(ps[0]!.last("error")).toMatchObject({ code: "wrong-phase" });
    await send(room, ps[1]!, { type: "ready", ready: true });
    expect(ps[1]!.last("error")).toMatchObject({ code: "wrong-phase" });
    await send(room, ps[1]!, { type: "chat", text: "gg" });
    expect(ps[0]!.last("chat")!.messages.at(-1)).toMatchObject({ text: "gg" });
    expect(roomOf(ps[0]!).phase).toBe("ended");
  });

  it("stays ended when the host goes and someone else takes over", async () => {
    await seat("Ana", "Ben");
    await playOne(ps[1]!);
    await send(room, ps[0]!, { type: "end-party" });
    await send(room, ps[0]!, { type: "leave" });
    expect(roomOf(ps[1]!).hostId).toBe(roomOf(ps[1]!).seats[0]!.id);
    await send(room, ps[1]!, { type: "start-game" });
    expect(ps[1]!.last("error")).toMatchObject({ code: "wrong-phase" });
    expect(roomOf(ps[1]!).phase).toBe("ended");
  });

  it("lets a late joiner see the recap, even with the room full", async () => {
    await seat("Ana", "Ben", "Cy");
    await playOne(ps[2]!);
    await send(room, ps[0]!, { type: "end-party" });
    const late = await join(world, room, "Dee");
    expect(late.closed).toBeNull();
    expect(roomOf(late)).toMatchObject({ phase: "ended", recap: { gamesPlayed: 1 } });
  });

  it("closes with no recap when nothing finished", async () => {
    await seat("Ana", "Ben");
    await send(room, ps[0]!, { type: "end-party" });
    expect(roomOf(ps[1]!)).toMatchObject({ phase: "ended", recap: null });
  });

  it("has no recap before the party ends", async () => {
    await seat("Ana", "Ben");
    await playOne(ps[1]!);
    expect(roomOf(ps[0]!).recap).toBeNull();
  });

  it("keeps the last 50 games", async () => {
    await seat("Ana", "Ben");
    for (let i = 0; i < 52; i++) await playOne(ps[1]!);
    expect(stored().party!.games).toHaveLength(50);
  });

  it("logs into a room stored before the party log existed", async () => {
    await seat("Ana", "Ben");
    const old = world.store.get("room") as Record<string, unknown>;
    delete old.party;
    room = new RoomRuntime("K7DX", world.host(), { coin: coinGame }, "coin");
    await room.load();
    ps = [await join(world, room, "Ana", ps[0]!.last("welcome")!.resumeToken), await join(world, room, "Ben", ps[1]!.last("welcome")!.resumeToken)];
    await playOne(ps[1]!);
    expect(stored().party!.games).toHaveLength(1);
  });
});
