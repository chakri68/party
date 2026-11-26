import { describe, expect, it } from "vitest";
import { buildRecap, emptyPartyLog, emptyTableLog, type PartyGame, type PartyLog, type PartyStats, type TableCounts } from "../src/index.ts";

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
    ["blame", "problemsPassed", 3, "Not my problem", "Passed 3 Problems on."],
    ["backstab", "pushedOver", 2, "Backstabber", "Pushed 2 players over the limit."],
    ["bold", "bigBids", 3, "Boldest bidder", "Made 3 big bids."],
    ["quick", "firstGuesses", 2, "Fastest guesser", "Guessed first 2 times."],
    ["trusting", "wrongCalls", 3, "Too trusting", "Called 3 bluffs wrong."],
    ["doubter", "noGoVotes", 5, "Hardest to convince", "Voted No-go 5 times."],
    ["rescuer", "rescues", 2, "Always there", "Got 2 friends back up."],
    ["fire", "firesLit", 2, "Fire starter", "Lit 2 fires."],
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

  it("gives On a roll for 3 wins in a row, not 2", () => {
    const lost = log([
      game({ winnerIds: ["a"] }),
      game({ winnerIds: ["a"] }),
      game({ winnerIds: ["b"] }),
      game({ winnerIds: ["a"] }),
      game({ winnerIds: ["a"] }),
    ]);
    expect(ids(lost)).not.toContain("streak");
    const r = buildRecap(
      log([game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] }), game({ players: ["b", "c"], winnerIds: ["b"] }), game({ winnerIds: ["a"] })]),
      0,
    )!;
    expect(r.awards.find((x) => x.id === "streak")).toEqual({ id: "streak", title: "On a roll", who: ["Asha"], line: "Won 3 games in a row." });
  });

  it("names two players who beat each other as Rivals", () => {
    const ab = (n: number) => Array.from({ length: n }, () => game({ players: ["a", "b"], winnerIds: ["a"] }));
    const ba = (n: number) => Array.from({ length: n }, () => game({ players: ["a", "b"], winnerIds: ["b"] }));
    const rivals = (games: PartyGame[]) => buildRecap(log(games), 0)!.awards.find((x) => x.id === "rivals");
    expect(rivals([...ba(2), ...ab(3)])).toEqual({ id: "rivals", title: "Rivals", who: ["Asha", "Bilal"], line: "Beat each other 3 and 2 times." });
    expect(rivals([...ab(2), ...ba(2)])).toMatchObject({ who: ["Asha", "Bilal"], line: "Beat each other 2 times each." });
    expect(rivals([...ab(2), ...ba(1)])).toBeUndefined();
  });

  it("does not count a game only one of the pair played", () => {
    const games = [
      game({ players: ["a", "b"], winnerIds: ["a"] }),
      game({ players: ["a", "b"], winnerIds: ["a"] }),
      game({ players: ["a", "b"], winnerIds: ["b"] }),
      game({ players: ["b", "c"], winnerIds: ["b"] }),
    ];
    expect(ids(log(games))).not.toContain("rivals");
  });

  it("picks the rivals with the highest smaller count", () => {
    const g = (players: string[], w: string) => game({ players, winnerIds: [w] });
    const games = [
      ...[1, 2, 3].map(() => g(["a", "b"], "a")),
      ...[1, 2].map(() => g(["a", "b"], "b")),
      ...[1, 2, 3].map(() => g(["c", "d"], "c")),
      ...[1, 2, 3].map(() => g(["c", "d"], "d")),
    ];
    expect(buildRecap(log(games), 0)!.awards.find((x) => x.id === "rivals")).toMatchObject({ who: ["Chen", "Dev"], line: "Beat each other 3 times each." });
  });

  it("leaves On a roll out when five game awards already fill the list", () => {
    const r = buildRecap(
      log([
        game({ winnerIds: ["e"] }),
        game({ winnerIds: ["e"] }),
        game({ winnerIds: ["e"], stats: { a: { liesTold: 5 }, b: { rightCalls: 5 }, c: { votesAgainst: 5 }, d: { fooled: 5 } } }),
      ]),
      0,
    )!;
    expect(r.awards.map((a) => a.id)).toEqual(["champion", "liar", "eye", "suspicious", "sneaky"]);
  });
});

/** A log with one finished game and these table counts. Everyone listed is counted unless `counted` says otherwise. */
function tableLog(seats: Record<string, TableCounts>, counted = Object.keys(seats), games: PartyGame[] = [game()]): PartyLog {
  return log(games, { table: { seats, loudest: null, counted } });
}
const tableIds = (l: PartyLog) => buildRecap(l, 0)!.table.map((a) => a.id);

describe("table awards", () => {
  it.each([
    ["chatty", "talkMs", 180_000, "Most talkative", "Talked for 3 minutes."],
    ["overtalk", "overTalks", 8, "Talks over people", "Started talking over someone 8 times."],
    ["backseat", "offTurnMs", 120_000, "Backseat player", "Talked for 2 minutes on other people's turns."],
    ["dj", "sounds", 10, "DJ of the night", "Played 10 sounds."],
    ["speech", "winTalkMs", 30_000, "Victory speech", "Talked the most after winning."],
    ["hype", "reactions", 10, "Most excited", "Sent 10 reactions."],
    ["typist", "chats", 15, "Most messages", "Sent 15 chat messages."],
  ] as const)("%s fires at its minimum and not below", (id, key, min, title, line) => {
    expect(tableIds(tableLog({ a: { [key]: min - 1 } }))).toEqual([]);
    expect(buildRecap(tableLog({ a: { [key]: min } }), 0)!.table).toEqual([{ id, title, who: ["Asha"], line }]);
  });

  it("rounds minutes down", () => {
    expect(buildRecap(tableLog({ a: { talkMs: 14 * 60_000 + 59_999 } }), 0)!.table[0]!.line).toBe("Talked for 14 minutes.");
  });

  it("gives the biggest shout only to someone who talked a minute", () => {
    expect(tableIds(tableLog({ a: { peak: 0.9, talkMs: 59_999 } }))).toEqual([]);
    expect(tableIds(tableLog({ a: { peak: 0, talkMs: 60_000 } }))).toEqual([]);
    expect(buildRecap(tableLog({ a: { peak: 0.4, talkMs: 60_000 }, b: { peak: 0.9, talkMs: 10_000 } }), 0)!.table).toEqual([
      { id: "shout", title: "Biggest shout", who: ["Asha"], line: "Had the loudest shout of the night." },
    ]);
  });

  it("gives Quiet but strong to the quietest winner who was in voice 15 minutes", () => {
    const wins = [game({ winnerIds: ["a", "b"] }), game({ winnerIds: ["a", "b"] }), game({ winnerIds: ["a", "b"] })];
    const r = buildRecap(
      tableLog(
        {
          a: { voiceMs: 900_000, talkMs: 50_000 },
          b: { voiceMs: 900_000, talkMs: 20_000 },
          c: { voiceMs: 900_000, talkMs: 0 },
          d: { voiceMs: 899_999, talkMs: 0 },
        },
        undefined,
        wins,
      ),
      0,
    )!;
    expect(r.table).toEqual([{ id: "quiet", title: "Quiet but strong", who: ["Bilal"], line: "Said the least, and still won 3 games." }]);
    // One win is not enough.
    expect(tableIds(tableLog({ a: { voiceMs: 900_000 } }, undefined, [game({ winnerIds: ["a"] })]))).toEqual([]);
  });

  it("never names an uncounted seat in a voice award", () => {
    const seats: Record<string, TableCounts> = {
      a: { talkMs: 600_000, overTalks: 20, offTurnMs: 600_000, peak: 1, winTalkMs: 60_000, voiceMs: 900_000 },
    };
    const wins = [game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] })];
    expect(buildRecap(tableLog(seats, [], wins), 0)!.table).toEqual([]);
  });

  it("gives at most 3 table awards, and at most 2 for voice", () => {
    const r = buildRecap(
      tableLog({ a: { talkMs: 200_000 }, b: { overTalks: 9 }, c: { offTurnMs: 200_000 }, d: { sounds: 12 }, e: { reactions: 12 } }),
      0,
    )!;
    expect(r.table.map((a) => a.id)).toEqual(["chatty", "overtalk", "dj"]);
  });

  it("passes a time award to someone within 10% who has no award yet", () => {
    const champ = [game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] })];
    const near = buildRecap(tableLog({ a: { talkMs: 200_000 }, b: { talkMs: 185_000 } }, undefined, champ), 0)!;
    expect(near.table).toEqual([{ id: "chatty", title: "Most talkative", who: ["Bilal"], line: "Talked for 3 minutes." }]);
    const far = buildRecap(tableLog({ a: { talkMs: 250_000 }, b: { talkMs: 200_000 } }, undefined, champ), 0)!;
    expect(far.table[0]).toMatchObject({ id: "chatty", who: ["Asha"] });
  });

  it("only passes it to a counted seat", () => {
    const champ = [game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] })];
    const r = buildRecap(tableLog({ a: { talkMs: 200_000 }, b: { talkMs: 185_000 } }, ["a"], champ), 0)!;
    expect(r.table[0]).toMatchObject({ id: "chatty", who: ["Asha"] });
  });

  it("passes the shout on within 0.05", () => {
    const champ = [game({ winnerIds: ["a"] }), game({ winnerIds: ["a"] })];
    const seat = (peak: number): TableCounts => ({ peak, talkMs: 60_000 });
    expect(buildRecap(tableLog({ a: seat(0.9), b: seat(0.86) }, undefined, champ), 0)!.table[0]).toMatchObject({ id: "shout", who: ["Bilal"] });
    expect(buildRecap(tableLog({ a: seat(0.9), b: seat(0.8) }, undefined, champ), 0)!.table[0]).toMatchObject({ id: "shout", who: ["Asha"] });
  });

  it("spreads within the table list too", () => {
    const r = buildRecap(tableLog({ a: { talkMs: 200_000, overTalks: 10 }, b: { overTalks: 9 } }), 0)!;
    expect(r.table.map((x) => [x.id, x.who])).toEqual([["chatty", ["Asha"]], ["overtalk", ["Bilal"]]]);
  });
});

describe("recap moment and old logs", () => {
  it("names the loudest moment from 3 people", () => {
    const at = (count: number) => buildRecap(log([game()], { table: { ...emptyTableLog(), loudest: { count, gameId: "overheat" } } }), 0)!.moment;
    expect(at(3)).toEqual({ count: 3, gameId: "overheat" });
    expect(at(2)).toBeNull();
  });

  it("reads an old log with no table", () => {
    const r = buildRecap(log([game()]), 0)!;
    expect(r.table).toEqual([]);
    expect(r.moment).toBeNull();
  });

  it("starts an empty table log", () => {
    expect(emptyTableLog()).toEqual({ seats: {}, loudest: null, counted: [] });
  });

  it("is not a quiet night when only table awards exist", () => {
    const r = buildRecap(tableLog({ a: { sounds: 10 } }), 0)!;
    expect(r.awards).toEqual([]);
    expect(r.quiet).toBeNull();
  });
});
