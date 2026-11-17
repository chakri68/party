import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { openPlan, world } from "../server/world.ts";
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
    // Skip and the timer still take this game's safe branch.
    const t = g.skipTurn!(s, leaderId(s), ctx(s.deadline - 1000));
    expect(t.state.plan?.fork).toBe(s.forks!["tel-orrin"]!.safe);
    expect(world(s).route.stops.find((x) => x.id === "tel-orrin")!.next.find((l) => l.safe)!.to).toBe(s.forks!["tel-orrin"]!.safe);
  });
});

describe("the water band at a fork", () => {
  // Normal route, Ombar: the safe branch (Kessel) is desert, the other (Rookan) is not.
  // 4 travellers and 16 water: 4 days at the normal rate ("some"), 2 days at the desert rate ("low").
  function atOmbar(): S {
    const s = structuredClone(toPlan(start(4, { length: "normal" }, 5).state));
    s.caravan.at = "ombar";
    s.caravan.leg = null;
    s.caravan.kmLeft = 0;
    s.caravan.stock.water = 16;
    s.forks!.ombar!.safe = "kessel"; // this test wants the desert way to be the safe one
    return s;
  }

  it("does not follow the safe branch before a plan is proposed", () => {
    const s = atOmbar();
    expect(s.travellers.filter((id) => s.caravan.health[id]! > 0)).toHaveLength(4);
    // The safe branch is desert, so a band that followed it would say "low".
    expect(g.getPublicState(s).stock.water).toBe("some");
    // The server's open plan (Skip, the timer) still takes the safe branch.
    expect(openPlan(s).fork).toBe("kessel");
  });

  it("job info before a plan shows both ways, and water days at the normal rate", () => {
    const s = atOmbar();
    const [a, b, c] = ids(s);
    s.jobs[a!] = "quartermaster";
    s.jobs[b!] = "trader";
    s.jobs[c!] = "guide";
    expect(g.getPrivateState(s, a!).info).toMatchObject({ waterDays: 4 }); // 16 water, 4 a day; desert would say 2
    const trader = g.getPrivateState(s, b!).info;
    expect(trader).toMatchObject({ nextMarket: null, fork: { stop: "ombar" } });
    expect(Object.keys((trader as { fork: { ways: object } }).fork.ways).sort()).toEqual(["kessel", "rookan"]);
    const guide = g.getPrivateState(s, c!).info;
    expect(guide).toMatchObject({ nextLeg: null, fork: { stop: "ombar" } });
    expect(Object.keys((guide as { fork: { ways: object } }).fork.ways).sort()).toEqual(["kessel", "rookan"]);
    s.plan = { ...openPlan(s), fork: "kessel" };
    expect(g.getPrivateState(s, a!).info).toMatchObject({ waterDays: 2 });
  });

  it("follows the fork a proposed plan picks", () => {
    const s = atOmbar();
    s.plan = { ...openPlan(s), fork: "kessel" };
    expect(g.getPublicState(s).stock.water).toBe("low");
    s.plan = { ...openPlan(s), fork: "rookan" };
    expect(g.getPublicState(s).stock.water).toBe("some");
  });
});

describe("the food band", () => {
  function withFood(food: number, rations: "full" | "half" | "none"): S {
    const s = structuredClone(toPlan(start(4, { length: "short" }, 5).state));
    s.caravan.stock.food = food;
    s.plan = { ...openPlan(s), rations };
    return s;
  }

  it("is out at 0 food, on any rations", () => {
    for (const r of ["full", "half", "none"] as const) expect(g.getPublicState(withFood(0, r)).stock.food, r).toBe("out");
  });

  it("bands by full rations when the plan eats nothing", () => {
    // 4 travellers, 2 food each on full rations: 8 a day.
    expect(g.getPublicState(withFood(8, "none")).stock.food).toBe("low");
    expect(g.getPublicState(withFood(24, "none")).stock.food).toBe("some");
    expect(g.getPublicState(withFood(48, "none")).stock.food).toBe("plenty");
    expect(g.getPublicState(withFood(8, "half")).stock.food).toBe("low"); // 2 days on half
  });

  it("water is out at 0 too", () => {
    const s = withFood(10, "full");
    s.caravan.stock.water = 0;
    expect(g.getPublicState(s).stock.water).toBe("out");
  });
});

describe("this game's forks", () => {
  it("stay out of public state: no km, kind or safe flag before you walk a leg", () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = toPlan(start(4, { length: "epic" }, seed).state);
      const pub = g.getPublicState(s);
      const json = JSON.stringify(pub);
      expect(json).not.toContain('"safe"');
      expect(json).not.toContain('"forks"');
      expect(json).not.toContain('"kind"');
      for (const stop of pub.route.stops) expect(Object.keys(stop).sort()).toEqual(["id", "market", "name", "next"]);
      for (const id of ids(s)) {
        const priv = JSON.stringify(g.getPrivateState(s, id));
        expect(priv).not.toContain('"safe"');
        expect(priv).not.toContain('"forks"');
      }
    }
  });
});

/** The leader proposes the open plan, but the risky way at the fork. */
const proposeOpenOther = (s: S, way: string): S => ok(act(s, leaderId(s), { type: "propose", plan: { ...openPlan(s), fork: way } })).state;

describe("the safe way is rolled each game", () => {
  it("Skip, dangers and job info all follow this game's safe way", () => {
    const safeAt = new Set<string>();
    let reached = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let s = toPlan(start(4, { length: "short" }, seed).state);
      const safe = s.forks!["tel-orrin"]!.safe;
      safeAt.add(safe);
      const other = safe === "saltmere" ? "vessa" : "saltmere";
      // Never dangerous on any leg of the safe way, up to Quillon where the ways meet.
      expect(s.dangers[`tel-orrin>${safe}`]).toBeLessThan(2);
      expect(s.dangers[`${safe}>quillon`]).toBeLessThan(2);
      for (let day = 0; day < 20 && s.phase === "plan" && !(s.caravan.leg === null && s.caravan.at === "tel-orrin"); day++) s = playDay(s);
      if (s.caravan.at !== "tel-orrin" || s.phase !== "plan") continue;
      reached++;
      // The Guide sees both ways, the real dangers, in id order.
      s.jobs[ids(s)[0]!] = "guide";
      const info = g.getPrivateState(s, ids(s)[0]!).info as { fork: { ways: Record<string, number> } };
      expect(Object.keys(info.fork.ways)).toEqual(["saltmere", "vessa"]);
      expect(info.fork.ways[safe]).toBe(s.dangers[`tel-orrin>${safe}`]);
      expect(info.fork.ways[other]).toBe(s.dangers[`tel-orrin>${other}`]);
      // Public order is by id, whichever way is safe.
      expect(g.getPublicState(s).route.stops.find((x) => x.id === "tel-orrin")!.next).toEqual(["saltmere", "vessa"]);
      // R23: Skip and the timer pick the way by a coin, since the plan is public and put to a vote.
      const bySkip = new Set<string>();
      const byTimer = new Set<string>();
      for (let r = 1; r <= 16; r++) {
        bySkip.add(g.skipTurn!(s, leaderId(s), ctx(s.deadline - 1000, r)).state.plan!.fork!);
        byTimer.add(ring(s, r).state.plan!.fork!);
      }
      expect([...bySkip].sort(), "Skip").toEqual(["saltmere", "vessa"]);
      expect([...byTimer].sort(), "timer").toEqual(["saltmere", "vessa"]);
      // Both plans fail: the caravan moves at once, and takes the safer way.
      let t = voteAll(proposeOpenOther(s, other), "no-go");
      t = voteAll(proposeOpenOther(t.state, other), "no-go");
      expect(t.state.caravan.leg?.to ?? t.state.caravan.at).toBe(safe);
    }
    expect(safeAt.size).toBe(2);
    expect(reached).toBeGreaterThan(6);
  });
});

describe("job info after the trip", () => {
  it("is gone in the recap, so a dead caravan never reads 99 days", () => {
    let s = toPlan(start(5).state);
    for (const id of ["p0", "p1", "p2", "p3"]) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("recap");
    for (const id of ids(s)) expect(g.getPrivateState(s, id).info).toBeNull();
  });
});

describe("today, during a choice", () => {
  it("keeps goals and job info out of the public day so far", () => {
    let found: S | null = null;
    for (let seed = 1; seed < 40 && !found; seed++) {
      let s = toPlan(start(4, {}, seed).state);
      for (let day = 0; day < 20 && s.phase === "plan" && !found; day++) {
        s = voteAll(proposeOpen(s), "go").state;
        if (s.phase === "choice") found = s;
        else s = nextAll(s).state;
      }
    }
    expect(found).not.toBeNull();
    expect(g.getPublicState(found!).today).not.toBeNull();
    sealed({ state: found!, events: [] }, "choice");
  });
});
