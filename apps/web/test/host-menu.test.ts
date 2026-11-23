import type { RoomPublicState, SeatPublic } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { leaveQuestion, nextHost, seatActionMessage, seatActions } from "../src/views/host-menu.ts";

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

describe("leaving the room", () => {
  const at = (phase: RoomPublicState["phase"], seats: SeatPublic[], hostId = "amy") => ({ hostId, phase, seats }) as RoomPublicState;
  const amy = seat("amy", { name: "Amy", joinedAt: 1 });

  it("passes the host role to the connected person who joined first, never a computer", () => {
    const seats = [
      amy,
      seat("bot", { name: "Bot", bot: true, joinedAt: 2 }),
      seat("cat", { name: "Cat", joinedAt: 5 }),
      seat("ben", { joinedAt: 3, presence: "reconnecting" }),
      seat("dan", { name: "Dan", joinedAt: 4 }),
    ];
    expect(nextHost(at("lobby", seats), "amy")?.id).toBe("dan");
  });

  it("with nobody connected, names the first other person seated", () => {
    const seats = [amy, seat("ben", { presence: "reconnecting" }), seat("cat", { presence: "disconnected" })];
    expect(nextHost(at("lobby", seats), "amy")?.id).toBe("ben");
    expect(nextHost(at("lobby", [amy, seat("bot", { bot: true })]), "amy")).toBeNull();
  });

  it("a player in the lobby leaves without a question", () => {
    expect(leaveQuestion(at("lobby", [amy, seat("ben")]), "ben")).toBeNull();
    expect(leaveQuestion(at("results", [amy, seat("ben")]), "ben")).toBeNull();
  });

  it("the host in the lobby is told who gets the room", () => {
    expect(leaveQuestion(at("lobby", [amy, seat("ben")]), "amy")).toBe("Leave the room? Ben will be the host.");
    expect(leaveQuestion(at("lobby", [amy]), "amy")).toBe("Leave the room? No other person is here. The room stays open for a few hours.");
  });

  it("in a game, everyone is asked; the host also hears who gets the room", () => {
    expect(leaveQuestion(at("playing", [amy, seat("ben")]), "ben")).toBe("Leave the game? You will be out for the rest of this round.");
    expect(leaveQuestion(at("playing", [amy, seat("ben")]), "amy")).toBe(
      "Leave the game? You will be out for the rest of this round. Ben will be the host.",
    );
  });

  it("once the party is over, nobody is asked", () => {
    expect(leaveQuestion(at("ended", [amy, seat("ben")]), "amy")).toBeNull();
  });
});
