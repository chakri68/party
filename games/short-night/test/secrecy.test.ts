import type { GameEventEnvelope } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import type { RoleId } from "../shared/roles.ts";
import { NOBODY } from "../shared/types.ts";
import { act, ctx, g, HOST, ids, ok, ring, type S, start, type T } from "./helpers.ts";

/** Every card in play, two Wolves, the Stray: every kind of secret at once. */
const FULL: RoleId[] = ["villager", "wolf", "lamplighter", "matchmaker", "bellringer", "gossip", "wanderer", "stray", "wolf", "villager"];
const ALL = FULL.map((_, i) => `p${i}`);
const WOLVES = ["p1", "p8"];

/**
 * Everything a seat mustn't see before the end: each card (as the private
 * state words it), the wolves' pack, each night result (only its holder, or
 * the Wolves for theirs), whose step it is, and every vote cast.
 */
function sealed(t: { state: S; events: GameEventEnvelope<unknown>[] }, label: string): void {
  const s = t.state;
  const check = (secret: string, allowed: string[]) =>
    expect(findLeaks({ def: g, state: s, events: t.events, players: ALL, secret, allowed }), `${label}: ${secret}`).toEqual([]);

  for (const role of new Set(FULL)) check(`"role":"${role}"`, ALL.filter((id) => s.cards[id] === role));
  check('"pack":', WOLVES);
  check('"cards":{', []);
  for (const [id, result] of Object.entries(s.results)) check(JSON.stringify(result), s.cards[id] === "wolf" ? WOLVES : [id]);
  if (s.phase === "night") {
    const actors = ALL.filter((id) => s.cards[id] === s.steps[s.step]);
    check('"picking":{', actors);
  }
  for (const b of [s.ballot, s.runoff]) {
    for (const [voter, choice] of Object.entries(b?.votes ?? {})) check(`"${voter}":"${choice}"`, []);
  }
}

describe("secrets", () => {
  it("keep through the reveal, every night step, the day, the vote and the runoff", () => {
    let t: T = start(FULL, {}, 7);
    sealed(t, "deal");
    for (const id of ALL) {
      t = ok(act(t.state, id, { type: "ack" }));
      sealed(t, `ack ${id}`);
    }
    const picks: Record<string, string[]> = { p2: ["p7"], p3: ["p1", "p0"], p6: ["p8"] };
    while (t.state.phase === "night") {
      const role = t.state.steps[t.state.step]!;
      for (const id of ALL.filter((x) => t.state.cards[x] === role && picks[x])) {
        t = ok(act(t.state, id, { type: "pick", targets: picks[id] }));
        sealed(t, `pick ${id}`);
      }
      t = ring(t.state);
      sealed(t, `after ${role}`);
    }
    expect(t.state.phase).toBe("day");
    t = ok(act(t.state, HOST, { type: "next" }));
    sealed(t, "vote open");
    // p1 and p2 tie at 3, nobody at 2: a runoff.
    const votes: Record<string, string> = { p0: "p1", p1: "p2", p2: "p1", p3: "p1", p4: "p2", p5: "p2", p6: NOBODY, p7: NOBODY, p8: "p3" };
    for (const [id, choice] of Object.entries(votes)) {
      t = ok(act(t.state, id, { type: "vote", choice }));
      sealed(t, `vote ${id}`);
    }
    t = ok(act(t.state, "p9", { type: "vote", choice: "p4" }));
    expect(t.state.phase).toBe("runoff");
    sealed(t, "runoff open");
    t = ok(act(t.state, "p0", { type: "vote", choice: "p2" }));
    sealed(t, "runoff vote");
    // A leaver mid-runoff still gives nothing away.
    t = g.onPlayerRemoved!(t.state, "p9", ctx(t.state.deadline - 1000));
    sealed(t, "runoff leave");
  });

  it("all come out at the end", () => {
    let s = start(FULL, {}, 7).state;
    for (const id of ALL) s = ok(act(s, id, { type: "ack" })).state;
    while (s.phase !== "vote") s = ring(s).state;
    s = ring(s).state;
    expect(s.phase).toBe("finished");
    const pub = g.getPublicState(s);
    expect(pub.cards).toEqual(Object.fromEntries(ALL.map((id, i) => [id, FULL[i]])));
    expect(JSON.stringify(pub)).toContain('"pack":');
  });

  it("a game cut short reveals everything too", () => {
    let s = start(FULL, {}, 7).state;
    s = g.onPlayerRemoved!(s, "p1", ctx(1000)).state;
    s = g.onPlayerRemoved!(s, "p8", ctx(1000)).state;
    expect(s.phase).toBe("finished");
    expect(g.getPublicState(s).cards).not.toBeNull();
  });

  it("the night looks the same from outside whoever holds what", () => {
    // Same deck, cards in different seats, different picks or none: the public
    // night (steps, lengths, events) must not differ by a byte.
    const night = (cards: RoleId[], pickers: boolean) => {
      let t: T = start(cards, {}, 3);
      for (const id of ids(t.state)) t = ok(act(t.state, id, { type: "ack" }));
      const seen: unknown[] = [];
      while (t.state.phase === "night") {
        const role = t.state.steps[t.state.step]!;
        const actor = ids(t.state).find((x) => t.state.cards[x] === role)!;
        const other = ids(t.state).filter((x) => x !== actor);
        if (pickers && (role === "lamplighter" || role === "wanderer")) t = ok(act(t.state, actor, { type: "pick", targets: [other[0]] }));
        if (pickers && role === "matchmaker") t = ok(act(t.state, actor, { type: "pick", targets: [other[0], other[1]] }));
        // A pick's own transition is private by construction; what's public is the state after it.
        seen.push(g.getPublicState(t.state), g.getAwaitedPlayerIds(t.state));
        t = ring(t.state);
        seen.push(g.getPublicState(t.state), t.events);
      }
      return JSON.stringify(seen);
    };
    const shifted = [...FULL.slice(3), ...FULL.slice(0, 3)];
    expect(night(FULL, true)).toBe(night(shifted, false));
  });

  it("a seat that isn't in the game gets no card", () => {
    const s = start(FULL).state;
    expect(g.getPrivateState(s, "nobody-here")).toMatchObject({ role: null, result: null, picking: null, choices: [] });
  });
});
