// Blackjack waits on several seats at once (everyone bets, then everyone
// plays). This plays a whole game through the room with computers, to check
// that they each move on their own timers and nobody gets called stuck.
import { blackjackGame } from "@games/blackjack/server";
import type { BlackjackPrivateState, BlackjackPublicState } from "@games/blackjack/shared";
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/runtime.ts";
import { join, roomOf, send, World } from "./harness.ts";

describe("Blackjack with computers in the room", () => {
  it("plays a whole game: a person and three computers at once", async () => {
    const world = new World();
    const room = new RoomRuntime("K7DX", world.host(), { blackjack: blackjackGame }, "blackjack");
    await room.load();
    await room.claim();
    const ana = await join(world, room, "Ana");
    for (let i = 0; i < 3; i++) await send(room, ana, { type: "add-bot" });
    await send(room, ana, { type: "start-game" });
    expect(roomOf(ana).phase).toBe("playing");

    let n = 0;
    let rounds = 0;
    for (let i = 0; i < 5000 && roomOf(ana).phase === "playing"; i++) {
      const game = roomOf(ana).game as BlackjackPublicState;
      rounds = Math.max(rounds, game.round);
      const priv = ana.last("update")!.private as BlackjackPrivateState | null;
      if (priv?.bet) await send(room, ana, { type: "game-action", clientActionId: `a${n++}`, action: { type: "bet", amount: 10 } });
      else if (priv?.moves) await send(room, ana, { type: "game-action", clientActionId: `a${n++}`, action: { type: "stand", hand: priv.moves.hand } });
      else await world.tick(room, 250);
    }
    expect(roomOf(ana).phase).toBe("results");
    expect(rounds).toBe(10);
    expect(world.errors).toEqual([]);
  });

  it("computers keep playing while the person sits out", async () => {
    const world = new World();
    const room = new RoomRuntime("K7DX", world.host(), { blackjack: blackjackGame }, "blackjack");
    await room.load();
    await room.claim();
    const ana = await join(world, room, "Ana");
    await send(room, ana, { type: "add-bot" });
    await send(room, ana, { type: "add-bot" });
    await send(room, ana, { type: "start-game" });
    for (let i = 0; i < 20000 && roomOf(ana).phase === "playing"; i++) await world.tick(room, 250);
    expect(roomOf(ana).phase).toBe("results");
    expect(world.errors).toEqual([]);
  });
});
