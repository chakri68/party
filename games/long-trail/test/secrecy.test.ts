import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { openPlan } from "../server/world.ts";
import { act, ctx, g, ids, leaderId, nextAll, ok, playDay, proposeOpen, ring, type S, start, toPlan, type T, voteAll, chooseAll } from "./helpers.ts";

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

describe("the open plan at a fork", () => {
  it("never names the safe branch in public", () => {
    let s = toPlan(start(4, { length: "short" }, 3).state);
    for (let day = 0; day < 20 && s.phase === "plan" && !(s.caravan.leg === null && s.caravan.at === "tel-orrin"); day++) s = playDay(s);
    expect(s.caravan.at).toBe("tel-orrin"); // the Short route's fork
    expect(s.caravan.leg).toBeNull();
    expect(s.phase).toBe("plan");
    expect(g.getPublicState(s).openPlan.fork).toBeNull();
    // Skip and the timer still take the safe branch.
    const t = g.skipTurn!(s, leaderId(s), ctx(s.deadline - 1000));
    expect(t.state.plan?.fork).toBe("saltmere");
  });
});

describe("the water band at a fork", () => {
  // Normal route, Ombar: the safe branch (Kessel Wells) is desert, the other (Rook Pass) is not.
  // 4 travellers and 16 water: 4 days at the normal rate ("some"), 2 days at the desert rate ("low").
  function atOmbar(): S {
    const s = structuredClone(toPlan(start(4, { length: "normal" }, 5).state));
    s.caravan.at = "ombar";
    s.caravan.leg = null;
    s.caravan.kmLeft = 0;
    s.caravan.stock.water = 16;
    return s;
  }

  it("does not follow the safe branch before a plan is proposed", () => {
    const s = atOmbar();
    expect(s.travellers.filter((id) => s.caravan.health[id]! > 0)).toHaveLength(4);
    // The safe branch is desert, so a band that followed it would say "low".
    expect(g.getPublicState(s).stock.water).toBe("some");
    // jobInfo still sees the server's open plan, safe branch included.
    expect(openPlan(s).fork).toBe("kessel-wells");
  });

  it("follows the fork a proposed plan picks", () => {
    const s = atOmbar();
    s.plan = { ...openPlan(s), fork: "kessel-wells" };
    expect(g.getPublicState(s).stock.water).toBe("low");
    s.plan = { ...openPlan(s), fork: "rook-pass" };
    expect(g.getPublicState(s).stock.water).toBe("some");
  });
});
