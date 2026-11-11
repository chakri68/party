import { seededRandomInt, type GameContext, type MatchContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { treasureHuntGame as th, type THState } from "../server/game.ts";
import { CHARACTERS, CHARACTER_LABELS, defaultCharacter, isCharacterId } from "../shared/characters.ts";
import { DEFAULT_SETTINGS, type THAction, type THCarry } from "../shared/types.ts";

const ctx = (extra: Partial<GameContext> = {}): GameContext => ({ now: 1000, randomInt: seededRandomInt(7), hostId: "p0", ...extra });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const match = (carry?: unknown): MatchContext => ({ roundNumber: 1, dealerSeat: 0, ...(carry !== undefined && { carry }) });
const make = (n = 2, carry?: unknown) => th.createGame(players(n), DEFAULT_SETTINGS, match(carry), ctx()).state;
const pick = (s: THState, id: string) => s.players.find((p) => p.id === id)!.character;

function act(state: THState, id: string, action: THAction) {
  const r = th.handleAction(state, id, action, ctx());
  if (!r.ok) throw new Error(r.error.code);
  return r.transition;
}

describe("character ids", () => {
  it("match Godot's CharacterModel.IDS, with labels", () => {
    expect([...CHARACTERS]).toEqual(["female-a", "female-b", "female-c", "female-d", "male-a", "male-b", "male-c", "male-d"]);
    expect(CHARACTERS.map((c) => CHARACTER_LABELS[c])).toEqual(["Woman 1", "Woman 2", "Woman 3", "Woman 4", "Man 1", "Man 2", "Man 3", "Man 4"]);
    expect(isCharacterId("male-c")).toBe(true);
    expect(isCharacterId("robot")).toBe(false);
    expect(isCharacterId(3)).toBe(false);
  });
  it("defaultCharacter is stable, valid, and spreads over ids", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `player-${i}`);
    const used = new Set(ids.map(defaultCharacter));
    for (const id of ids) {
      expect(defaultCharacter(id)).toBe(defaultCharacter(id));
      expect(CHARACTERS).toContain(defaultCharacter(id));
    }
    expect(used.size).toBeGreaterThanOrEqual(6);
  });
});

describe("character choice", () => {
  it("createGame gives defaults, or a valid carried pick", () => {
    const s = make(3, { teams: [], characters: { p1: "male-d", p2: "robot" } });
    expect(pick(s, "p0")).toBe(defaultCharacter("p0"));
    expect(pick(s, "p1")).toBe("male-d");
    expect(pick(s, "p2")).toBe(defaultCharacter("p2"));
  });
  it("the action sets it in the teams phase and public state shows it", () => {
    const s = act(make(2), "p1", { type: "character", id: "female-c" }).state;
    expect(pick(s, "p1")).toBe("female-c");
    expect(th.getPublicState(s).players.find((p) => p.id === "p1")!.character).toBe("female-c");
  });
  it("is rejected after the teams phase", () => {
    let s = make(1);
    s = act(s, "p0", { type: "ready" }).state;
    s = act(s, "p0", { type: "start" }).state;
    expect(s.phase).toBe("countdown");
    for (const phase of ["countdown", "hunting"] as const) {
      const r = th.handleAction({ ...s, phase }, "p0", { type: "character", id: "male-a" }, ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("wrong-phase");
        expect(r.error.message).toBe("You can pick a character only before the round starts.");
      }
    }
  });
  it("parseAction drops unknown ids", () => {
    expect(th.parseAction({ type: "character", id: "robot" })).toBeNull();
    expect(th.parseAction({ type: "character" })).toBeNull();
    expect(th.parseAction({ type: "character", id: "male-b" })).toEqual({ type: "character", id: "male-b" });
  });
  it("carryOver maps every non-removed player to their pick", () => {
    let s = make(3);
    s = act(s, "p1", { type: "character", id: "female-d" }).state;
    s = { ...s, players: s.players.map((p) => (p.id === "p2" ? { ...p, removed: true } : p)) };
    expect((th.carryOver!(s) as THCarry).characters).toEqual({ p0: defaultCharacter("p0"), p1: "female-d" });
  });
  it("a saved room without the field reads the default", () => {
    const s = make(2);
    const old = { ...s, players: s.players.map(({ character: _c, ...p }) => p) } as unknown as THState;
    expect(th.getPublicState(old).players.map((p) => p.character)).toEqual([defaultCharacter("p0"), defaultCharacter("p1")]);
  });
});
