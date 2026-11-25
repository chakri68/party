import type { RoomPublicState, SeatPublic } from "@games/protocol";
import { describe, expect, it } from "vitest";
import { leaveQuestion, muteAllActions, nextHost, seatActionMessage, seatActions } from "../src/views/host-menu.ts";

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

describe("host mute in the seat menu", () => {
  it("a seat in voice gets Mute first, with no question", () => {
    const acts = seatActions(room("amy"), "amy", seat("ben"), { hostMuted: false });
    expect(acts.map((a) => a.kind)).toEqual(["mute", "make-host", "remove"]);
    expect(acts[0]).toEqual({ kind: "mute", label: "Mute", confirm: null, danger: false });
  });

  it("a host-muted seat gets Allow to talk", () => {
    const acts = seatActions(room("amy"), "amy", seat("ben"), { hostMuted: true });
    expect(acts.map((a) => a.kind)).toEqual(["allow-talk", "make-host", "remove"]);
    expect(acts[0]).toEqual({ kind: "allow-talk", label: "Allow to talk", confirm: null, danger: false });
  });

  it("no voice actions without a voice entry, for myself, or for a non-host", () => {
    const kinds = (r: RoomPublicState, me: string, s: SeatPublic, v?: { hostMuted: boolean } | null) => seatActions(r, me, s, v).map((a) => a.kind);
    expect(kinds(room("amy"), "amy", seat("ben"))).toEqual(["make-host", "remove"]);
    expect(kinds(room("amy"), "amy", seat("ben"), null)).toEqual(["make-host", "remove"]);
    expect(kinds(room("amy"), "amy", seat("amy"), { hostMuted: false })).toEqual([]);
    expect(kinds(room("amy"), "cat", seat("ben"), { hostMuted: false })).toEqual([]);
  });

  it("mute and allow-talk send host-mute", () => {
    const ben = seat("ben");
    expect(seatActionMessage("mute", ben)).toEqual({ type: "host-mute", playerId: "ben", muted: true });
    expect(seatActionMessage("allow-talk", ben)).toEqual({ type: "host-mute", playerId: "ben", muted: false });
  });

  it("muteAllActions: empty with nobody else in voice or when not host", () => {
    const amyIn = { id: "amy", hostMuted: false };
    const benIn = { id: "ben", hostMuted: false };
    expect(muteAllActions(room("amy"), "amy", [])).toEqual([]);
    expect(muteAllActions(room("amy"), "amy", [amyIn])).toEqual([]);
    expect(muteAllActions(room("amy"), "ben", [amyIn, benIn])).toEqual([]);
    expect(muteAllActions(room("amy"), "cat", [amyIn, benIn])).toEqual([]);
  });

  it("muteAllActions: mute-all with none muted, both with some, allow-all with all", () => {
    const r = room("amy");
    // A host who never joined voice can still mute.
    expect(muteAllActions(r, "amy", [{ id: "ben", hostMuted: false }])).toEqual(["mute-all"]);
    expect(muteAllActions(r, "amy", [{ id: "amy", hostMuted: true }, { id: "ben", hostMuted: false }, { id: "cat", hostMuted: false }])).toEqual(["mute-all"]);
    expect(muteAllActions(r, "amy", [{ id: "amy", hostMuted: false }, { id: "ben", hostMuted: true }, { id: "cat", hostMuted: false }])).toEqual(["mute-all", "allow-all"]);
    expect(muteAllActions(r, "amy", [{ id: "amy", hostMuted: false }, { id: "ben", hostMuted: true }, { id: "cat", hostMuted: true }])).toEqual(["allow-all"]);
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
