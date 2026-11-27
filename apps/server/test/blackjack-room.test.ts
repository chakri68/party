// Blackjack waits on several seats at once (everyone bets, then everyone
// plays). This plays a whole game through the room with computers, to check
// that they each move on their own timers and nobody gets called stuck.
import { blackjackGame } from "@games/blackjack/server";
import type { BlackjackPrivateState, BlackjackPublicState } from "@games/blackjack/shared";
import { seededRandomInt } from "@games/game-core";
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
      else if (priv?.moves) await send(room, ana, { type: "game-action", clientActionId: `a${n++}`, action: { type: "stand", hand: priv.moves.hand, cards: priv.moves.cards } });
      else await world.tick(room, 250);
    }
    expect(roomOf(ana).phase).toBe("results");
    expect(rounds).toBe(10);
    expect(world.errors).toEqual([]);
  }, 30_000);

  it("one computer plays a whole 20-round game while the person never moves", async () => {
    // Only the clock moves the game on between the computer's moves, so its
    // moves never pile up into one run the room would call stuck.
    for (let seed = 1; seed <= 12; seed++) {
      const world = new World();
      (world as unknown as { rng: (max: number) => number }).rng = seededRandomInt(seed);
      const room = new RoomRuntime("K7DX", world.host(), { blackjack: blackjackGame }, "blackjack");
      await room.load();
      await room.claim();
      const ana = await join(world, room, "Ana");
      await send(room, ana, { type: "update-settings", settings: { rounds: 20 } });
      await send(room, ana, { type: "add-bot" });
      await send(room, ana, { type: "start-game" });
      for (let i = 0; i < 40000 && roomOf(ana).phase === "playing"; i++) await world.tick(room, 250);
      expect(roomOf(ana).phase, `seed ${seed}`).toBe("results");
      expect(ana.last("error"), `seed ${seed}`).toBeUndefined();
      expect(world.errors, `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it("a person sitting out taps Play next round, and the next betting waits for them", async () => {
    const world = new World();
    const room = new RoomRuntime("K7DX", world.host(), { blackjack: blackjackGame }, "blackjack");
    await room.load();
    await room.claim();
    const ana = await join(world, room, "Ana");
    await send(room, ana, { type: "add-bot" });
    await send(room, ana, { type: "start-game" });
    const game = () => roomOf(ana).game as BlackjackPublicState;
    const me = () => game().players.find((p) => p.id === ana.last("welcome")!.playerId)!;
    const priv = () => ana.last("update")!.private as BlackjackPrivateState;
    // Ana misses two bets: she is sitting out, and the computer's bet alone deals.
    for (let i = 0; i < 2000 && !me().sittingOut; i++) await world.tick(room, 250);
    expect(me().sittingOut).toBe(true);
    for (let i = 0; i < 2000 && game().step === "betting"; i++) await world.tick(room, 250);
    expect(game().step).not.toBe("betting");
    expect(priv().canBack).toBe(true);
    await send(room, ana, { type: "game-action", clientActionId: "b1", action: { type: "back" } });
    expect(me().sittingOut).toBe(false);
    for (let i = 0; i < 2000 && game().step !== "betting"; i++) await world.tick(room, 250);
    const round = game().round;
    // Well past the computer's think time: the table still waits on Ana.
    await world.tick(room, 5000);
    expect(game()).toMatchObject({ step: "betting", round });
    expect(roomOf(ana).awaitingPlayerIds).toEqual([ana.last("welcome")!.playerId]);
    expect(priv().bet).not.toBeNull();
    expect(world.errors).toEqual([]);
  }, 30_000);

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
  }, 30_000);
});
