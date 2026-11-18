import { describe, expect, it } from "vitest";
import { packFor } from "../shared/pack.ts";
import { tradeRoute } from "../shared/packs/trade-route.ts";
import { fillNames } from "../shared/recap.ts";
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

describe("a host Skip always sends an event", () => {
  const skipped = (t: { events: { event: { type: string } }[] }, id: string) => t.events.map((e) => e.event).filter((e) => e.type === "skipped").length === 1 && t.events.some((e) => (e.event as { playerId?: string }).playerId === id);

  it("drops a voter in the vote", () => {
    const s = proposeOpen(toPlan(start(4).state));
    const voter = ids(s).find((id) => id !== leaderId(s))!;
    const t = g.skipTurn!(s, voter, ctx(s.deadline - 1000));
    expect(skipped(t, voter)).toBe(true);
    expect(t.state.phase).toBe("vote");
    expect(t.state.ballot!.eligible).not.toContain(voter);
  });

  it("drops a chooser in the choice", () => {
    let s: S | null = null;
    for (let seed = 1; seed < 40 && !s; seed++) s = toChoice(seed);
    const who = ids(s!)[0]!;
    const t = g.skipTurn!(s!, who, ctx(s!.deadline - 1000));
    expect(skipped(t, who)).toBe(true);
    expect(t.state.phase).toBe("choice");
    expect(t.state.choiceBallot!.eligible).not.toContain(who);
  });

  it("counts a player as done in the reveal and in the summary", () => {
    const r = start(4).state;
    const tr = g.skipTurn!(r, "p1", ctx(1000));
    expect(skipped(tr, "p1")).toBe(true);
    expect(tr.state.acks).toContain("p1");
    expect(tr.state.phase).toBe("reveal");

    let s: S | null = null;
    for (let seed = 1; seed < 40 && !s; seed++) s = toChoice(seed);
    s = chooseAll(s!, 0).state;
    expect(s.phase).toBe("summary");
    const ts = g.skipTurn!(s, "p1", ctx(s.deadline - 1000));
    expect(skipped(ts, "p1")).toBe(true);
    expect(ts.state.acks).toContain("p1");
    expect(ts.state.phase).toBe("summary");
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

describe("medicine bought and given on the same day", () => {
  it("is bought first, then given", () => {
    let s = toPlan(start(4, { length: "short" }).state);
    // Halt at a market with no medicine, one traveller sick.
    s.caravan.at = "saltmere";
    s.caravan.leg = null;
    s.caravan.stock.medicine = 0;
    s.caravan.stock.coins = 100;
    s.caravan.health.p1 = 2;
    const plan = { ...g.getPublicState(s).openPlan, rest: true, doses: ["p1"], trades: [{ item: "medicine", qty: 1 }] };
    s = ok(act(s, leaderId(s), { type: "propose", plan })).state;
    s = voteAll(s, "go").state;
    if (s.phase === "choice") s = chooseAll(s, 0).state;
    const day = s.log.at(-1)!;
    expect(day.report.healthChanges).toContainEqual({ playerId: "p1", from: 2, to: 3 });
    expect(s.caravan.stock.medicine).toBe(0); // bought 1, gave 1
  });
});

describe("the event's own outcome", () => {
  it("a plain event's outcome is kept apart from the day", () => {
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      let s = toPlan(start(4, {}, seed).state);
      for (let day = 0; day < 20 && s.phase === "plan" && !found; day++) {
        s = proposeOpen(s);
        s = voteAll(s, "go").state;
        if (s.phase === "choice") s = chooseAll(s, 0).state;
        const last = s.log.at(-1)!;
        if (last.event && !last.event.choice && last.eventOutcome && last.eventOutcome.healthChanges.length > 0) {
          found = true;
          const out = last.eventOutcome!;
          expect(out).toBeDefined();
          const all = last.report.healthChanges;
          for (const h of out.healthChanges) expect(all).toContainEqual(h);
          expect(all.slice(all.length - out.healthChanges.length)).toEqual(out.healthChanges);
        }
        s = nextAll(s).state;
      }
    }
    expect(found).toBe(true);
  });

  it("a choice's outcome is kept after the vote", () => {
    let hurt = false;
    for (let seed = 1; seed < 200 && !hurt; seed++) {
      const open = toChoice(seed);
      if (!open) continue;
      for (const option of [0, 1] as const) {
        const last = chooseAll(open, option).state.log.at(-1)!;
        const out = last.eventOutcome!;
        expect(out).toBeDefined();
        expect(last.event!.choice).toBeDefined();
        expect(out.km).toEqual(expect.any(Number));
        expect(out.stock).toBeDefined();
        const all = last.report.healthChanges;
        expect(all.slice(all.length - out.healthChanges.length)).toEqual(out.healthChanges);
        if (out.healthChanges.length > 0) hurt = true;
      }
    }
    expect(hurt).toBe(true);
  });

  it("no event, no outcome", () => {
    let checked = false;
    for (let seed = 1; seed < 40 && !checked; seed++) {
      let s = toPlan(start(4, {}, seed).state);
      for (let day = 0; day < 60 && s.phase === "plan"; day++) {
        s = proposeOpen(s);
        s = voteAll(s, "go").state;
        if (s.phase === "choice") s = chooseAll(s, 0).state;
        if (s.caravan.arrivedDay !== null) {
          expect(s.log.at(-1)!.event).toBeNull();
          expect(s.log.at(-1)!.eventOutcome).toBeUndefined();
          checked = true;
          break;
        }
        s = nextAll(s).state;
      }
    }
    expect(checked).toBe(true);
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

  it("gives the next seat a fresh plan when the leader leaves mid-vote", () => {
    const s = proposeOpen(toPlan(start(4).state));
    expect(s.phase).toBe("vote");
    const seat = s.leader;
    const now = s.deadline - 5000;
    const t = g.onPlayerRemoved!(s, leaderId(s), ctx(now));
    expect(t.state.phase).toBe("plan");
    expect(t.state.leader).toBe((seat + 1) % 4);
    expect(t.state.deadline).toBe(now + 45_000);
    expect(t.state.ballot).toBeNull();
    expect(t.state.plan).toBeNull();
    expect(t.state.proposalNo).toBe(s.proposalNo); // nothing was voted down
    expect(t.state.travellers).not.toContain(s.players[seat]!.id);
  });

  it("keeps the day in the trip when a removal ends it mid-choice", () => {
    let found: S | null = null;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      let s = toPlan(start(5, { length: "short" }, seed).state);
      for (let day = 0; day < 12 && s.phase === "plan"; day++) {
        s = voteAll(proposeOpen(s), "go").state;
        if (s.phase === "choice") found = s;
        else if (s.phase === "summary") s = nextAll(s).state;
      }
    }
    expect(found).not.toBeNull();
    let s = found!;
    const day = s.draft!.log.day;
    const logged = s.log.length;
    const alive = s.travellers.filter((id) => s.caravan.health[id]! > 0);
    for (const id of alive.slice(1)) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, alive[0]!, ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("recap");
    expect(s.draft).toBeNull();
    expect(s.log).toHaveLength(logged + 1);
    expect(s.log.at(-1)!.day).toBe(day);
    expect(s.log.at(-1)!.proposals).toHaveLength(1);
    expect(s.log.at(-1)!.event!.choice).toBeUndefined(); // the choice never closed
  });

  it.each(["plan", "vote"] as const)("keeps a voted-down plan in the trip when a removal ends it mid-%s", (phase) => {
    let s = proposeOpen(toPlan(start(5).state));
    s = voteAll(s, "no-go").state; // the first plan fails; the next seat plans
    expect(s.phase).toBe("plan");
    if (phase === "vote") s = proposeOpen(s);
    expect(s.phase).toBe(phase);
    const day = s.caravan.day;
    for (const id of ["p0", "p1", "p2", "p3"]) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000)).state;
    expect(s.phase).toBe("recap");
    const last = s.log.at(-1)!;
    expect(last).toMatchObject({ day, unfinished: true, event: null });
    expect(last.report.km).toBe(0);
    expect(last.proposals).toHaveLength(1); // the open second vote never closed, so only the first counts
    expect(last.proposals[0]!.passed).toBe(false);
    expect(s.proposals).toEqual([]);
    const call = s.recap!.bigCalls.find((c) => c.day === day)!;
    expect(call.result).toBe("Rejected");
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

describe("the end tells one story", () => {
  const lines = tradeRoute.endLines.failed;

  it("everyone dead: the dead headline, the dead line", () => {
    let s = toPlan(start(5).state);
    for (const id of ["p0", "p1", "p2", "p3"]) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000)).state;
    expect(s.recap!.cause).toBe("all-dead");
    expect(lines.dead).toContain(s.recap!.line);
    s = ring(s).state;
    expect(g.getResult(s)!.headline).toBe("Everyone died on the trail");
  });

  it("out of time: the late headline, the late line", () => {
    let s = toPlan(start(4, { length: "short" }).state);
    const deadline = packFor(DEFAULT_SETTINGS.setting).routes.short.deadline;
    s.caravan.day = deadline;
    s = ok(act(s, leaderId(s), { type: "propose", plan: { ...g.getPublicState(s).openPlan, rest: true } })).state;
    s = voteAll(s, "go").state;
    if (s.phase === "choice") s = chooseAll(s, 0).state;
    s = nextAll(s).state;
    expect(s.phase).toBe("recap");
    expect(s.recap!.cause).toBe("deadline");
    expect(lines.deadline).toContain(s.recap!.line);
    s = ring(s).state;
    expect(g.getResult(s)!.headline).toBe(`The caravan did not arrive by day ${deadline}`);
  });

  it("everyone dead after the deadline never says time ran out", () => {
    let s = toPlan(start(5).state);
    s.caravan.day = packFor(DEFAULT_SETTINGS.setting).routes[s.settings.length].deadline + 1;
    for (const id of ["p0", "p1", "p2", "p3"]) s.caravan.health[id] = 0;
    s = g.onPlayerRemoved!(s, "p4", ctx(s.deadline - 1000)).state;
    expect(s.recap!.cause).toBe("all-dead");
    expect(lines.dead).toContain(s.recap!.line);
    expect(g.getResult(ring(s).state)!.headline).toBe("Everyone died on the trail");
  });

  it("the game ended early: no recap, no end line", () => {
    let s = toPlan(start(3).state);
    s = g.onPlayerRemoved!(s, "p0", ctx(s.deadline - 1000)).state;
    s = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000)).state;
    expect(s.recap).toBeNull();
    expect(g.getResult(s)!.headline).toBe("The game ended early.");
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
    // Recap sentences name travellers by token; the client fills in seat names.
    // (Event cards may say "Someone" in their own words, so take the card text out first.)
    const cards = new Set(s.log.map((d) => d.event?.text).filter(Boolean) as string[]);
    let worst = s.recap!.worstDay?.text ?? "";
    for (const c of cards) worst = worst.replace(c, "");
    const text = [worst, ...s.recap!.bigCalls.map((b) => b.result)].join(" ");
    expect(text).not.toContain("Someone");
    expect(s.recap!.worstDay?.text).toMatch(/\{\{p\d\}\}/);
    const named = fillNames(s.recap!.worstDay!.text, (id) => `Name-${id}`);
    expect(named).toMatch(/Name-p\d/);
    expect(named).not.toContain("{{");
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

describe("coin goal cards", () => {
  it("show the amount this table must reach", () => {
    let seen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = start(8, {}, seed).state;
      for (const id of ids(s)) {
        const goal = s.goals[id]!;
        if (goal.kind !== "coins") continue;
        seen++;
        expect([360, 570]).toContain(goal.atLeast); // 250 and 400, times 600 / 420 start coins
        expect(s.goalText[id]).toBe(`Arrive with at least ${goal.atLeast} coins.`);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("today's travel", () => {
  it("today is public only during a choice", () => {
    let s = toPlan(start(4, {}, 5).state);
    expect(g.getPublicState(s).today).toBeNull();
    s = proposeOpen(s);
    expect(s.phase).toBe("vote");
    expect(g.getPublicState(s).today).toBeNull();
    let seenChoice = false;
    for (let seed = 1; seed < 40 && !seenChoice; seed++) {
      const c = toChoice(seed);
      if (!c) continue;
      seenChoice = true;
      const today = g.getPublicState(c).today;
      expect(today).not.toBeNull();
      expect(today!.day).toBe(c.draft!.log.day);
      expect(today!.plan).toEqual(c.draft!.log.plan);
      expect(today!.report.km).toBe(c.draft!.log.report.km);
      expect(today!.report).not.toBe(c.draft!.log.report); // a copy
      const after = chooseAll(c, 0).state;
      expect(after.phase).toBe("summary");
      expect(g.getPublicState(after).today).toBeNull();
    }
    expect(seenChoice).toBe(true);
  });

  it("the day report waits 9 seconds", () => {
    let s = proposeOpen(toPlan(start(4, {}, 5).state));
    const now = 1234;
    const t = ok(act(s, ids(s)[0]!, { type: "vote", vote: "go" }, now));
    s = t.state;
    for (const id of ids(s).slice(1)) if (s.phase === "vote") s = ok(act(s, id, { type: "vote", vote: "go" }, now)).state;
    if (s.phase === "choice") for (const id of ids(s)) if (s.phase === "choice") s = ok(act(s, id, { type: "choose", option: 0 }, now)).state;
    expect(s.phase).toBe("summary");
    expect(s.deadline - now).toBe(9_000);
  });
});
