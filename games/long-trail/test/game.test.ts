import { describe, expect, it } from "vitest";
import { packFor } from "../shared/pack.ts";
import { DEFAULT_SETTINGS, type Length } from "../shared/types.ts";
import { act, ctx, err, g, ids, leaderId, nextAll, ok, playDay, proposeOpen, ring, type S, start, toPlan, voteAll, chooseAll } from "./helpers.ts";

const JOBS = ["guide", "healer", "trader", "quartermaster", "scout", "driver", "cook", "lookout"];

/** Ring the phase clock until `stop` holds, or `max` rings. */
function ringUntil(s: S, stop: (s: S) => boolean, max = 400): S {
  for (let i = 0; i < max && !stop(s); i++) s = ring(s).state;
  return s;
}

/** Plays days with the open plan until a choice event is open. */
function toChoice(seed: number): S | null {
  let s = toPlan(start(4, {}, seed).state);
  for (let day = 0; day < 20 && s.phase === "plan"; day++) {
    s = proposeOpen(s);
    s = voteAll(s, "go").state;
    if (s.phase === "choice") return s;
    s = nextAll(s).state;
  }
  return null;
}

describe("createGame", () => {
  it("gives everyone a Well traveller, a distinct job and a goal", () => {
    const s = start(8).state;
    expect(s.phase).toBe("reveal");
    expect(s.travellers).toEqual(ids(s));
    expect(Object.values(s.caravan.health)).toEqual(Array(8).fill(3));
    expect(new Set(Object.values(s.jobs))).toEqual(new Set(JOBS));
    for (const id of ids(s)) {
      expect(s.goals[id]).toBeDefined();
      expect(s.goalText[id]).toMatch(/\S/);
    }
  });

  it("deals a subset of the jobs to fewer players", () => {
    const s = start(4).state;
    const jobs = Object.values(s.jobs);
    expect(new Set(jobs).size).toBe(4);
    for (const j of jobs) expect(JOBS).toContain(j);
  });

  it("moves to the plan once everyone has seen their cards", () => {
    const s = toPlan(start(3).state);
    expect(s.proposalNo).toBe(1);
    expect(g.getAwaitedPlayerIds(s)).toEqual([leaderId(s)]);
  });
});

describe("plans and votes", () => {
  it("lets only the leader propose", () => {
    const s = toPlan(start(4).state);
    const other = ids(s).find((id) => id !== leaderId(s))!;
    expect(err(act(s, other, { type: "propose", plan: g.getPublicState(s).openPlan }))).toBe("not-leader");
  });

  it("rejects an invalid plan with the planProblem text", () => {
    const s = toPlan(start(4).state);
    const plan = { ...g.getPublicState(s).openPlan, trades: [{ item: "silk", qty: 1 }] };
    const r = act(s, leaderId(s), { type: "propose", plan });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: "bad-plan", message: "No market here." });
  });

  it("fails a 2-2 vote, passes the lead on, then stays the course", () => {
    let s = toPlan(start(4).state);
    const first = s.leader;
    s = proposeOpen(s);
    const [a, b] = ids(s);
    s = voteAll(s, "go", { [a!]: "no-go", [b!]: "no-go" }).state;
    expect(s.phase).toBe("plan");
    expect(s.proposalNo).toBe(2);
    expect(s.leader).toBe((first + 1) % 4);
    expect(s.proposals).toHaveLength(1);

    s = proposeOpen(s);
    s = voteAll(s, "no-go").state;
    if (s.phase === "choice") s = chooseAll(s, 0).state;
    expect(s.phase).toBe("summary");
    expect(s.log.at(-1)!.stayedCourse).toBe(true);
    expect(s.log.at(-1)!.proposals.map((p) => p.passed)).toEqual([false, false]);
    expect(s.log.at(-1)!.leader).toBe(ids(s)[(first + 1) % 4]);
  });

  it("counts a 0-0 vote as failed", () => {
    let s = proposeOpen(toPlan(start(3).state));
    s = ring(s).state;
    expect(s.phase).toBe("plan");
    expect(s.proposalNo).toBe(2);
  });

  it("passes on a majority of votes cast", () => {
    let s = toPlan(start(5).state);
    s = proposeOpen(s);
    const [a, b, c] = ids(s);
    s = ok(act(s, a!, { type: "vote", vote: "go" })).state;
    s = ok(act(s, b!, { type: "vote", vote: "go" })).state;
    s = ok(act(s, c!, { type: "vote", vote: "no-go" })).state;
    s = ring(s).state;
    expect(["choice", "summary"]).toContain(s.phase);
    expect(s.log.length + (s.draft ? 1 : 0)).toBe(1);
  });

  it("starts the next day with the next seat after the last proposer", () => {
    let s = toPlan(start(4).state);
    const first = s.leader;
    s = playDay(s);
    expect(s.phase).toBe("plan");
    expect(s.leader).toBe((first + 1) % 4);
    expect(s.proposalNo).toBe(1);
    expect(s.caravan.day).toBe(2);
  });

  it("proposes the open plan when the host skips the leader", () => {
    const s = toPlan(start(4).state);
    const t = g.skipTurn!(s, leaderId(s), ctx(s.deadline - 1000));
    expect(t.state.phase).toBe("vote");
    expect(t.state.plan).toEqual(g.getPublicState(s).openPlan);
  });
});

describe("choice events", () => {
  it("settles a tie with the leader's pick", () => {
    let s: S | null = null;
    for (let seed = 1; seed < 40 && !s; seed++) s = toChoice(seed);
    expect(s).not.toBeNull();
    const leader = leaderId(s!);
    const others = ids(s!).filter((id) => id !== leader);
    let t = s!;
    t = ok(act(t, leader, { type: "choose", option: 1 })).state;
    t = ok(act(t, others[0]!, { type: "choose", option: 1 })).state;
    t = ok(act(t, others[1]!, { type: "choose", option: 0 })).state;
    t = ok(act(t, others[2]!, { type: "choose", option: 0 })).state;
    expect(t.phase).toBe("summary");
    expect(t.log.at(-1)!.event!.choice!.picked).toBe(1);
  });

  it("picks option 0 on a tie the leader stayed out of", () => {
    let s: S | null = null;
    for (let seed = 1; seed < 40 && !s; seed++) s = toChoice(seed);
    const leader = leaderId(s!);
    const others = ids(s!).filter((id) => id !== leader);
    let t = ok(act(s!, others[0]!, { type: "choose", option: 1 })).state;
    t = ok(act(t, others[1]!, { type: "choose", option: 0 })).state;
    t = ring(t).state;
    expect(t.log.at(-1)!.event!.choice!.picked).toBe(0);
  });
});

describe("abilities", () => {
  it("rejects arming a job with nothing to arm", () => {
    const s = toPlan(start(8).state);
    const healer = ids(s).find((id) => s.jobs[id] === "healer")!;
    expect(err(act(s, healer, { type: "arm", on: true }))).toBe("no-ability");
  });

  it("shows an armed Guide only in the Guide's private state", () => {
    let s = toPlan(start(8).state);
    const guide = ids(s).find((id) => s.jobs[id] === "guide")!;
    s = ok(act(s, guide, { type: "arm", on: true })).state;
    expect(s.armed.guide).toBe(true);
    expect(g.getPrivateState(s, guide).ability).toEqual({ job: "guide", armed: true, used: false, canArm: true });
    expect(JSON.stringify(g.getPublicState(s))).not.toContain("armed");
    for (const id of ids(s).filter((x) => x !== guide)) {
      expect(JSON.stringify(g.getPrivateState(s, id))).not.toContain('"job":"guide","armed"');
    }
  });

  it("rejects arming outside the plan and the vote", () => {
    const s = start(8).state;
    const guide = ids(s).find((id) => s.jobs[id] === "guide")!;
    expect(err(act(s, guide, { type: "arm", on: true }))).toBe("wrong-phase");
  });
});

describe("removal", () => {
  it("gives the next seat a fresh plan clock when the leader leaves mid-plan", () => {
    const s = toPlan(start(4).state);
    const seat = s.leader;
    const now = s.deadline - 5000;
    const t = g.onPlayerRemoved!(s, leaderId(s), ctx(now));
    expect(t.state.phase).toBe("plan");
    expect(t.state.leader).toBe((seat + 1) % 4);
    expect(t.state.deadline).toBe(now + 45_000);
    expect(t.state.travellers).not.toContain(s.players[seat]!.id);
    expect(t.state.caravan.health).not.toHaveProperty(s.players[seat]!.id);
  });

  it("counts a protect goal as met when its target leaves", () => {
    let s = toPlan(start(4).state);
    s.goals.p0 = { kind: "protect", target: "p1" };
    s.caravan.health.p1 = 1;
    s = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000)).state;
    s = ringUntil(s, (x) => x.phase === "recap");
    expect(s.recap!.reveals.find((r) => r.playerId === "p0")!.met).toBe(true);
    expect(s.recap!.reveals.map((r) => r.playerId)).not.toContain("p1");
  });

  it("fails the trip when the last living traveller leaves", () => {
    let s = toPlan(start(5).state);
    for (const id of ["p0", "p1", "p2", "p3"]) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("recap");
    expect(g.getResult(s)).toBeNull();
    s = ring(s).state;
    expect(s.phase).toBe("over");
    expect(g.getResult(s)!.headline).toBe("Everyone died on the trail");
  });

  it("never hands the first plan to someone who left in the reveal", () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = start(4, {}, seed).state;
      s = g.onPlayerRemoved!(s, "p0", ctx(1000)).state;
      s = toPlan(s);
      expect(leaderId(s)).not.toBe("p0");
      expect(g.getAwaitedPlayerIds(s)).toEqual([leaderId(s)]);
    }
  });

  it("ends the game early below two players", () => {
    let s = toPlan(start(3).state);
    s = g.onPlayerRemoved!(s, "p0", ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("plan");
    s = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000)).state;
    expect(s).toMatchObject({ phase: "over", interrupted: true, recap: null });
    expect(g.getResult(s)).toEqual({ winnerIds: [], standings: [], headline: "The game ended early." });
  });

  it("drops a leaver's vote", () => {
    let s = proposeOpen(toPlan(start(4).state));
    const voter = ids(s).find((id) => id !== leaderId(s))!;
    s = ok(act(s, voter, { type: "vote", vote: "no-go" })).state;
    s = g.onPlayerRemoved!(s, voter, ctx(s.deadline - 1000)).state;
    expect(s.ballot!.votes).not.toHaveProperty(voter);
    expect(s.ballot!.eligible).not.toContain(voter);
  });
});

describe("the clock alone", () => {
  it.each(["short", "normal", "epic"] as Length[])("ends a %s game", (length) => {
    let s = start(3, { length }).state;
    const deadline = packFor(DEFAULT_SETTINGS.setting).routes[length].deadline;
    const max = (deadline + 1) * 6 + 3;
    let rings = 0;
    while (s.phase !== "over" && rings < max) {
      s = ring(s).state;
      rings++;
    }
    expect(s.phase).toBe("over");
    expect(g.getResult(s)).not.toBeNull();
  });
});

describe("host Skip alone", () => {
  it.each(["short", "normal", "epic"] as Length[])("ends a %s game", (length) => {
    let s = start(3, { length }).state;
    const deadline = packFor(DEFAULT_SETTINGS.setting).routes[length].deadline;
    const max = (deadline + 1) * 6 + 3;
    let steps = 0;
    while (s.phase !== "over" && steps < max) {
      const awaited = g.getAwaitedPlayerIds(s);
      if (awaited.length === 0) s = ring(s).state;
      for (const id of awaited) s = g.skipTurn!(s, id, ctx(s.deadline - 1000)).state;
      steps++;
    }
    expect(s.phase).toBe("over");
    expect(g.getResult(s)).not.toBeNull();
  });
});

describe("a full game", () => {
  it("reaches the recap, then over, with a result only at the end", () => {
    let s = toPlan(start(5, { length: "short" }, 7).state);
    for (let day = 0; day < 40 && s.phase === "plan"; day++) {
      expect(g.getResult(s)).toBeNull();
      s = playDay(s);
    }
    expect(s.phase).toBe("recap");
    expect(g.getResult(s)).toBeNull();
    expect(g.getPublicState(s).recap).toEqual(s.recap);
    expect(s.recap!.reveals).toHaveLength(5);
    s = nextAll(s).state;
    expect(s.phase).toBe("over");
    const result = g.getResult(s)!;
    expect(result.standings).toHaveLength(5);
  });
});

describe("party stats", () => {
  it("counts each No-go and never shows it", () => {
    let s = proposeOpen(toPlan(start(4).state));
    const [a, b] = ids(s);
    s = voteAll(s, "go", { [a!]: "no-go" }).state;
    if (s.phase === "choice") s = chooseAll(s, 0).state;
    s = nextAll(s).state;
    s = proposeOpen(s);
    s = voteAll(s, "go", { [a!]: "no-go", [b!]: "no-go" }).state;
    expect(g.partyStats!(s)).toEqual({ [a!]: { noGoVotes: 2 }, [b!]: { noGoVotes: 1 } });
    for (const view of [g.getPublicState(s), ...ids(s).map((id) => g.getPrivateState(s, id))]) {
      expect(JSON.stringify(view)).not.toMatch(/stats|noGoVotes/);
    }
  });
});
