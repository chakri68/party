import type { RoomPublicState, SeatPublic } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { seatActionMessage, seatActions } from "../src/views/host-menu.ts";

const seat = (id: string, extra: Partial<SeatPublic> = {}): SeatPublic => ({
  id,
  name: id === "ben" ? "Ben" : id,
  avatarSeed: id,
  ready: false,
  presence: "connected",
  joinedAt: 0,
  ...extra,
});
const room = (hostId: string): RoomPublicState => ({ hostId }) as RoomPublicState;

describe("the seat menu", () => {
  it("is empty for a viewer who is not the host", () => {
    expect(seatActions(room("amy"), "cat", seat("ben"))).toEqual([]);
  });

  it("is empty for the host on their own seat", () => {
    expect(seatActions(room("amy"), "amy", seat("amy"))).toEqual([]);
  });

  it("offers Make host, then Remove, for a connected person", () => {
    const acts = seatActions(room("amy"), "amy", seat("ben"));
    expect(acts.map((a) => a.kind)).toEqual(["make-host", "remove"]);
    expect(acts.map((a) => a.confirm)).toEqual(["Make Ben the host?", "Remove Ben from the room?"]);
    expect(acts.map((a) => a.danger)).toEqual([false, true]);
  });

  it("offers only Remove for a reconnecting person", () => {
    const acts = seatActions(room("amy"), "amy", seat("ben", { presence: "reconnecting" }));
    expect(acts.map((a) => a.kind)).toEqual(["remove"]);
  });

  it("offers Remove without a question for a computer", () => {
    const acts = seatActions(room("amy"), "amy", seat("ben", { bot: true }));
    expect(acts.map((a) => a.kind)).toEqual(["remove"]);
    expect(acts[0]?.confirm).toBeNull();
  });

  it("builds the message for each action", () => {
    const ben = seat("ben");
    expect(seatActionMessage("make-host", ben)).toEqual({ type: "transfer-host", playerId: "ben" });
    expect(seatActionMessage("remove", ben)).toEqual({ type: "remove-player", playerId: "ben" });
  });
});
