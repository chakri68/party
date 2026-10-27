import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { bluffDefinitionsGame, fakeWordGame } from "../server/game.ts";
import { WORDS } from "../server/words.ts";
import { type BluffEvent, type BluffServerState, DEFAULT_SETTINGS, REVEAL_MS, type Variant, VOTE_MS, WRITE_MS } from "../shared/types.ts";

type S = BluffServerState;
type T = GameTransition<S, BluffEvent>;

const GAMES = { "fake-word": fakeWordGame, "bluff-definitions": bluffDefinitionsGame } as const;
const HOST = "p0";
const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed), hostId: HOST });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

const JALOUSIE = "jalousie|a blind or shutter made of angled slats|French for jealousy.";
const ADZE = "adze|a tool like an axe with its blade turned crosswise|Also adz.";

function start(variant: Variant, n = 4, opts: { rounds?: number; deck?: string[]; seed?: number; carry?: unknown } = {}): T {
  const g = GAMES[variant];
  return g.createGame(players(n), { ...DEFAULT_SETTINGS, rounds: opts.rounds ?? 5 }, { roundNumber: 1, dealerSeat: 0, carry: opts.carry }, ctx(0, opts.seed ?? 1), {
    deck: opts.deck ?? [JALOUSIE],
  });
}

/** Through parseAction, the way the room sends it; just inside the deadline unless told. */
function act(s: S, playerId: string, action: unknown, now = s.round.deadline - 1000, seed = 1) {
  const g = GAMES[s.variant];
  return g.handleAction(s, playerId, g.parseAction(action)!, ctx(now, seed));
}

function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof act>): string {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.message;
}

const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const ring = (s: S, seed = 1) => GAMES[s.variant].onTimer!(s, "phase", ctx(s.round.deadline, seed));
const ids = (s: S) => s.players.filter((p) => !p.removed).map((p) => p.id);
const score = (s: S, id: string) => s.players.find((p) => p.id === id)!.score;
const pubOf = (s: S) => GAMES[s.variant].getPublicState(s);
const privOf = (s: S, id: string) => GAMES[s.variant].getPrivateState(s, id);

const FAKES = ["glorpish", "blattering", "snorvel", "quimbletorf", "frazzik", "wombleton", "drimp", "zanquill", "plorbix", "grentle", "voomish", "skrandel"];
const DEFS = [
  "a small jealous dog from the south of france",
  "the act of hiding behind a curtain to listen in",
  "a sweet pastry folded into a fan shape",
  "an old word for a gossiping neighbour",
  "a narrow gap between two buildings",
  "a fit of envy brought on by bad weather",
  "a type of window box for growing herbs",
  "a silk scarf worn by dancers in the 1800s",
  "a small bell rung at the end of a meal",
  "the habit of reading over someone's shoulder",
  "a folding stool used by travelling painters",
  "a song sung while making bread",
];
const entryFor = (s: S, i: number) => (s.variant === "fake-word" ? FAKES[i]! : DEFS[i]!);

/** Everyone writes something. */
function toVote(s: S): S {
  ids(s).forEach((id, i) => {
    s = ok(act(s, id, { type: "submit", text: entryFor(s, i) })).state;
  });
  expect(s.round.phase).toBe("vote");
  return s;
}

const realId = (s: S) => s.round.options.find((o) => o.author === null)!.id;
const optionOf = (s: S, author: string) => s.round.options.find((o) => o.author === author)!.id;

describe.each(["fake-word", "bluff-definitions"] as const)("%s", (variant) => {
  describe("createGame", () => {
    it("opens on writing, with the variant's clock, and needs 3–12", () => {
      const t = start(variant);
      expect(types(t)).toEqual(["round-started"]);
      expect(t.state.round).toMatchObject({ phase: "write", deadline: WRITE_MS[variant] });
      expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: WRITE_MS[variant] }]);
      expect(() => start(variant, 2)).toThrow(/3–12/);
      expect(() => start(variant, 13)).toThrow(/3–12/);
      expect(() => start(variant, 3, { deck: ["Jalousie"] })).toThrow(/word\|definition/);
    });

    it("takes 3 or 5 rounds, nothing else", () => {
      const g = GAMES[variant];
      expect(g.parseSettings({ rounds: 3 })).toEqual({ rounds: 3 });
      expect(g.parseSettings(undefined)).toEqual({ rounds: 5 });
      expect(g.parseSettings({ rounds: 7 })).toBeNull();
      expect(g.parseSettings("5")).toBeNull();
    });

    it("draws from the real list by default", () => {
      const s = GAMES[variant].createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 5)).state;
      expect(WORDS).toContainEqual(s.round.entry);
    });
  });

  describe("secrets", () => {
    it("keep the answer and every author out of public and private state until the reveal", () => {
      const answer = variant === "fake-word" ? "jalousie" : "angled slats";
      let s = start(variant).state;
      const leak = (st: S, onBoard: boolean) => {
        const pub = pubOf(st);
        if (!onBoard) expect(JSON.stringify(pub)).not.toContain(answer);
        for (const id of ids(st)) if (!onBoard) expect(JSON.stringify(privOf(st, id))).not.toContain(answer);
        expect(pub.realId).toBeNull();
        expect(pub.authors).toBeNull();
        expect(pub.votes).toBeNull();
        expect(pub.notes).toBeNull();
        // No player id anywhere but the player list.
        for (const id of ids(st)) expect(JSON.stringify({ ...pub, players: [] })).not.toContain(id);
        // Options are id and text, nothing else.
        for (const o of pub.options ?? []) expect(Object.keys(o).sort()).toEqual(["id", "text"]);
      };
      leak(s, false);
      // The prompt is public: the meaning in Fake Word, the word in Bluff Definitions.
      if (variant === "fake-word") expect(pubOf(s)).toMatchObject({ word: null, definition: "a blind or shutter made of angled slats" });
      else expect(pubOf(s)).toMatchObject({ word: "jalousie", definition: null });
      s = ok(act(s, "p1", { type: "submit", text: entryFor(s, 1) })).state;
      leak(s, false);
      s = toVote(start(variant).state);
      // On the board now, but nothing says which one.
      leak(s, true);
      expect(JSON.stringify(ok(act(s, "p0", { type: "vote", optionId: realId(s) })).events)).not.toContain(answer);
      // Each player knows only their own option.
      expect(privOf(s, "p1").mineId).toBe(optionOf(s, "p1"));
      expect(privOf(s, "p1").choices).not.toContain(optionOf(s, "p1"));
      expect(Object.keys(privOf(s, "p1")).sort()).toEqual(["choices", "mine", "mineId", "sent", "vote"]);
    });

    it("are all out at the reveal: the answer, the notes, the authors, the votes", () => {
      let s = toVote(start(variant).state);
      for (const id of ids(s)) s = ok(act(s, id, { type: "vote", optionId: realId(s) })).state;
      expect(s.round.phase).toBe("reveal");
      const pub = pubOf(s);
      expect(pub).toMatchObject({ word: "jalousie", definition: "a blind or shutter made of angled slats", notes: "French for jealousy.", realId: realId(s) });
      expect(pub.authors![optionOf(s, "p2")]).toBe("p2");
      expect(Object.keys(pub.authors!)).toHaveLength(4);
      expect(pub.votes).toEqual({ p0: realId(s), p1: realId(s), p2: realId(s), p3: realId(s) });
    });
  });

  describe("options", () => {
    it("get opaque ids, and a shuffle that moves the real one around", () => {
      const slots = new Set<number>();
      const seen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) {
        let s = start(variant, 5, { seed }).state;
        ids(s).forEach((id, i) => {
          s = ok(act(s, id, { type: "submit", text: entryFor(s, i) }, s.round.deadline - 1000, seed)).state;
        });
        const opts = pubOf(s).options!;
        expect(opts).toHaveLength(6);
        slots.add(opts.findIndex((o) => o.id === realId(s)));
        for (const o of opts) {
          expect(o.id).toMatch(/^[0-9a-z]{6}$/);
          seen.add(o.id);
        }
        expect(new Set(opts.map((o) => o.id)).size).toBe(6);
      }
      // The real one turns up in every slot, and ids don't repeat across rounds.
      expect(slots.size).toBe(6);
      expect(seen.size).toBeGreaterThan(200);
    });
  });

  describe("writing", () => {
    it("one each; everyone in opens the vote early", () => {
      let s = start(variant, 3).state;
      s = ok(act(s, "p0", { type: "submit", text: entryFor(s, 0) })).state;
      expect(err(act(s, "p0", { type: "submit", text: entryFor(s, 1) }))).toMatch(/sent/);
      expect(privOf(s, "p0")).toMatchObject({ sent: true, mine: entryFor(s, 0) });
      expect(pubOf(s).players.map((p) => p.done)).toEqual([true, false, false]);
      s = ok(act(s, "p1", { type: "submit", text: entryFor(s, 1) })).state;
      const t = ok(act(s, "p2", { type: "submit", text: entryFor(s, 2) }));
      expect(types(t)).toContain("vote-open");
      expect(t.state.round).toMatchObject({ phase: "vote", phaseMs: VOTE_MS });
      expect(t.state.round.options).toHaveLength(4);
    });

    it("the clock closes it; missing entries are just absent", () => {
      let s = start(variant).state;
      s = ok(act(s, "p1", { type: "submit", text: entryFor(s, 1) })).state;
      s = ring(s).state;
      expect(s.round.phase).toBe("vote");
      expect(s.round.options.map((o) => o.author).sort()).toEqual([null, "p1"].sort());
      // Not having written doesn't stop you voting.
      expect(privOf(s, "p2").choices).toHaveLength(2);
      expect(privOf(s, "p1").choices).toEqual([realId(s)]);
    });

    it("nobody writing skips the vote, and nobody scores", () => {
      const t = ring(start(variant).state);
      expect(types(t)).toEqual(["no-fakes", "revealed"]);
      expect(t.state.round.phase).toBe("reveal");
      expect(pubOf(t.state)).toMatchObject({ noFakes: true, word: "jalousie" });
      expect(t.state.players.every((p) => p.score === 0)).toBe(true);
    });
  });

  describe("deadlines", () => {
    it("shut the door at the deadline, before the alarm", () => {
      const s = start(variant).state;
      expect(err(act(s, "p0", { type: "submit", text: entryFor(s, 0) }, s.round.deadline))).toMatch(/Time/);
      const v = toVote(s);
      expect(err(act(v, "p0", { type: "vote", optionId: realId(v) }, v.round.deadline + 5))).toMatch(/Time/);
    });

    it("an early alarm re-arms instead of firing", () => {
      const s = start(variant).state;
      const t = GAMES[variant].onTimer!(s, "phase", ctx(s.round.deadline - 3000));
      expect(t.state).toBe(s);
      expect(t.timers).toEqual([{ kind: "set", timerId: "phase", delayMs: 3000 }]);
    });
  });

  describe("voting", () => {
    it("not your own, nothing off the list; re-votes overwrite; all in reveals early", () => {
      let s = toVote(start(variant, 3).state);
      expect(err(act(s, "p0", { type: "vote", optionId: optionOf(s, "p0") }))).toMatch(/yours/);
      expect(err(act(s, "p0", { type: "vote", optionId: "zzzzzz" }))).toMatch(/choices/);
      s = ok(act(s, "p0", { type: "vote", optionId: optionOf(s, "p1") })).state;
      s = ok(act(s, "p0", { type: "vote", optionId: realId(s) })).state;
      expect(privOf(s, "p0").vote).toBe(realId(s));
      expect(pubOf(s).votes).toBeNull();
      s = ok(act(s, "p1", { type: "vote", optionId: realId(s) })).state;
      const t = ok(act(s, "p2", { type: "vote", optionId: optionOf(s, "p0") }));
      expect(types(t)).toContain("revealed");
      expect(t.state.round.phase).toBe("reveal");
    });

    it("scores +2 for the real one, +1 to an author per opponent fooled", () => {
      let s = toVote(start(variant, 4).state);
      s = ok(act(s, "p0", { type: "vote", optionId: realId(s) })).state;
      s = ok(act(s, "p1", { type: "vote", optionId: optionOf(s, "p0") })).state;
      s = ok(act(s, "p2", { type: "vote", optionId: optionOf(s, "p0") })).state;
      s = ok(act(s, "p3", { type: "vote", optionId: optionOf(s, "p1") })).state;
      expect(s.round.phase).toBe("reveal");
      expect([score(s, "p0"), score(s, "p1"), score(s, "p2"), score(s, "p3")]).toEqual([4, 1, 0, 0]);
      expect(pubOf(s).gained).toEqual({ p0: 4, p1: 1 });
    });

    it("the clock closes it; no vote, no points", () => {
      let s = toVote(start(variant).state);
      s = ok(act(s, "p1", { type: "vote", optionId: realId(s) })).state;
      s = ring(s).state;
      expect(s.round.phase).toBe("reveal");
      expect(s.players.map((p) => p.score)).toEqual([0, 2, 0, 0]);
    });
  });

  describe("rounds", () => {
    it("the reveal runs 12 s, or until the host moves on; nobody else can", () => {
      let s = ring(start(variant, 3, { deck: [JALOUSIE, ADZE] }).state).state;
      expect(s.round).toMatchObject({ phase: "reveal", phaseMs: REVEAL_MS });
      expect(err(act(s, "p1", { type: "next" }))).toMatch(/host/);
      const t = ok(act(s, HOST, { type: "next" }));
      expect(types(t)).toEqual(["round-started"]);
      expect(t.state.roundNumber).toBe(2);
      s = ring(ring(t.state).state).state;
      expect(s.roundNumber).toBe(3);
    });

    it("never repeat a word while there are fresh ones, and carry the used ones into a rematch", () => {
      const deck = WORDS.slice(0, 6).map((e) => `${e.word}|${e.definition}`);
      let s = start(variant, 3, { deck, rounds: 5 }).state;
      const words = [s.round.entry.word];
      while (s.phase !== "finished") {
        s = ring(ring(s).state).state;
        if (s.phase === "playing") words.push(s.round.entry.word);
      }
      expect(new Set(words).size).toBe(5);
      const carry = GAMES[variant].carryOver!(s);
      const next = start(variant, 3, { deck, carry }).state;
      expect(words).not.toContain(next.round.entry.word);
    });

    it("finish after the last reveal; ties share the win", () => {
      let s = start(variant, 3, { rounds: 3, deck: [JALOUSIE, ADZE] }).state;
      for (let i = 0; i < 3; i++) {
        s = toVote(s);
        for (const id of ids(s)) s = ok(act(s, id, { type: "vote", optionId: realId(s) })).state;
        s = ring(s).state;
      }
      expect(s.phase).toBe("finished");
      expect(pubOf(s).phase).toBe("finished");
      const res = GAMES[variant].getResult(s)!;
      expect(res.winnerIds.sort()).toEqual(["p0", "p1", "p2"]);
      expect(res.standings[0]!.label).toBe("6 points");
    });
  });

  describe("leaving and dropping", () => {
    it("a leaver's entry stays in, and they're not waited on", () => {
      let s = start(variant).state;
      s = ok(act(s, "p3", { type: "submit", text: entryFor(s, 3) })).state;
      s = GAMES[variant].onPlayerRemoved!(s, "p3", ctx(1000)).state;
      for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "submit", text: entryFor(s, ["p0", "p1", "p2"].indexOf(id)) })).state;
      expect(s.round.phase).toBe("vote");
      expect(s.round.options.some((o) => o.author === "p3")).toBe(true);
      expect(s.round.ballot!.eligible).not.toContain("p3");
      // Their fake can still fool people.
      s = ok(act(s, "p0", { type: "vote", optionId: optionOf(s, "p3") })).state;
      expect(score(s, "p3")).toBe(0);
    });

    it("leaving mid-vote drops the vote; the rest can close it", () => {
      let s = toVote(start(variant).state);
      for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "vote", optionId: realId(s) })).state;
      const t = GAMES[variant].onPlayerRemoved!(s, "p3", ctx(1000));
      expect(t.state.round.phase).toBe("reveal");
      expect(t.state.round.ballot!.eligible).toEqual(["p0", "p1", "p2"]);
    });

    it("below three, the game ends with no winner", () => {
      const s = start(variant, 3).state;
      const t = GAMES[variant].onPlayerRemoved!(s, "p2", ctx(1000));
      expect(t.state.phase).toBe("finished");
      expect(types(t)).toEqual(["game-over"]);
      expect(GAMES[variant].getResult(t.state)!.winnerIds).toEqual([]);
    });

    it("dropped players don't hold a phase up, and can come back", () => {
      let s = start(variant).state;
      s = GAMES[variant].onPlayerDisconnected!(s, "p3", ctx(1000)).state;
      for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "submit", text: entryFor(s, ["p0", "p1", "p2"].indexOf(id)) })).state;
      expect(s.round.phase).toBe("vote");
      s = GAMES[variant].onPlayerReconnected!(s, "p3", ctx(2000)).state;
      expect(privOf(s, "p3").choices).toHaveLength(4);
      s = ok(act(s, "p3", { type: "vote", optionId: realId(s) })).state;
      expect(score(s, "p3")).toBe(0);
    });

    it("the host can skip whoever's awaited", () => {
      let s = start(variant).state;
      for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "submit", text: entryFor(s, ["p0", "p1", "p2"].indexOf(id)) })).state;
      expect(GAMES[variant].getAwaitedPlayerIds(s)).toEqual(["p3"]);
      let t = GAMES[variant].skipTurn!(s, "p3", ctx(1000));
      expect(types(t)).toEqual(["skipped", "vote-open"]);
      s = t.state;
      for (const id of ["p0", "p1", "p2"]) s = ok(act(s, id, { type: "vote", optionId: realId(s) })).state;
      t = GAMES[variant].skipTurn!(s, "p3", ctx(1000));
      expect(t.state.round.phase).toBe("reveal");
    });
  });

  describe("random games", () => {
    it("always finish, with sane scores", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const rnd = seededRandomInt(seed * 7919);
        const n = 3 + rnd(10);
        const g = GAMES[variant];
        let s = g.createGame(players(n), { rounds: 3 }, { roundNumber: 1, dealerSeat: 0 }, ctx(0, seed)).state;
        let now = 0;
        for (let step = 0; step < 400 && s.phase !== "finished"; step++) {
          const live = ids(s);
          const who = live[rnd(live.length)]!;
          const roll = rnd(20);
          now = Math.max(now, s.round.deadline - 2000 + rnd(1500));
          let next: S | null = null;
          if (roll === 0 && live.length > 3) next = g.onPlayerRemoved!(s, who, ctx(now)).state;
          else if (roll < 3) next = g.onTimer!(s, "phase", ctx(s.round.deadline)).state;
          else {
            const phase = s.round.phase;
            const opts = s.round.options;
            const action =
              phase === "write" ? { type: "submit", text: rnd(4) ? entryFor(s, rnd(12)) : "x" }
              : phase === "vote" ? { type: "vote", optionId: opts[rnd(opts.length)]?.id ?? "" }
              : { type: "next" };
            const r = g.handleAction(s, action.type === "next" ? live[0]! : who, g.parseAction(action)!, { ...ctx(now, seed), hostId: live[0] });
            if (r.ok) next = r.transition.state;
          }
          if (next) s = next;
        }
        expect(s.phase, `seed ${seed}`).toBe("finished");
        const res = g.getResult(s)!;
        if (s.endReason === "done") expect(res.winnerIds.length).toBeGreaterThan(0);
        expect(s.players.every((p) => p.score >= 0)).toBe(true);
      }
    });
  });
});

describe("fake word checks", () => {
  const s = () => start("fake-word").state;

  it("turn away real words, the real word and near misses, all with one message", () => {
    const msg = err(act(s(), "p0", { type: "submit", text: "Jalousie" }));
    expect(msg).toMatch(/real word/);
    expect(err(act(s(), "p0", { type: "submit", text: "kettle" }))).toBe(msg);
    expect(err(act(s(), "p0", { type: "submit", text: "jalousee" }))).toBe(msg);
    expect(err(act(s(), "p0", { type: "submit", text: "jaloosie" }))).toBe(msg);
    expect(ok(act(s(), "p0", { type: "submit", text: "jelvoskin" })).state.round.entries.p0).toBe("jelvoskin");
  });

  it("turn away bad shapes and someone else's fake, and let you try again", () => {
    let st = s();
    expect(err(act(st, "p0", { type: "submit", text: "gl" }))).toMatch(/3/);
    expect(err(act(st, "p0", { type: "submit", text: "glorp blat" }))).toMatch(/Letters/);
    expect(err(act(st, "p0", { type: "submit", text: "https://x.io" }))).toMatch(/Letters/);
    st = ok(act(st, "p1", { type: "submit", text: " Glorpish " })).state;
    expect(st.round.entries.p1).toBe("glorpish");
    expect(err(act(st, "p0", { type: "submit", text: "GLORPISH" }))).toMatch(/already/);
    st = ok(act(st, "p0", { type: "submit", text: "glorpash" })).state;
    expect(st.round.entries.p0).toBe("glorpash");
  });
});

describe("bluff definition checks", () => {
  const s = () => start("bluff-definitions").state;

  it("turn away short ones, the real meaning, and near copies of someone else's", () => {
    let st = s();
    expect(err(act(st, "p0", { type: "submit", text: "a dog" }))).toMatch(/15/);
    expect(err(act(st, "p0", { type: "submit", text: "A blind or shutter made of angled slats." }))).toMatch(/real meaning/);
    expect(err(act(st, "p0", { type: "submit", text: "a blind or shutter made of angled planks" }))).toMatch(/real meaning/);
    st = ok(act(st, "p1", { type: "submit", text: "A small jealous dog from France." })).state;
    expect(err(act(st, "p0", { type: "submit", text: "a small jealous dog from france" }))).toMatch(/nearly the same/);
    st = ok(act(st, "p0", { type: "submit", text: "a large jealous cat from Spain" })).state;
    expect(st.round.entries.p0).toBe("a large jealous cat from Spain");
  });

  it("puts every option on the board the same way", () => {
    let st = s();
    st = ok(act(st, "p0", { type: "submit", text: "A small jealous dog from France." })).state;
    st = ring(st).state;
    const texts = pubOf(st).options!.map((o) => o.text).sort();
    expect(texts).toEqual(["a blind or shutter made of angled slats", "a small jealous dog from France"]);
  });

  it("cleans what's typed: one line, 180 at most", () => {
    let st = s();
    st = ok(act(st, "p0", { type: "submit", text: `a long\n\nstory ${"x".repeat(300)}` })).state;
    expect(st.round.entries.p0).toHaveLength(180);
    expect(st.round.entries.p0).not.toContain("\n");
  });
});
