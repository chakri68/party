import { describe, expect, it } from "vitest";
import { allVoted, castVote, dropVoter, openBallot, stableHash, strictMajority, tally } from "../src/index.ts";

const ALLOWED = ["x", "y"] as const;

describe("casting", () => {
  it("turns away someone who wasn't eligible when it opened", () => {
    const b = openBallot<string>(["a", "b", "c"]);
    expect(castVote(b, "zed", "x", ALLOWED)?.code).toBe("not-eligible");
    expect(b.votes).toEqual({});
  });

  it("turns away a choice that isn't on the list", () => {
    const b = openBallot<string>(["a", "b", "c"]);
    expect(castVote(b, "a", "nope", ALLOWED)?.code).toBe("bad-choice");
    expect(b.votes).toEqual({});
  });

  it("lets a re-vote overwrite: still one vote each", () => {
    const b = openBallot<string>(["a", "b"]);
    expect(castVote(b, "a", "x", ALLOWED)).toBeNull();
    expect(castVote(b, "a", "y", ALLOWED)).toBeNull();
    expect(b.votes.a).toBe("y");
    expect(Object.keys(b.votes)).toHaveLength(1);
  });
});

describe("who has voted", () => {
  it("is all voted only once everyone eligible has", () => {
    const b = openBallot<string>(["a", "b"]);
    expect(allVoted(b)).toBe(false);
    castVote(b, "a", "x", ALLOWED);
    expect(allVoted(b)).toBe(false);
    castVote(b, "b", "x", ALLOWED);
    expect(allVoted(b)).toBe(true);
  });

  it("counts a strict majority of everyone eligible, not of those who voted", () => {
    const b = openBallot<string>(["a", "b", "c", "d"]);
    castVote(b, "a", "reject", ["reject"]);
    castVote(b, "b", "reject", ["reject"]);
    expect(strictMajority(b, "reject")).toBe(false); // 2 of 4 is not more than half
    castVote(b, "c", "reject", ["reject"]);
    expect(strictMajority(b, "reject")).toBe(true);
  });

  it("stops counting someone who leaves, and shrinks the denominator", () => {
    const b = openBallot<string>(["a", "b", "c"]);
    castVote(b, "a", "reject", ["reject"]);
    castVote(b, "b", "reject", ["reject"]);
    expect(strictMajority(b, "reject")).toBe(true);
    dropVoter(b, "c");
    expect(b.eligible).toEqual(["a", "b"]);
    expect(strictMajority(b, "reject")).toBe(true); // 2 of 2
    dropVoter(b, "a");
    expect(b.votes).toEqual({ b: "reject" });
    expect(strictMajority(b, "reject")).toBe(true); // 1 of 1: the vote left behind is all of the electorate
  });
});

describe("tally", () => {
  it("picks the clear winner and reports no tie", () => {
    const b = openBallot<string>(["a", "b", "c"]);
    castVote(b, "a", "y", ALLOWED);
    castVote(b, "b", "y", ALLOWED);
    castVote(b, "c", "x", ALLOWED);
    expect(tally(b, ALLOWED, "room")).toEqual({ winner: "y", tied: [], counts: { x: 1, y: 2 } });
  });

  it("reports a tie, and settles it the same whoever voted first", () => {
    const ab = openBallot<string>(["a", "b"]);
    castVote(ab, "a", "x", ALLOWED);
    castVote(ab, "b", "y", ALLOWED);
    const ba = openBallot<string>(["a", "b"]);
    castVote(ba, "b", "y", ALLOWED);
    castVote(ba, "a", "x", ALLOWED);
    const first = tally(ab, ALLOWED, "room");
    expect(first.tied).toEqual(["x", "y"]);
    expect(first.winner).not.toBeNull();
    expect(tally(ba, ALLOWED, "room")).toEqual(first);
  });

  it("gives an empty ballot no winner, and zeros for everyone", () => {
    expect(tally(openBallot<string>(["a"]), ALLOWED, "room")).toEqual({ winner: null, tied: [], counts: { x: 0, y: 0 } });
  });
});

describe("stableHash", () => {
  it("is Blind Rally's FNV-1a, as it was", () => {
    expect(stableHash("abc")).toBe(440920331);
  });
});
