import { describe, expect, it } from "vitest";
import type { GameEventEnvelope } from "../src/index.ts";
import { findLeaks } from "../src/testing.ts";

// A toy game whose state says outright what each projection shows.
interface Toy {
  public: string;
  private: Record<string, string>;
}
const def = {
  getPublicState: (s: Toy) => ({ table: s.public }),
  getPrivateState: (s: Toy, id: string) => ({ mine: s.private[id] ?? null }),
};
const PLAYERS = ["p1", "p2", "p3"];
const quiet: Toy = { public: "night falls", private: { p1: "you are the WOLF", p2: "villager", p3: "villager" } };

const leaks = (state: Toy, events: GameEventEnvelope<unknown>[] = [], secret = "wolf") =>
  findLeaks({ def, state, events, players: PLAYERS, secret, allowed: ["p1"] });

describe("findLeaks", () => {
  it("is quiet when only the entitled seat sees it", () => {
    expect(leaks(quiet)).toEqual([]);
  });

  it("finds it in public state", () => {
    expect(leaks({ ...quiet, public: "p1 is the wolf" })).toEqual(["public state"]);
  });

  it("finds it in another seat's private state", () => {
    expect(leaks({ ...quiet, private: { ...quiet.private, p2: "psst, p1 is a Wolf" } })).toEqual(["private state of p2"]);
  });

  it("finds it in a public event", () => {
    expect(leaks(quiet, [{ visibility: { kind: "public" }, event: { type: "howl", role: "wolf" } }])).toEqual(["public event #0"]);
  });

  it("finds it in a private event to the wrong seat, not the right one", () => {
    const to = (playerId: string): GameEventEnvelope<unknown> => ({ visibility: { kind: "private", playerId }, event: { role: "Wolf" } });
    expect(leaks(quiet, [to("p2")])).toEqual(["private event #0 to p2"]);
    expect(leaks(quiet, [to("p1")])).toEqual([]);
    expect(leaks(quiet, [to("p1"), to("p3")])).toEqual(["private event #1 to p3"]);
  });

  it("matches case-insensitively", () => {
    expect(leaks({ ...quiet, public: "WoLf" }, [], "WOLF")).toEqual(["public state"]);
  });
});
