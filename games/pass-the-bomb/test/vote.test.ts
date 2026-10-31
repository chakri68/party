import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { allWords } from "@games/words/dictionary";
import { describe, expect, it } from "vitest";
import { CATEGORY_WORDS } from "../server/categories.ts";
import { passTheBombGame as pb } from "../server/game.ts";
import { effectiveCluster } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  FUSE_MS,
  VOTE_MS,
  type PassTheBombEvent,
  type PassTheBombPublicState,
  type PassTheBombServerState,
  type PassTheBombSettings,
  type VoteChoice,
} from "../shared/types.ts";

type T = GameTransition<PassTheBombServerState, PassTheBombEvent>;
type S = PassTheBombServerState;

const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function start(n = 3, settings: Partial<PassTheBombSettings> = {}, deck: string[] | undefined = ["ing"]): T {
  return pb.createGame(players(n), { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(), deck && { deck });
}

const play = (s: S, id: string, text: string, now = 0) => pb.handleAction(s, id, pb.parseAction({ type: "word", text })!, ctx(now));
const cast = (s: S, id: string, choice: VoteChoice, now = 0, ballot = s.vote?.id ?? 0) =>
  pb.handleAction(s, id, pb.parseAction({ type: "vote", ballot, choice })!, ctx(now));

function ok(result: ReturnType<typeof play>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}
function err(result: ReturnType<typeof play>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}
const events = (t: T) => t.events.map((e) => e.event);
const types = (t: T) => t.events.map((e) => e.event.type);
const fuseSet = (t: T) => t.timers?.find((x) => x.kind === "set" && x.timerId === "fuse");
const pub = (s: S) => pb.getPublicState(s) as PassTheBombPublicState;

/** "singz": fits ING, not a word. p1 holds it at the start of a 3-player game. */
const UNKNOWN = "singz";

describe("unknown words, by setting", () => {
  it("strict rejects, allow accepts", () => {
    expect(err(play(start(3, { unknown: "strict" }).state, "p1", UNKNOWN))).toBe("not-a-word");
    const t = ok(play(start(3, { unknown: "allow" }).state, "p1", UNKNOWN));
    expect(events(t)).toEqual([{ type: "passed", from: "p1", to: "p2", word: UNKNOWN }]);
    expect(t.state.used).toContain(UNKNOWN);
  });

  it("known words never go to a vote", () => {
    expect(types(ok(play(start().state, "p1", "singer")))).toEqual(["passed"]);
  });
});

describe("the vote", () => {
  it("opens with the fuse frozen and everyone else on the ballot", () => {
    const s0 = start(4).state;
    const left = s0.fuseEndsAt - 3000;
    const t = ok(play(s0, "p1", UNKNOWN, 3000));
    expect(events(t)).toEqual([{ type: "vote-opened", ballot: 1, by: "p1", word: UNKNOWN }]);
    expect(t.timers).toEqual([
      { kind: "cancel", timerId: "fuse" },
      { kind: "set", timerId: "vote", delayMs: VOTE_MS },
    ]);
    expect(t.state).toMatchObject({ phase: "vote", fuseLeft: left, holdVotes: 1, holderId: "p1" });
    expect(t.state.vote!.ballot.eligible).toEqual(["p0", "p2", "p3"]);
    expect(pub(t.state).vote).toMatchObject({ by: "p1", word: UNKNOWN, voters: ["p0", "p2", "p3"], voted: [], ms: VOTE_MS });
    expect(pb.getPrivateState(t.state, "p0")).toMatchObject({ canVote: true, myVote: null, holding: false });
    expect(pb.getPrivateState(t.state, "p1")).toMatchObject({ canVote: false, holding: false });
    // While it's open: no words, no typing, no skipping, nobody awaited.
    expect(err(play(t.state, "p1", "singer"))).toBe("voting");
    expect(pb.onStream!(t.state, "p1", { turn: t.state.turn, text: "s" })).toBeNull();
    expect(pb.skipTurn!(t.state, "p1", ctx()).state).toBe(t.state);
    expect(pb.getAwaitedPlayerIds(t.state)).toEqual([]);
    // A fuse alarm that slipped past the cancel does nothing.
    expect(pb.onTimer!(t.state, "fuse", ctx(99_999)).state).toBe(t.state);
  });

  it("hides how anyone voted until it closes", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN)).state;
    s = ok(cast(s, "p0", "reject")).state;
    expect(s.phase).toBe("vote");
    const everyone = JSON.stringify(pub(s)) + JSON.stringify(pb.getPrivateState(s, "p2")) + JSON.stringify(pb.getPrivateState(s, "p1"));
    expect(everyone).not.toContain("reject");
    expect(pub(s).vote!.voted).toEqual(["p0"]);
    expect(pb.getPrivateState(s, "p0").myVote).toBe("reject");
    // The fuse's length isn't in there either.
    expect(everyone).not.toContain(String(s.fuseLeft));
  });

  it("a strict majority rejects: the holder keeps it, fuse resumed, word stays rejected", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN, 1000)).state;
    const left = s.fuseLeft;
    s = ok(cast(s, "p0", "reject", 2000)).state;
    const t = ok(cast(s, "p2", "reject", 2500));
    expect(events(t)).toEqual([
      { type: "vote-closed", id: 1, by: "p1", word: UNKNOWN, allowed: false, votes: { p0: "reject", p2: "reject" } },
    ]);
    expect(t.timers).toEqual([
      { kind: "cancel", timerId: "vote" },
      { kind: "set", timerId: "fuse", delayMs: left },
    ]);
    expect(t.state).toMatchObject({ phase: "live", holderId: "p1", vote: null, fuseEndsAt: 2500 + left });
    expect(t.state.used).not.toContain(UNKNOWN);
    expect(pub(t.state).lastVote).toMatchObject({ allowed: false, votes: { p0: "reject", p2: "reject" } });
    // Not again this game, and the holder can still play a real one.
    expect(err(play(t.state, "p1", UNKNOWN, 2600))).toBe("not-a-word");
    expect(types(ok(play(t.state, "p1", "singer", 2600)))).toEqual(["passed"]);
  });

  it("a tie lets it through, and it passes the bomb with what was left", () => {
    let s = ok(play(start(5).state, "p1", UNKNOWN, 1000)).state;
    const left = s.fuseLeft;
    s = ok(cast(s, "p0", "reject")).state;
    s = ok(cast(s, "p2", "reject")).state;
    s = ok(cast(s, "p3", "allow")).state;
    const t = ok(cast(s, "p4", "allow", 1500));
    expect(types(t)).toEqual(["vote-closed", "passed"]);
    expect(events(t)[1]).toEqual({ type: "passed", from: "p1", to: "p2", word: UNKNOWN, voted: true });
    expect(fuseSet(t)).toEqual({ kind: "set", timerId: "fuse", delayMs: left });
    expect(t.state).toMatchObject({ phase: "live", holderId: "p2", holdVotes: 0 });
    expect(t.state.used).toContain(UNKNOWN);
    expect(pub(t.state).lastVote).toMatchObject({ allowed: true, word: UNKNOWN });
  });

  it("closes early once it's settled either way", () => {
    // 3 voters: two rejects is a majority, no need to wait for the third.
    let s = ok(play(start(4).state, "p1", UNKNOWN)).state;
    s = ok(cast(s, "p0", "reject")).state;
    expect(s.phase).toBe("vote");
    expect(ok(cast(s, "p2", "reject")).state.phase).toBe("live");
    // Two allows: rejects can't reach a majority any more.
    s = ok(play(start(4).state, "p1", UNKNOWN)).state;
    s = ok(cast(s, "p0", "allow")).state;
    const t = ok(cast(s, "p3", "allow"));
    expect(types(t)).toEqual(["vote-closed", "passed"]);
  });

  it("the timer closes the rest; silence allows; an early alarm re-arms", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN, 1000)).state;
    s = ok(cast(s, "p0", "reject", 1200)).state;
    const early = pb.onTimer!(s, "vote", ctx(1000 + VOTE_MS - 2000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "vote", delayMs: 2000 }]);
    expect(err(cast(s, "p2", "reject", 1000 + VOTE_MS))).toBe("time-up");
    const t = pb.onTimer!(s, "vote", ctx(1000 + VOTE_MS));
    expect(types(t as T)).toEqual(["vote-closed", "passed"]);
    // A stray vote alarm afterwards does nothing.
    expect(pb.onTimer!(t.state, "vote", ctx(99_999)).state).toBe(t.state);
  });

  it("votes: re-voting overwrites; strangers, the submitter, old ballots and bad choices are turned away", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN)).state;
    s = ok(cast(s, "p0", "reject")).state;
    s = ok(cast(s, "p0", "allow")).state;
    expect(s.vote!.ballot.votes).toEqual({ p0: "allow" });
    expect(err(cast(s, "p1", "allow"))).toBe("not-eligible");
    expect(err(cast(s, "p2", "allow", 0, 99))).toBe("no-vote");
    expect(pb.parseAction({ type: "vote", ballot: 1, choice: "maybe" })).toBeNull();
    expect(err(cast(start(3).state, "p0", "allow", 0, 1))).toBe("no-vote");
  });

  it("two per hold, then unknown words just bounce; the next holder gets two of their own", () => {
    let s = start(3, {}, ["ing"]).state;
    for (const word of ["singz", "pingz"]) {
      s = ok(play(s, "p1", word)).state;
      s = ok(cast(s, "p0", "reject")).state;
      s = ok(cast(s, "p2", "reject")).state;
    }
    expect(s.holdVotes).toBe(2);
    const third = play(s, "p1", "zingz");
    expect(err(third)).toBe("not-a-word");
    expect(third.ok || third.error.message).toMatch(/no votes left/);
    s = ok(play(s, "p1", "singer")).state;
    expect(s.phase).toBe("live");
    expect(types(ok(play(s, "p2", "zingz")))).toEqual(["vote-opened"]);
  });

  it("with nobody to ask, it goes through", () => {
    let s = start(2).state;
    s = pb.onPlayerDisconnected!(s, "p0", ctx()).state;
    const t = ok(play(s, "p1", UNKNOWN));
    expect(types(t)).toEqual(["passed"]);
  });

  it("a voter dropping or leaving stops counting, and that can settle it", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN)).state;
    s = ok(cast(s, "p0", "reject")).state;
    s = pb.onPlayerDisconnected!(s, "p3", ctx()).state;
    expect(s.vote!.ballot.eligible).toEqual(["p0", "p2"]);
    // Back again: the ballot was snapshotted, they're not on it.
    s = pb.onPlayerReconnected!(s, "p3", ctx()).state;
    expect(err(cast(s, "p3", "reject"))).toBe("not-eligible");
    // p2 leaves: p0's reject is now everyone.
    const t = pb.onPlayerRemoved!(s, "p2", ctx());
    expect(types(t as T)).toEqual(["vote-closed", "left"]);
    expect(t.state).toMatchObject({ phase: "live", holderId: "p1" });
    expect((t.events[0]!.event as { allowed: boolean }).allowed).toBe(false);
  });

  it("everyone on the ballot gone: it goes through", () => {
    let s = ok(play(start(3).state, "p1", UNKNOWN)).state;
    s = pb.onPlayerDisconnected!(s, "p0", ctx()).state;
    const t = pb.onPlayerDisconnected!(s, "p2", ctx());
    expect(types(t as T)).toEqual(["vote-closed", "passed"]);
  });

  it("the submitter leaving calls it off; the bomb moves on with the fuse resumed", () => {
    let s = ok(play(start(4).state, "p1", UNKNOWN, 1000)).state;
    const left = s.fuseLeft;
    const t = pb.onPlayerRemoved!(s, "p1", ctx(2000));
    expect(types(t as T)).toEqual(["vote-called-off", "left"]);
    expect(t.timers).toEqual([
      { kind: "cancel", timerId: "vote" },
      { kind: "set", timerId: "fuse", delayMs: left },
    ]);
    expect(t.state).toMatchObject({ phase: "live", holderId: "p2", vote: null });
    // Dropping, though, changes nothing: the room still decides.
    s = pb.onPlayerDisconnected!(s, "p1", ctx()).state;
    expect(s.phase).toBe("vote");
  });

  it("everyone else leaving mid-vote ends the game and both timers", () => {
    let s = ok(play(start(2, {}, ["ing"]).state, "p1", UNKNOWN)).state;
    const t = pb.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state.phase).toBe("finished");
    expect(t.timers).toEqual(expect.arrayContaining([
      { kind: "cancel", timerId: "vote" },
      { kind: "cancel", timerId: "fuse" },
    ]));
    expect(t.state.vote).toBeNull();
  });
});

describe("modes in play", () => {
  it("time's up at the fuse's deadline, alarm or not", () => {
    const s = start().state;
    expect(err(play(s, "p1", "singer", s.fuseEndsAt))).toBe("time-up");
    expect(ok(play(s, "p1", "singer", s.fuseEndsAt - 1)).state.holderId).toBe("p2");
  });

  it("ending: at the end, or it's the wrong shape and no vote can save it", () => {
    const s = start(3, { ending: true }).state;
    expect(err(play(s, "p1", "singer"))).toBe("bad-word");
    expect(err(play(s, "p1", "singerz"))).toBe("bad-word");
    expect(types(ok(play(s, "p1", "running")))).toEqual(["passed"]);
  });

  it("length: 5 to 10", () => {
    const s = start(3, { length: true }).state;
    expect(err(play(s, "p1", "sing"))).toBe("bad-word");
    expect(err(play(s, "p1", "outstanding"))).toBe("bad-word");
    expect(types(ok(play(s, "p1", "singer")))).toEqual(["passed"]);
  });

  it("reverse: the bomb shows it backwards, the word needs it forwards", () => {
    const s = start(3, { reverse: true }, ["ing", "tr"]).state;
    const shown = pub(s).cluster;
    expect(shown).toBe([...s.cluster].reverse().join(""));
    expect(effectiveCluster(shown, pub(s).modes)).toBe(s.cluster);
    expect(types(ok(play(s, "p1", s.cluster === "ing" ? "singer" : "train")))).toEqual(["passed"]);
    expect(err(play(s, "p1", s.cluster === "ing" ? "gnisty" : "rtain"))).toBe("bad-word");
  });

  it("category: shown, on the list passes, off the list goes to the room", () => {
    const s = start(3, { category: true }, undefined).state;
    expect(s.category).not.toBeNull();
    expect(pub(s).category).toBe(s.category);
    const listed = CATEGORY_WORDS[s.category!].find((w) => w.includes(s.cluster))!;
    expect(types(ok(play(s, "p1", listed)))).toEqual(["passed"]);
    // A real word, the right letters, the wrong list.
    const offList = allWords().find((w) => w.includes(s.cluster) && !CATEGORY_WORDS[s.category!].includes(w))!;
    expect(types(ok(play(s, "p1", offList)))).toEqual(["vote-opened"]);
    const strict = { ...s, settings: { ...s.settings, unknown: "strict" as const } };
    expect(err(play(strict, "p1", offList))).toBe("not-a-word");
  });

  it("a no is only a no for its category: ARM voted down as an animal still counts as body", () => {
    let s = start(3, { category: true }, undefined).state;
    s = { ...s, category: "animals", cluster: "ar" };
    s = ok(play(s, "p1", "arm")).state;
    s = ok(cast(s, "p0", "reject")).state;
    s = ok(cast(s, "p2", "reject")).state;
    expect(s).toMatchObject({ phase: "live", holderId: "p1" });
    // Still an animals prompt: no second vote.
    expect(err(play(s, "p1", "arm"))).toBe("not-a-word");
    // A body prompt: it's on the list, so it just counts.
    s = { ...s, category: "body", cluster: "ar" };
    expect(types(ok(play(s, "p1", "arm")))).toEqual(["passed"]);
  });

  it("an early fuse alarm re-arms instead of going off", () => {
    const s = start().state;
    const early = pb.onTimer!(s, "fuse", ctx(s.fuseEndsAt - 2000));
    expect(early.state).toBe(s);
    expect(early.timers).toEqual([{ kind: "set", timerId: "fuse", delayMs: 2000 }]);
    // Within the slack, it goes.
    expect(types(pb.onTimer!(s, "fuse", ctx(s.fuseEndsAt - 400)) as T)).toEqual(["boom"]);
  });

  it("parseSettings takes the modes and unknown, and turns away junk", () => {
    expect(pb.parseSettings({ ending: true, unknown: "strict" })).toEqual({ ...DEFAULT_SETTINGS, ending: true, unknown: "strict" });
    expect(pb.parseSettings({ ending: "yes" })).toBeNull();
    expect(pb.parseSettings({ unknown: "maybe" })).toBeNull();
    expect(pb.parseSettings({ ending: true, reverse: true, length: true, category: true })).not.toBeNull();
    expect(pb.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("random games, every combination", () => {
  it("always end, votes and all", () => {
    for (let combo = 0; combo < 16; combo++) {
      const settings: PassTheBombSettings = {
        ...DEFAULT_SETTINGS,
        ending: !!(combo & 1),
        reverse: !!(combo & 2),
        length: !!(combo & 4),
        category: !!(combo & 8),
        lives: 1,
      };
      for (let seed = 0; seed < 4; seed++) {
        const rng = seededRandomInt(combo * 31 + seed);
        const n = 2 + rng(6);
        let now = 0;
        let s = pb.createGame(players(n), settings, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
        let steps = 0;
        while (s.phase !== "finished") {
          if (++steps > 3000) throw new Error(`combo ${combo} seed ${seed}: no end in sight`);
          now += 10;
          const roll = rng(10);
          let next: S | null = null;
          if (s.phase === "live" && roll < 5) {
            const pool = settings.category ? CATEGORY_WORDS[s.category!] : allWords();
            const word = pool.find((w) => (settings.ending ? w.endsWith(s.cluster) : w.includes(s.cluster))
              && (!settings.length || (w.length >= 5 && w.length <= 10)) && !s.used.includes(w));
            const r = play(s, s.holderId, word ?? `${s.cluster}zzzz`.slice(0, 8), now);
            if (r.ok) next = r.transition.state;
          } else if (s.phase === "live" && roll === 5) {
            const r = play(s, s.holderId, settings.ending ? `zzq${s.cluster}` : `${s.cluster}qzz`, now);
            if (r.ok) next = r.transition.state;
          } else if (s.phase === "vote" && roll < 8) {
            const voter = s.vote!.ballot.eligible[rng(s.vote!.ballot.eligible.length)]!;
            const r = cast(s, voter, rng(2) ? "reject" : "allow", now);
            if (r.ok) next = r.transition.state;
          } else if (s.phase === "vote") {
            now = s.vote!.deadline;
            next = pb.onTimer!(s, "vote", ctx(now)).state;
          }
          if (!next) {
            if (s.phase === "vote") continue;
            now = Math.max(now, s.fuseEndsAt);
            next = pb.onTimer!(s, "fuse", ctx(now, seed + steps)).state;
          }
          s = next;
          if (s.phase === "live") {
            const holder = s.players.find((p) => p.id === s.holderId)!;
            expect(holder.lives > 0 && !holder.removed).toBe(true);
          }
        }
        expect(pb.getResult(s)!.winnerIds).toHaveLength(1);
      }
    }
  });
});

describe("a game saved before the modes and the vote", () => {
  /** What Durable Object storage holds for a game started on 1966614: none of the vote's fields, two settings. */
  function preUpgrade(): S {
    const s: Partial<S> = structuredClone(start().state);
    for (const k of ["category", "rejected", "fuseEndsAt", "fuseLeft", "holdVotes", "voteSeq", "vote", "lastVote"] as const) delete s[k];
    s.settings = { lives: DEFAULT_SETTINGS.lives, fuse: DEFAULT_SETTINGS.fuse } as PassTheBombSettings;
    return s as S;
  }

  it("takes an unknown word to the vote, and remembers the no", () => {
    const t = ok(play(preUpgrade(), "p1", UNKNOWN, 3000));
    expect(t.state).toMatchObject({ phase: "vote", holdVotes: 1, voteSeq: 1, category: null });
    expect(t.state.vote).toMatchObject({ id: 1, by: "p1", word: UNKNOWN });
    // Its fuse end was never stored: the vote freezes it at the shortest the setting allows.
    expect(t.state.fuseLeft).toBe(FUSE_MS.normal[0]);
    const r = ok(cast(ok(cast(t.state, "p0", "reject", 3500)).state, "p2", "reject", 3600));
    expect(r.state.rejected).toEqual([UNKNOWN]);
    expect(fuseSet(r)).toMatchObject({ delayMs: t.state.fuseLeft });
    expect(err(play(r.state, "p1", UNKNOWN, 4000))).toBe("not-a-word");
  });

  it("reads out a public state with the new fields filled in", () => {
    expect(pub(preUpgrade())).toMatchObject({ category: null, unknown: "vote", vote: null, lastVote: null });
  });

  it("goes off when its old alarm lands", () => {
    expect(types(pb.onTimer!(preUpgrade(), "fuse", ctx(20_000)) as T)).toEqual(["boom"]);
  });
});
