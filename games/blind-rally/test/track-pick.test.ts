import { describe, expect, it, vi } from "vitest";
import { blindRallySettingFields, parseSettings, rulesPreview } from "../shared/rules-text.ts";
import { DEFAULT_SETTINGS, type BlindRallyPublicState, type BlindRallyState } from "../shared/types.ts";

// Fair Race's track choice (spec §7.1): the host's pick, or one vote per team.
// The file has one track today and more on the way, so these run against a
// stand-in file of three: Pine Panic and two renamed copies of it.

vi.mock("../data/tracks.json", async (importOriginal) => {
  const real = ((await importOriginal()) as { default: { version: 1; tracks: { id: string; name: string }[] } }).default;
  const pine = real.tracks[0]!;
  const copy = (id: string, name: string, difficulty: string) => ({ ...structuredClone(pine), id, name, difficulty });
  return { default: { ...real, tracks: [pine, copy("test_dunes", "Test Dunes", "medium"), copy("test_ice", "Test Ice", "hard")] } };
});

const { act, ctx, game, newGame, refused } = await import("./helpers.ts");
const { parseAction } = await import("../server/parse.ts");
const { upgrade } = await import("../server/upgrade.ts");

const PINE = "pine_panic";
const DUNES = "test_dunes";
const ICE = "test_ice";
const pub = (s: BlindRallyState) => game.getPublicState(s) as BlindRallyPublicState;

/** Four teams' captains (their Navigators) seated: p1, p3, p5, p7. Drivers p0, p2, p4, p6. */
function ballot(players = 8, extra: Partial<typeof DEFAULT_SETTINGS> = {}, seat = true): BlindRallyState {
  let s = newGame(players, { trackPick: "ballot", ...extra });
  if (!seat) return s;
  for (let t = 1; t <= Math.floor(players / 2); t++) {
    s = act(s, `p${t * 2 - 1}`, { type: "team.join", teamId: t, role: "navigator" });
    s = act(s, `p${t * 2 - 2}`, { type: "team.join", teamId: t, role: "driver" });
  }
  return s;
}

const vote = (s: BlindRallyState, who: string, trackId: string | null) => act(s, who, { type: "track.vote", trackId });

describe("host picks (the default)", () => {
  it("the catalogue comes from the file, in its order, and the room starts on its first track", () => {
    const g = pub(newGame(2));
    expect(g.tracks.map((t) => t.id)).toEqual([PINE, DUNES, ICE]);
    expect(g.trackId).toBe(PINE);
    expect(g.trackPick).toBe("host");
    expect(g.ballot).toBeNull();
  });

  it("the host picks; anyone else, an unknown track, or a pick after TEAMS is refused", () => {
    let s = newGame(4);
    s = act(s, "p0", { type: "track.pick", trackId: DUNES });
    expect(s.trackId).toBe(DUNES);
    refused(s, "p1", { type: "track.pick", trackId: ICE }, "not-host");
    refused(s, "p0", { type: "track.pick", trackId: "nowhere" }, "no-such-track");
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    s = act(s, "p0", { type: "race.start" });
    refused(s, "p0", { type: "track.pick", trackId: ICE }, "wrong-phase");
    expect(s.trackId).toBe(DUNES);
  });

  it("captains can't vote when the host picks", () => {
    let s = newGame(2);
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    refused(s, "p1", { type: "track.vote", trackId: ICE }, "host-picks");
  });

  it("a new track un-readies everyone: a ready Navigator has booted the old course", () => {
    let s = newGame(2);
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p0", { type: "player.ready", ready: true });
    s = act(s, "p1", { type: "player.ready", ready: true });
    // Picking the one you're on is nothing.
    expect(act(s, "p0", { type: "track.pick", trackId: PINE }).players.every((p) => p.ready)).toBe(true);
    s = act(s, "p0", { type: "track.pick", trackId: ICE });
    expect(s.players.some((p) => p.ready)).toBe(false);
  });

  it("practice is always the host's pick, whatever the setting says", () => {
    let s = newGame(2, { mode: "practice", trackPick: "ballot" });
    expect(pub(s).trackPick).toBe("host");
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    refused(s, "p1", { type: "track.vote", trackId: ICE }, "host-picks");
    expect(act(s, "p0", { type: "track.pick", trackId: ICE }).trackId).toBe(ICE);
  });
});

describe("team ballot", () => {
  it("the host can't pick over it", () => {
    refused(ballot(), "p0", { type: "track.pick", trackId: ICE }, "ballot-on");
  });

  it("one vote per team, cast by its captain: not the Driver, not a spare", () => {
    const s = ballot(9);
    refused(s, "p0", { type: "track.vote", trackId: ICE }, "not-captain");
    refused(s, "p8", { type: "track.vote", trackId: ICE }, "not-seated");
    refused(s, "p1", { type: "track.vote", trackId: "nowhere" }, "no-such-track");
    const v = vote(s, "p1", ICE);
    expect(pub(v).ballot!.votes).toEqual([{ teamId: 1, trackId: ICE }]);
    // Again replaces it; null takes it back.
    expect(pub(vote(v, "p1", DUNES)).ballot!.votes).toEqual([{ teamId: 1, trackId: DUNES }]);
    expect(pub(vote(v, "p1", null)).ballot!.votes).toEqual([]);
  });

  it("the captain is the Navigator by default; swapping seats hands the vote over, and the car keeps its vote", () => {
    let s = vote(ballot(4), "p1", ICE);
    s = act(s, "p1", { type: "role.pick", role: "driver" });
    refused(s, "p1", { type: "track.vote", trackId: DUNES }, "not-captain");
    expect(pub(s).ballot!.votes).toEqual([{ teamId: 1, trackId: ICE }]);
    s = vote(s, "p0", DUNES);
    expect(pub(s).ballot!.votes).toEqual([{ teamId: 1, trackId: DUNES }]);
  });

  it("a lone player in a car is its captain", () => {
    let s = newGame(2, { trackPick: "ballot" });
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    expect(vote(s, "p0", ICE).trackId).toBe(ICE);
  });

  it("most votes wins, live: trackId is always the leader", () => {
    let s = ballot();
    expect(s.trackId).toBe(PINE);
    s = vote(s, "p1", ICE);
    expect(s.trackId).toBe(ICE);
    s = vote(s, "p3", DUNES);
    s = vote(s, "p5", DUNES);
    expect(s.trackId).toBe(DUNES);
    expect(pub(s).ballot!.tied).toEqual([]);
  });

  it("no votes: the track stays put (the default, or last race's)", () => {
    let s = ballot();
    s = vote(s, "p1", ICE);
    s = vote(s, "p1", null);
    expect(s.trackId).toBe(ICE);
    expect(pub(s).ballot!.votes).toEqual([]);
  });

  it("a tie is broken by the room seed, the same way every time, and says so", () => {
    const tie = (seed: number) => {
      let s = { ...ballot(), seed };
      s = vote(s, "p1", ICE);
      s = vote(s, "p3", DUNES);
      return s;
    };
    const a = tie(7);
    expect(pub(a).ballot!.tied).toEqual([DUNES, ICE]);
    expect([DUNES, ICE]).toContain(a.trackId);
    // Deterministic: same seed, same tie, same answer, whoever voted first.
    let b = { ...ballot(), seed: 7 };
    b = vote(b, "p3", DUNES);
    b = vote(b, "p1", ICE);
    expect(b.trackId).toBe(a.trackId);
    // And it's a coin, not a rule: across seeds both sides win sometimes.
    const winners = new Set(Array.from({ length: 40 }, (_, i) => tie(i * 7919).trackId));
    expect(winners).toEqual(new Set([DUNES, ICE]));
    // A third vote breaks the tie for real.
    const c = vote(a, "p5", a.trackId === ICE ? DUNES : ICE);
    expect(pub(c).ballot!.tied).toEqual([]);
  });

  it("the tie shows in the rules preview", () => {
    expect(rulesPreview({ trackPick: "ballot" }, { name: "Test Ice", tie: true })[0]).toEqual({ label: "Track", value: "Test Ice, team vote (tie: picked by coin flip)" });
    expect(rulesPreview({}, { name: "Pine Panic", tie: false })[0]).toEqual({ label: "Track", value: "Pine Panic, host's pick" });
    expect(rulesPreview({ trackPick: "ballot" })[0]!.value).toBe("Team vote, one per car");
  });

  it("a car that empties takes its vote with it", () => {
    let s = vote(ballot(4), "p1", ICE);
    s = vote(s, "p3", DUNES);
    s = act(s, "p1", { type: "team.leave" });
    s = act(s, "p0", { type: "team.leave" });
    expect(pub(s).ballot!.votes).toEqual([{ teamId: 2, trackId: DUNES }]);
    expect(s.trackId).toBe(DUNES);
  });

  it("locks when the race starts: no votes after TEAMS, and the Navigator's session names the winner", () => {
    let s = vote(ballot(4), "p1", ICE);
    for (const id of ["p0", "p1", "p2", "p3"]) s = act(s, id, { type: "player.ready", ready: true });
    s = act(s, "p0", { type: "race.start" });
    refused(s, "p3", { type: "track.vote", trackId: DUNES }, "wrong-phase");
    expect(s.trackId).toBe(ICE);
    const nav = game.getPrivateState(s, "p1");
    expect(nav.role === "navigator" && nav.session.trackId).toBe(ICE);
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    expect(game.getResult(s)!.standings[0]!.label).toContain("Test Ice");
  });

  it("a vote that moves the leader un-readies everyone; one that doesn't, doesn't", () => {
    let s = vote(vote(ballot(6), "p1", ICE), "p3", ICE);
    for (let i = 0; i < 6; i++) s = act(s, `p${i}`, { type: "player.ready", ready: true });
    s = vote(s, "p5", DUNES); // 2–1, Ice still ahead
    expect(s.players.every((p) => p.ready)).toBe(true);
    s = vote(s, "p3", DUNES); // 1–2: Dunes
    expect(s.trackId).toBe(DUNES);
    expect(s.players.some((p) => p.ready)).toBe(false);
  });
});

describe("rematch", () => {
  const carryFrom = (s: BlindRallyState) => game.carryOver!(s);
  const next = (carry: unknown, settings = {}) =>
    game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 2, dealerSeat: 0, carry }, ctx()).state;

  it("keeps the track unless it's changed, with a fresh ballot", () => {
    const s = act(newGame(2), "p0", { type: "track.pick", trackId: ICE });
    const carry = carryFrom(s);
    expect(next(carry).trackId).toBe(ICE);
    const r = next(carry, { trackPick: "ballot" });
    expect(r.trackId).toBe(ICE);
    expect(pub(r).ballot).toEqual({ votes: [], tied: [] });
  });

  it("a carried track that's gone from the file falls back to the first", () => {
    expect(next({ teams: [], trackId: "retired_track" }).trackId).toBe(PINE);
    expect(next({ teams: [], trackId: 42 }).trackId).toBe(PINE);
  });
});

describe("older saved states", () => {
  /** A TEAMS state as the Worker before track choice wrote it: no ballots, no trackPick. */
  const legacy = (): BlindRallyState => {
    const s = structuredClone(newGame(4)) as unknown as Record<string, unknown> & { settings: Record<string, unknown> };
    delete s.ballots;
    delete s.settings.trackPick;
    return s as unknown as BlindRallyState;
  };

  it("gets the new fields on the way in, and a current state comes back untouched", () => {
    const up = upgrade(legacy());
    expect(up.ballots).toEqual([{ target: "all", votes: [], tied: [] }]);
    expect(up.settings.trackPick).toBe("host");
    const current = newGame(2);
    expect(upgrade(current)).toBe(current);
  });

  it("every entry point copes: projections, the host's pick, a seat change, a timer", () => {
    const old = legacy();
    expect(pub(old).trackPick).toBe("host");
    expect(pub(old).tracks.length).toBe(3);
    const picked = act(old, "p0", { type: "track.pick", trackId: DUNES });
    expect(picked.trackId).toBe(DUNES);
    expect(picked.ballots).toHaveLength(1);
    expect(act(legacy(), "p1", { type: "team.join", teamId: 1, role: "navigator" }).ballots).toHaveLength(1);
    expect(game.onTimer!(legacy(), "go", ctx()).state.ballots).toHaveLength(1);
    expect(game.getPrivateState(legacy(), "p0")).toEqual({ role: null });
  });
});

describe("parsing and settings", () => {
  it("actions: a track id is a short lowercase slug; the vote may be null", () => {
    expect(parseAction({ type: "track.pick", trackId: ICE })).toEqual({ type: "track.pick", trackId: ICE });
    expect(parseAction({ type: "track.vote", trackId: null })).toEqual({ type: "track.vote", trackId: null });
    expect(parseAction({ type: "track.vote", trackId: DUNES })).toEqual({ type: "track.vote", trackId: DUNES });
    for (const bad of [undefined, 3, "", "Pine Panic", "x".repeat(41), "../etc"]) {
      expect(parseAction({ type: "track.pick", trackId: bad })).toBeNull();
      expect(parseAction({ type: "track.vote", trackId: bad })).toBeNull();
    }
    expect(parseAction({ type: "track.pick", trackId: null })).toBeNull();
  });

  it("settings: host or ballot, host by default; the lobby field only outside practice", () => {
    expect(parseSettings({})!.trackPick).toBe("host");
    expect(parseSettings({ trackPick: "ballot" })!.trackPick).toBe("ballot");
    expect(parseSettings({ trackPick: "dartboard" })).toBeNull();
    const field = blindRallySettingFields({}, 4).find((f) => f.key === "trackPick")!;
    expect(field.options.map((o) => o.patch)).toEqual([{ trackPick: "host" }, { trackPick: "ballot" }]);
    expect(blindRallySettingFields({ mode: "practice" }, 4).map((f) => f.key)).not.toContain("trackPick");
  });
});
