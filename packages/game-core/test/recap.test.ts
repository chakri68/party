import { describe, expect, it } from "vitest";
import { buildRecap, emptyPartyLog, type PartyGame, type PartyLog, type PartyStats } from "../src/index.ts";

const NAMES = { a: "Asha", b: "Bilal", c: "Chen", d: "Dev", e: "Esha" };

function game(over: Partial<PartyGame> = {}): PartyGame {
  return { gameId: "cheat", endedAt: 0, players: ["a", "b", "c", "d", "e"], winnerIds: [], stats: {}, ...over };
}

function log(games: PartyGame[], extra: Partial<PartyLog> = {}): PartyLog {
  return { startedAt: 0, games, names: { ...NAMES }, endedAt: 60_000 * 80, ...extra };
}

/** One game carrying `stats`, nobody winning. */
const statsOnly = (stats: PartyStats) => log([game({ stats })]);
const ids = (l: PartyLog) => buildRecap(l, 0)!.awards.map((a) => a.id);

describe("buildRecap", () => {
  it("is null when no game finished", () => {
    expect(buildRecap(emptyPartyLog(), 0)).toBeNull();
  });

  it("counts games, minutes and the most played game", () => {
    const r = buildRecap(log([game({ gameId: "cheat" }), game({ gameId: "imposter" }), game({ gameId: "imposter" })]), 0)!;
    expect(r.gamesPlayed).toBe(3);
    expect(r.minutes).toBe(80);
    expect(r.topGameId).toBe("imposter");
  });

  it("breaks a most-played tie toward the latest game", () => {
    expect(buildRecap(log([game({ gameId: "cheat" }), game({ gameId: "imposter" })]), 0)!.topGameId).toBe("imposter");
  });

  it("uses now when the party hasn't ended", () => {
    expect(buildRecap(log([game()], { endedAt: null }), 60_000 * 5)!.minutes).toBe(5);
  });

  it("says it was a quiet night when nothing qualifies", () => {
    const r = buildRecap(log([game()]), 0)!;
    expect(r.awards).toEqual([]);
    expect(r.quiet).toBe("Quiet night. Play more to earn awards.");
  });

  it("names a champion from 2 wins, not 1", () => {
    expect(ids(log([game({ winnerIds: ["a"] })]))).toEqual([]);
    const r = buildRecap(log([game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] }), game({ players: ["b", "c"] })]), 0)!;
    expect(r.awards[0]).toEqual({ id: "champion", title: "Champion of the night", who: ["Asha"], line: "Won 2 of 2 games." });
    expect(r.quiet).toBeNull();
  });

  it("says each on a shared championship", () => {
    const r = buildRecap(log([game({ winnerIds: ["a", "b"] }), game({ winnerIds: ["a", "b"] })]), 0)!;
    expect(r.awards[0]).toMatchObject({ id: "champion", who: ["Asha", "Bilal"], line: "Won 2 games each." });
  });

  it.each([
    ["eye", "rightCalls", 2, "Sharpest eye", "Called 2 bluffs right."],
    ["suspicious", "votesAgainst", 3, "Most suspicious", "Got 3 votes against them."],
    ["bold", "bigBids", 3, "Boldest bidder", "Made 3 big bids."],
    ["quick", "firstGuesses", 2, "Fastest guesser", "Guessed first 2 times."],
    ["trusting", "wrongCalls", 3, "Too trusting", "Called 3 bluffs wrong."],
  ] as const)("%s fires at its minimum and not below", (id, key, min, title, line) => {
    expect(ids(statsOnly({ a: { [key]: min - 1 } }))).toEqual([]);
    expect(buildRecap(statsOnly({ a: { [key]: min } }), 0)!.awards).toEqual([{ id, title, who: ["Asha"], line }]);
  });

  it("adds survived and fooled for the best actor", () => {
    expect(ids(statsOnly({ a: { survivedAsBad: 1 } }))).toEqual([]);
    expect(buildRecap(statsOnly({ a: { survivedAsBad: 1, fooled: 1 } }), 0)!.awards).toEqual([
      { id: "sneaky", title: "Best actor", who: ["Asha"], line: "Fooled the table 2 times." },
    ]);
  });

  it("ranks the liar by lies nobody caught", () => {
    const r = buildRecap(statsOnly({ a: { liesTold: 9, liesUncaught: 3 }, b: { liesTold: 12, liesUncaught: 1 } }), 0)!;
    expect(r.awards[0]).toEqual({ id: "liar", title: "Biggest liar", who: ["Asha"], line: "Told 9 lies. 3 were never caught." });
  });

  it("falls back to lies told when nobody got away with 3", () => {
    const r = buildRecap(statsOnly({ a: { liesTold: 3 }, b: { liesTold: 4, liesUncaught: 2 } }), 0)!;
    expect(r.awards[0]).toEqual({ id: "liar", title: "Biggest liar", who: ["Bilal"], line: "Told 4 lies. 2 were never caught." });
    expect(buildRecap(statsOnly({ a: { liesTold: 3 } }), 0)!.awards[0]!.line).toBe("Told 3 lies.");
  });

  it("names two tied players", () => {
    expect(buildRecap(statsOnly({ a: { rightCalls: 2 }, b: { rightCalls: 2 } }), 0)!.awards[0]!.who).toEqual(["Asha", "Bilal"]);
  });

  it("skips an award four players tie for", () => {
    expect(ids(statsOnly({ a: { rightCalls: 2 }, b: { rightCalls: 2 }, c: { rightCalls: 2 }, d: { rightCalls: 2 } }))).toEqual([]);
  });

  it("stops at five awards", () => {
    const r = buildRecap(
      statsOnly({
        a: { liesTold: 5 },
        b: { rightCalls: 5 },
        c: { votesAgainst: 5 },
        d: { fooled: 5 },
        e: { bigBids: 5, firstGuesses: 5, wrongCalls: 5 },
      }),
      0,
    )!;
    expect(r.awards.map((a) => a.id)).toEqual(["liar", "eye", "suspicious", "sneaky", "bold"]);
  });

  it("passes an award to someone close behind who has none yet", () => {
    const r = buildRecap(
      log([game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] }), game({ stats: { a: { rightCalls: 4 }, b: { rightCalls: 3 } } })]),
      0,
    )!;
    expect(r.awards.map((x) => [x.id, x.who])).toEqual([["champion", ["Asha"]], ["eye", ["Bilal"]]]);
  });

  it("keeps it with the leader when the rest are further behind", () => {
    const r = buildRecap(
      log([game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] }), game({ stats: { a: { rightCalls: 5 }, b: { rightCalls: 3 } } })]),
      0,
    )!;
    expect(r.awards[1]).toMatchObject({ id: "eye", who: ["Asha"] });
  });

  it("still names a player who has left the room", () => {
    const l = log([game({ stats: { z: { rightCalls: 2 } }, players: ["z"] })]);
    l.names.z = "Zoya";
    expect(buildRecap(l, 0)!.awards[0]!.who).toEqual(["Zoya"]);
  });

  it("keeps it with the leader when too many tie right behind", () => {
    const r = buildRecap(
      log([
        game({ winnerIds: ["a"] }),
        game({ winnerIds: ["a"] }),
        game({ stats: { a: { rightCalls: 5 }, b: { rightCalls: 4 }, c: { rightCalls: 4 }, d: { rightCalls: 4 }, e: { rightCalls: 4 } } }),
      ]),
      0,
    )!;
    expect(r.awards[1]).toMatchObject({ id: "eye", who: ["Asha"] });
  });

  it("gives a tied liar card only the number they share", () => {
    const byUncaught = buildRecap(statsOnly({ a: { liesTold: 9, liesUncaught: 3 }, b: { liesTold: 4, liesUncaught: 3 } }), 0)!;
    expect(byUncaught.awards[0]).toMatchObject({ who: ["Asha", "Bilal"], line: "Each told 3 lies nobody caught." });
    const byTold = buildRecap(statsOnly({ a: { liesTold: 4, liesUncaught: 1 }, b: { liesTold: 4 } }), 0)!;
    expect(byTold.awards[0]).toMatchObject({ who: ["Asha", "Bilal"], line: "Each told 4 lies." });
  });
});
