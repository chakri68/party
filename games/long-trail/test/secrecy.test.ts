import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { act, g, ids, leaderId, nextAll, ok, proposeOpen, ring, type S, start, type T, voteAll, chooseAll } from "./helpers.ts";

const INFO_FIELDS = ["worsenChance", "foodDays", "nextFork", "odds", "fatigue", "nextMarket"];

/** Before the recap: no goal, no armed flag, no job info anywhere public, and no goal in anyone else's hands. */
function sealed(t: T, label: string): void {
  const s = t.state;
  const all = s.players.map((p) => p.id);
  const pub = JSON.stringify(g.getPublicState(s));
  const revealed = s.phase === "recap" || s.phase === "over";
  if (!revealed) {
    for (const id of all) {
      const text = s.goalText[id]!;
      // A goal text two players share can't be pinned to either.
      const owners = all.filter((x) => s.goalText[x] === text);
      expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret: text, allowed: owners }), `${label}: goal of ${id}`).toEqual([]);
      const goal = JSON.stringify(s.goals[id]);
      const same = all.filter((x) => JSON.stringify(s.goals[x]) === goal);
      expect(findLeaks({ def: g, state: s, events: t.events, players: all, secret: goal, allowed: same }), `${label}: goal json of ${id}`).toEqual([]);
    }
    expect(pub, label).not.toMatch(/"armed"/); // a key, not "Armed men" in a card
    for (const f of INFO_FIELDS) expect(pub, `${label}: ${f}`).not.toContain(f);
    for (const e of t.events) for (const f of [...INFO_FIELDS, '"armed"']) expect(JSON.stringify(e.event)).not.toContain(f);
  } else if (s.recap) {
    for (const id of ids(s)) expect(pub, `${label}: reveal ${id}`).toContain(JSON.stringify(s.goalText[id]));
  }
}

describe("secrets", () => {
  it.each([3, 11, 29])("keep in every phase of seeded game %i", (seed) => {
    let t: T = start(8, { length: "short" }, seed);
    sealed(t, "deal");
    for (const id of ids(t.state)) t = ok(act(t.state, id, { type: "ack" }));
    sealed(t, "plan");
    // Everyone with something to arm arms it on day 1.
    for (const id of ids(t.state)) {
      if (["guide", "scout", "quartermaster", "lookout"].includes(t.state.jobs[id]!)) {
        t = ok(act(t.state, id, { type: "arm", on: true }));
        sealed(t, `arm ${id}`);
      }
    }
    const phases = new Set<string>();
    for (let step = 0; step < 300 && t.state.phase !== "over"; step++) {
      const s: S = t.state;
      phases.add(s.phase);
      if (s.phase === "plan") t = { state: proposeOpen(s), events: [] };
      else if (s.phase === "vote") t = voteAll(s, step % 3 === 0 ? "no-go" : "go");
      else if (s.phase === "choice") t = chooseAll(s, 1);
      else if (s.phase === "summary" || s.phase === "recap") t = nextAll(s);
      else t = ring(s);
      sealed(t, `step ${step} ${s.phase} (${leaderId(s)})`);
    }
    expect(t.state.phase).toBe("over");
    for (const p of ["plan", "vote", "summary", "recap"]) expect(phases).toContain(p);
  });
});
