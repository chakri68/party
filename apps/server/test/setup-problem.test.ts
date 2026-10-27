import type { AnyGameDefinition } from "@games/game-core";
import { nightfallGame } from "@games/nightfall/server";
import { sevensGame } from "@games/sevens/server";
import { shortNightGame } from "@games/short-night/server";
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { FakeConn, join, roomOf, send, World } from "./harness.ts";

// A game that only fits a table of exactly `size`, the way a role deck does.
// Any action finishes it, so the results screen is one move away.
const fussyGame: AnyGameDefinition = {
  manifest: { id: "fussy", name: "Fussy", description: "", minPlayers: 2, maxPlayers: 8, icon: "cards" },
  defaultSettings: { size: 3 },
  parseSettings: (s) => {
    const size = (s as { size?: unknown } | null)?.size;
    return typeof size === "number" && Number.isInteger(size) ? { size } : null;
  },
  parseAction: (a) => (a && typeof a === "object" ? a : null),
  createGame: (players) => ({ state: { players: players.map((p) => p.id), done: false }, events: [] }),
  handleAction: (st) => ({ ok: true, transition: { state: { ...st, done: true }, events: [] } }),
  setupProblem: (settings: { size: number }, playerCount) => (playerCount === settings.size ? null : `Need exactly ${settings.size}`),
  getPublicState: (st) => ({ players: st.players }),
  getPrivateState: () => null,
  getAwaitedPlayerIds: () => [],
  getResult: (st) => (st.done ? { winnerIds: [], standings: [] } : null),
};

describe("setupProblem", () => {
  let world: World;
  let room: RoomRuntime;
  let ps: FakeConn[];

  async function seat(names: string[]) {
    for (const n of names) ps.push(await join(world, room, n));
  }

  beforeEach(async () => {
    world = new World();
    room = new RoomRuntime("K7DX", world.host(), { fussy: fussyGame, sevens: sevensGame, nightfall: nightfallGame, "short-night": shortNightGame }, "fussy");
    await room.load();
    await room.claim();
    ps = [];
  });

  it("refuses to start a table the game says doesn't fit, and stays in the lobby", async () => {
    await seat(["Ana", "Ben", "Cy", "Dee"]);
    await send(room, ps[0]!, { type: "start-game" });
    expect(ps[0]!.last("error")).toMatchObject({ code: "bad-setup", message: "Need exactly 3", fatal: false });
    expect(roomOf(ps[1]!).phase).toBe("lobby");
  });

  it("publishes the problem in the lobby and drops it when the head count fits", async () => {
    await seat(["Ana", "Ben", "Cy", "Dee"]);
    expect(roomOf(ps[0]!).setupProblem).toBe("Need exactly 3");
    await send(room, ps[3]!, { type: "leave" });
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
    await send(room, ps[0]!, { type: "start-game" });
    expect(roomOf(ps[0]!).phase).toBe("playing");
  });

  it("brings the problem back when someone joins a table that fit", async () => {
    await seat(["Ana", "Ben", "Cy"]);
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
    await seat(["Dee"]);
    expect(roomOf(ps[0]!).setupProblem).toBe("Need exactly 3");
  });

  it("counts only seats that would be dealt in", async () => {
    await seat(["Ana", "Ben", "Cy", "Dee"]);
    await world.disconnect(room, ps[3]!);
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
  });

  it("reads the problem from the current settings", async () => {
    await seat(["Ana", "Ben", "Cy", "Dee"]);
    await send(room, ps[0]!, { type: "update-settings", settings: { size: 4 } });
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
    await send(room, ps[0]!, { type: "start-game" });
    expect(roomOf(ps[0]!).phase).toBe("playing");
  });

  it("a game without the hook has no problem and starts as before", async () => {
    await seat(["Ana", "Ben", "Cy", "Dee"]);
    await send(room, ps[0]!, { type: "select-game", gameId: "sevens" });
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
    await send(room, ps[0]!, { type: "start-game" });
    expect(roomOf(ps[0]!).phase).toBe("playing");
  });

  it("refuses Play again from results when the head count changed", async () => {
    await seat(["Ana", "Ben", "Cy"]);
    await send(room, ps[0]!, { type: "start-game" });
    await send(room, ps[0]!, { type: "game-action", clientActionId: "a", action: { type: "finish" } });
    expect(roomOf(ps[0]!).phase).toBe("results");
    expect(roomOf(ps[0]!).setupProblem).toBeNull();

    await send(room, ps[2]!, { type: "leave" });
    expect(roomOf(ps[0]!).setupProblem).toBe("Need exactly 3");
    await send(room, ps[0]!, { type: "start-game" });
    expect(ps[0]!.last("error")).toMatchObject({ code: "bad-setup", message: "Need exactly 3" });
    expect(roomOf(ps[0]!).phase).toBe("results");
  });

  it("stays quiet below the minimum head count: that's the lobby's own line", async () => {
    await seat(["Ana"]);
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
  });

  it("a lone host in a hidden-role room sees no setup problem", async () => {
    await seat(["Ana"]);
    for (const gameId of ["nightfall", "short-night"]) {
      await send(room, ps[0]!, { type: "select-game", gameId });
      expect(roomOf(ps[0]!).setupProblem).toBeNull();
    }
    await seat(["Ben"]);
    expect(roomOf(ps[0]!).setupProblem).toBeNull();
  });
});
