import type { GameEventEnvelope } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import type { RoleId } from "../shared/roles.ts";
import { SKIP } from "../shared/types.ts";
import { act, alive, ctx, g, HOST, leave, ok, ring, type S, start, type T } from "./helpers.ts";

/** p0 villager (host), p1 wolf, p2 watcher, p3 keeper, p4 villager, p5 wolf, p6 villager, p7 villager. */
const EIGHT: RoleId[] = ["villager", "wolf", "watcher", "keeper", "villager", "wolf", "villager", "villager"];
const ALL = EIGHT.map((_, i) => `p${i}`);
const WOLVES = ["p1", "p5"];

/**
 * Everything a seat mustn't see before the end: each card (as the private
 * state words it), the pack and its picks, every night pick, the Keeper's
 * shelter, the Watcher's readings, what the night log holds.
 */
function sealed(t: { state: S; events: GameEventEnvelope<unknown>[] }, label: string): void {
  const s = t.state;
  const check = (secret: string, allowed: string[]) =>
    expect(findLeaks({ def: g, state: s, events: t.events, players: ALL, secret, allowed }), `${label}: ${secret}`).toEqual([]);

  for (const role of new Set(EIGHT)) check(`"role":"${role}"`, ALL.filter((id) => s.cards[id] === role));
  check('"pack":[', WOLVES);
  check('"packPicks":{', WOLVES);
  for (const [w, target] of Object.entries(s.pack?.votes ?? {})) check(`"${w}":"${target}"`, WOLVES);
  for (const [id, target] of Object.entries(s.picks)) check(`"pick":"${target}"`, [id, ...(Object.values(s.pack?.votes ?? {}).includes(target) ? WOLVES : [])]);
  check('"lastShelter":"', ["p3"]);
  check('"readings":[{', ["p2"]);
  check('"blocked":["', ["p1", "p2", "p3", "p5"]);
  check('"cards":{', []);
  check('"wolfVotes":', []);
  check('"sheltered":', []);
  check('"readWolf":', []);
}

/**
 * A vote or a pick by `who` changes nothing anyone else gets but the public
 * count, and (for a Wolf's pick) the pack's view of it.
 */
function quiet(before: S, after: T, who: string, alsoSees: string[] = []): void {
  const strip = (s: S) => ({ ...g.getPublicState(s), voted: 0 });
  expect(strip(after.state)).toEqual(strip(before));
  expect(after.events).toEqual([]);
  for (const id of ALL) {
    if (id === who || alsoSees.includes(id)) continue;
    expect(g.getPrivateState(after.state, id), `${who} -> ${id}`).toEqual(g.getPrivateState(before, id));
  }
}

function pick(t: T, id: string, target: string): T {
  const next = ok(act(t.state, id, { type: "pick", target }));
  quiet(t.state, next, id, t.state.cards[id] === "wolf" ? WOLVES : []);
  sealed(next, `pick ${id}`);
  return next;
}

function cast(t: T, id: string, choice: string): T {
  const next = ok(act(t.state, id, { type: "vote", choice }));
  if (next.state.phase === t.state.phase) quiet(t.state, next, id);
  sealed(next, `vote ${id}`);
  return next;
}

describe("secrets", () => {
  it("keep through the reveal, two nights, a vote, a runoff and a leave", () => {
    let t: T = start([...EIGHT], {}, 7);
    sealed(t, "deal");
    for (const id of ALL) {
      t = ok(act(t.state, id, { type: "ack" }));
      sealed(t, `ack ${id}`);
    }
    expect(t.state.phase).toBe("night");
    // Night 1: the pack takes p4, the Keeper shelters p0, the Watcher reads p1.
    t = pick(t, "p1", "p4");
    t = pick(t, "p5", "p4");
    t = pick(t, "p3", "p0");
    t = pick(t, "p2", "p1");
    t = ring(t.state);
    sealed(t, "dawn 1");
    expect(t.state.nights[0]!.died).toBe("p4");
    t = ok(act(t.state, HOST, { type: "next" }));
    sealed(t, "vote 1");
    // p6 and p7 tie at 3: a runoff.
    for (const [id, choice] of Object.entries({ p0: "p6", p1: "p7", p2: "p6", p3: "p6", p5: "p7", p6: "p7" })) t = cast(t, id, choice);
    t = cast(t, "p7", SKIP);
    expect(t.state.phase).toBe("runoff");
    sealed(t, "runoff");
    t = cast(t, "p0", "p7");
    t = cast(t, "p2", "p6");
    // A leaver mid-runoff gives nothing away either.
    t = leave(t.state, "p3");
    sealed(t, "leave");
    t = ring(t.state);
    sealed(t, "runoff closed");
    expect(t.state).toMatchObject({ phase: "night", round: 2 });
    t = pick(t, "p1", "p0");
    t = pick(t, "p2", "p5");
    t = ring(t.state);
    sealed(t, "dawn 2");
    expect(t.state.phase).toBe("day");
  });

  it("all come out at the end", () => {
    let s = start([...EIGHT], {}, 7).state;
    s = ring(s).state;
    s = ok(act(s, "p3", { type: "pick", target: "p0" })).state;
    // Vote out both Wolves over two days.
    s = ring(s).state;
    s = ring(s).state;
    for (const id of alive(s)) if (id !== "p1") s = ok(act(s, id, { type: "vote", choice: "p1" })).state;
    s = ring(s).state;
    s = ring(ring(s).state).state;
    for (const id of alive(s)) if (id !== "p5") s = ok(act(s, id, { type: "vote", choice: "p5" })).state;
    if (s.phase !== "finished") s = ring(s).state;
    expect(s).toMatchObject({ phase: "finished", winner: "village" });
    const pub = g.getPublicState(s);
    expect(pub.cards).toEqual(Object.fromEntries(ALL.map((id, i) => [id, EIGHT[i]])));
    expect(pub.nights![0]).toMatchObject({ sheltered: "p0" });
  });

  it("an interrupted game reveals everything too", () => {
    let s = start([...EIGHT], {}, 7).state;
    s = leave(leave(s, "p1").state, "p5").state;
    s = ring(s).state;
    expect(s).toMatchObject({ phase: "finished", endReason: "abandoned" });
    expect(g.getPublicState(s).cards).not.toBeNull();
    expect(g.getPublicState(s).nights).toEqual([]);
  });

  it("nights and days look the same from outside whoever holds what and whoever acts", () => {
    // Same deck, cards in different seats, the pack picking (and sheltered) or
    // not picking at all: nobody dies either way, and the public view must not
    // differ by a byte.
    const run = (cards: RoleId[], acting: boolean) => {
      let t: T = start(cards, {}, 3);
      const seen: unknown[] = [];
      const look = () => seen.push(g.getPublicState(t.state), g.getAwaitedPlayerIds(t.state));
      for (const id of ALL) t = ok(act(t.state, id, { type: "ack" }));
      seen.push(t.events);
      look();
      if (acting) {
        const role = (r: RoleId) => ALL.filter((id) => t.state.cards[id] === r);
        const prey = ALL.find((id) => t.state.cards[id] === "villager")!;
        for (const w of role("wolf")) {
          t = ok(act(t.state, w, { type: "pick", target: prey }));
          look();
        }
        t = ok(act(t.state, role("keeper")[0]!, { type: "pick", target: prey }));
        look();
        t = ok(act(t.state, role("watcher")[0]!, { type: "pick", target: role("wolf")[0]! }));
        look();
      } else {
        for (let i = 0; i < 4; i++) look();
      }
      t = ring(t.state);
      look();
      seen.push(t.events);
      t = ok(act(t.state, HOST, { type: "next" }));
      look();
      for (const id of ALL) {
        t = ok(act(t.state, id, { type: "vote", choice: SKIP }));
        look();
      }
      seen.push(t.events);
      return JSON.stringify(seen);
    };
    const shifted = [...EIGHT.slice(3), ...EIGHT.slice(0, 3)];
    expect(run(EIGHT, true)).toBe(run(shifted, false));
  });

  it("every living phone is picking at night, whatever the card", () => {
    const s = ring(start([...EIGHT]).state).state;
    expect(ALL.map((id) => g.getPrivateState(s, id).picking)).toEqual(ALL.map(() => true));
  });

  it("a seat that isn't in the game gets no card", () => {
    const s = start([...EIGHT]).state;
    expect(g.getPrivateState(s, "nobody-here")).toMatchObject({ role: null, pack: null, picking: false, choices: [] });
  });

  it("a removal's transition carries nothing private", () => {
    const s = ring(start([...EIGHT]).state).state;
    const t = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000));
    expect(t.events).toEqual([]);
    sealed(t, "removal");
  });
});
