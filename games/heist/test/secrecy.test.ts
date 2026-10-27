import type { GameEventEnvelope } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { act, ctx, deal, g, ids, leaderId, ok, propose, ring, type S, start, type T, toPropose, voteAll } from "./helpers.ts";

/** Moles p1, p3, p5. */
const SEVEN = "cmcmcmc";
const ALL = [...SEVEN].map((_, i) => `p${i}`);
const MOLES = ["p1", "p3", "p5"];
const CREW = ALL.filter((id) => !MOLES.includes(id));

/**
 * Everything a seat mustn't see before the end: each alignment (as the private
 * state words it), the moles' list, each mole's cards left, every vote in an
 * open ballot. And, at any point including the end, every card played.
 */
function sealed(t: { state: S; events: GameEventEnvelope<unknown>[] }, label: string): void {
  const s = t.state;
  const check = (secret: string, allowed: string[]) =>
    expect(findLeaks({ def: g, state: s, events: t.events, players: ALL, secret, allowed }), `${label}: ${secret}`).toEqual([]);

  if (s.phase !== "finished") {
    check('"alignment":"mole"', MOLES);
    check('"alignment":"crew"', CREW);
    check('"moles":["', MOLES);
    check('"alignments":{', []);
    for (const n of [0, 1, 2]) check(`"budget":${n}`, MOLES.filter((id) => s.budget[id] === n));
    // The server's own maps, in case one is ever passed through whole.
    for (const id of ALL) check(`"${id}":"${s.alignment[id]}"`, []);
    check('"budget":{', []);
  }
  for (const card of ["clean", "sabotage"]) check(`"card":"${card}"`, ALL.filter((id) => s.cards[id] === card));
  for (const [id, card] of Object.entries(s.cards)) check(`"${id}":"${card}"`, []);
  for (const vote of ["go", "no-go"]) check(`"vote":"${vote}"`, ALL.filter((id) => s.ballot?.votes[id] === vote));
  // History holds every closed ballot whole; an open one as a map is a leak.
  if (s.ballot && Object.keys(s.ballot.votes).length) check(JSON.stringify(s.ballot.votes), []);
}

const step = (_prev: T, label: string, next: T): T => {
  sealed(next, label);
  return next;
};

describe("secrets", () => {
  it("keep through the reveal, proposals, votes, jobs, heat, voids and leavers", () => {
    let t: T = start(SEVEN, {}, 5);
    sealed(t, "deal");
    for (const id of ALL) t = step(t, `ack ${id}`, ok(act(t.state, id, { type: "ack" })));

    // Job 0: p0 takes a mole along; it passes; the mole sabotages.
    t = step(t, "propose 0", ok(act(t.state, "p0", { type: "propose", crew: ["p0", "p1", "p2"] })));
    for (const id of ALL) t = step(t, `vote ${id}`, ok(act(t.state, id, { type: "vote", vote: id === "p4" ? "no-go" : "go" })));
    expect(t.state.phase).toBe("job");
    t = step(t, "card p0", ok(act(t.state, "p0", { type: "card", card: "clean" })));
    t = step(t, "card p1", ok(act(t.state, "p1", { type: "card", card: "sabotage" })));
    t = step(t, "job 0 ends", ring(t.state));
    expect(t.state.jobs[0]).toMatchObject({ sabotaged: 1, auto: 1 });

    // Job 1: p1 times out, p2's crew is voted down, p3's passes and is voided.
    t = step(t, "p1 times out", ring(t.state));
    t = step(t, "propose p2", ok(act(t.state, "p2", { type: "propose", crew: ["p2", "p3", "p4"] })));
    t = step(t, "vote p5", ok(act(t.state, "p5", { type: "vote", vote: "no-go" })));
    t = step(t, "vote down", ring(t.state));
    expect(t.state.heat).toBe(2);
    t = step(t, "propose p3", ok(act(t.state, "p3", { type: "propose", crew: ["p3", "p5", "p6"] })));
    t = step(t, "vote all", voteAll(t.state, "go"));
    t = step(t, "card p3", ok(act(t.state, "p3", { type: "card", card: "sabotage" })));
    t = step(t, "card p5", ok(act(t.state, "p5", { type: "card", card: "sabotage" })));
    t = step(t, "card p5 again", ok(act(t.state, "p5", { type: "card", card: "clean" })));
    t = step(t, "p6 leaves mid-job", g.onPlayerRemoved!(t.state, "p6", ctx(t.state.deadline - 1000)));
    expect(t.state).toMatchObject({ phase: "propose", budget: { p1: 1, p3: 2, p5: 2 } });

    // A leaver mid-vote, then the moles take it by heat.
    t = step(t, "propose again", ok(act(t.state, leaderId(t.state), { type: "propose", crew: ["p0", "p2"] }))); // six left: size 2
    t = step(t, "vote p0", ok(act(t.state, "p0", { type: "vote", vote: "go" })));
    t = step(t, "p5 leaves mid-vote", g.onPlayerRemoved!(t.state, "p5", ctx(t.state.deadline - 1000)));
    t = step(t, "vote down again", ring(t.state));
    expect(t.state).toMatchObject({ phase: "propose", heat: 0, score: { mole: 2 } });
    while (t.state.phase !== "finished") t = step(t, "heat", ring(t.state));
    expect(t.state.winner).toBe("mole");
  });

  it("the alignments come out at the end, and the cards never do", () => {
    let s = toPropose(start(SEVEN, {}, 5).state);
    s = propose(s, ["p1", "p3", "p0"]);
    s = voteAll(s, "go").state;
    s = ok(act(s, "p1", { type: "card", card: "sabotage" })).state;
    s = ring(s).state;
    for (let i = 0; i < 6; i++) s = ring(s).state;
    expect(s.phase).toBe("finished");
    const pub = g.getPublicState(s);
    expect(pub.alignments).toEqual(Object.fromEntries(ALL.map((id, i) => [id, deal(SEVEN)[i]])));
    expect(pub.jobs[0]).toEqual({ job: 0, crew: ["p0", "p1", "p3"], sabotaged: 1, auto: 2, winner: "mole", heat: false });
    expect(JSON.stringify(pub)).not.toContain('"card"');
  });

  it("an interrupted game shows alignments too", () => {
    let s = start("cmcmc").state;
    s = g.onPlayerRemoved!(s, "p0", ctx(1000)).state;
    expect(s.phase).toBe("finished");
    expect(g.getPublicState(s).alignments).not.toBeNull();
  });

  it("a job looks the same from outside whoever's a mole and whatever they toyed with", () => {
    // Same seats on the job, every card ends up Clean; one deal has a mole on
    // the crew who picked Sabotage first and took it back. Public states,
    // events and awaited lists must match to the byte.
    const run = (pattern: string, toy: boolean) => {
      let t: T = { state: toPropose(start(pattern, {}, 9).state), events: [] };
      const seen: unknown[] = [];
      t = ok(act(t.state, "p0", { type: "propose", crew: ["p0", "p1", "p2"] }));
      t = voteAll(t.state, "go");
      for (const id of ["p2", "p1", "p0"]) {
        if (toy && id === "p1") t = ok(act(t.state, id, { type: "card", card: "sabotage" }));
        t = ok(act(t.state, id, { type: "card", card: "clean" }));
        seen.push(g.getPublicState(t.state), g.getAwaitedPlayerIds(t.state), t.events);
      }
      t = ring(t.state);
      seen.push(g.getPublicState(t.state), t.events);
      return JSON.stringify(seen);
    };
    expect(run("cmcmcmc", true)).toBe(run("ccmcmcm", false));
  });

  it("a seat that isn't in the game gets nothing; leavers keep their own card", () => {
    let s = toPropose(start(SEVEN).state);
    expect(g.getPrivateState(s, "zz")).toMatchObject({ alignment: null, moles: null });
    s = g.onPlayerRemoved!(s, "p6", ctx(1000)).state;
    expect(ids(s)).not.toContain("p6");
    expect(g.getPrivateState(s, "p6")).toMatchObject({ alignment: "crew", canVote: false });
  });
});
