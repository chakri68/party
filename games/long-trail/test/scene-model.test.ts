import { describe, expect, it } from "vitest";
import { FALLBACK_COLOR, sceneModel, type SceneInput } from "../client/scene/model.ts";
import { packFor, type ChoiceEvent, type PlainEvent } from "../shared/pack.ts";
import type { LongTrailPublicState } from "../shared/types.ts";
import { act, chooseAll, ctx, g, leaderId, nextAll, ok, playDay, proposeOpen, type S, start, toPlan, voteAll } from "./helpers.ts";

const pack = packFor("trade-route");
const pub = (s: S) => structuredClone(g.getPublicState(s));
const input = (game: LongTrailPublicState, o: Partial<SceneInput> = {}): SceneInput => ({
  game,
  pack,
  route: pack.routes[game.settings.length],
  draft: null,
  colorOf: (id) => `#${id}`,
  ...o,
});
const model = (game: LongTrailPublicState, o: Partial<SceneInput> = {}) => sceneModel(input(game, o));
const kinds = (game: LongTrailPublicState) => model(game).beats.map((b) => b.kind);

/** In plan, on a leg (not halted at a stop). */
function planOnLeg(): S {
  let s = toPlan(start(4, {}, 5).state);
  for (let i = 0; i < 20 && pub(s).leg === null; i++) s = playDay(s);
  expect(pub(s).leg).not.toBeNull();
  return s;
}

/** Plays days until `stop` holds in the summary, or null. */
function toSummary(stop: (p: LongTrailPublicState) => boolean): LongTrailPublicState | null {
  for (let seed = 1; seed < 60; seed++) {
    let s = toPlan(start(4, {}, seed).state);
    for (let day = 0; day < 20 && s.phase === "plan"; day++) {
      s = voteAll(proposeOpen(s), "go").state;
      if (s.phase === "choice") s = chooseAll(s, 0).state;
      if (s.phase !== "summary") break;
      if (stop(pub(s))) return pub(s);
      s = nextAll(s).state;
    }
  }
  return null;
}

/** A choice open, plus the summary after everyone picks 0. */
function toChoice(): { choice: LongTrailPublicState; summary: LongTrailPublicState } {
  for (let seed = 1; seed < 60; seed++) {
    let s = toPlan(start(4, {}, seed).state);
    for (let day = 0; day < 20 && s.phase === "plan"; day++) {
      s = voteAll(proposeOpen(s), "go").state;
      if (s.phase === "choice") return { choice: pub(s), summary: pub(chooseAll(s, 0).state) };
      s = nextAll(s).state;
    }
  }
  throw new Error("no choice found");
}

describe("sceneModel", () => {
  it("plan: no beats, speed from the leader's draft", () => {
    const game = pub(planOnLeg());
    expect(game.phase).toBe("plan");
    const m = model(game, { draft: { ...game.openPlan, pace: "hard" } });
    expect(m.speed).toBe(3);
    expect(m.beats).toEqual([]);
    expect(model(game, { draft: { ...game.openPlan, pace: "slow" } }).speed).toBe(1);
    expect(model(game, { draft: { ...game.openPlan, rest: true } }).camp).toBe(true);
  });

  it("the draft does not restart the sequence", () => {
    const game = pub(planOnLeg());
    const a = model(game, { draft: { ...game.openPlan, pace: "hard" } });
    const b = model(game, { draft: { ...game.openPlan, pace: "slow", rest: true } });
    expect(a.beatsKey).toBe(b.beatsKey);
    expect(a.beatsKey).toBe(`plan:${game.day}`);
  });

  it("vote: no beats", () => {
    const s = proposeOpen(planOnLeg());
    expect(s.phase).toBe("vote");
    expect(model(pub(s)).beats).toEqual([]);
  });

  it("summary: travel, event, settle", () => {
    const game = toSummary((p) => !!p.lastDay?.event && !p.lastDay.event.choice && !p.lastDay.plan.rest)!;
    expect(game).not.toBeNull();
    const m = model(game);
    expect(m.beats.map((b) => b.kind)).toEqual(["travel", "event", "settle"]);
    expect(m.beats.map((b) => b.ms)).toEqual([3000, 4000, 2000]);
    const card = pack.events.find((e) => e.id === game.lastDay!.event!.id) as PlainEvent;
    expect(m.beats[1]!.scene).toBe(card.scene);
    expect(m.beats[1]!.outcome).toEqual(game.lastDay!.eventOutcome);
    const fill = m.beats[0]!.fill!;
    expect(fill[0]).toBeGreaterThanOrEqual(0);
    expect(fill[1]).toBeLessThanOrEqual(1);
    expect(fill[1]).toBeGreaterThanOrEqual(fill[0]);
    expect(m.beatsKey).toBe(`summary:${game.day}`);
  });

  it("choice then summary: travel plays once", () => {
    const { choice, summary } = toChoice();
    expect(choice.today!.plan.rest).toBe(false);
    const c = model(choice);
    expect(c.beats.map((b) => b.kind)).toEqual(["travel", "situation"]);
    expect(c.beats[1]!.ms).toBe(Infinity);
    const card = pack.events.find((e) => e.id === choice.choice!.id) as ChoiceEvent;
    expect(c.beats[1]!.scene).toBe(card.scene ?? "calm");
    const s = model(summary);
    expect(s.beats.map((b) => b.kind)).toEqual(["event", "settle"]);
    expect(s.beats[0]!.ms).toBe(5000);
    expect(s.beats[1]!.ms).toBe(2000);
    const opt = card.options[0];
    expect(s.beats[0]!.scene).toBe(summary.lastDay!.eventOutcome?.lucky === false ? (opt.badScene ?? opt.scene) : (opt.scene ?? "calm"));
    expect(c.beatsKey).not.toBe(s.beatsKey);
  });

  it("a lucky false choice uses the bad scene", () => {
    const { summary } = toChoice();
    const game = structuredClone(summary);
    const card = { id: "x-test", kind: "any", severity: 0, text: "", options: [{ label: "a", effect: {}, scene: "calm" }, { label: "b", effect: {}, scene: "water-found", badScene: "storm" }] } as ChoiceEvent;
    const testPack = { ...pack, events: [...pack.events, card] };
    game.lastDay!.event = { id: "x-test", text: "", choice: { votes: {}, picked: 1, label: "b" } };
    game.lastDay!.eventOutcome = { healthChanges: [], stock: {}, km: 0, scoutSaved: false, cargo: 0, lucky: false };
    expect(model(game, { pack: testPack }).beats[0]!.scene).toBe("storm");
    game.lastDay!.eventOutcome.lucky = true;
    expect(model(game, { pack: testPack }).beats[0]!.scene).toBe("water-found");
  });

  it("rest day: camp, no travel beat", () => {
    let s = planOnLeg();
    s = ok(act(s, leaderId(s), { type: "propose", plan: { ...pub(s).openPlan, rest: true } })).state;
    s = voteAll(s, "go").state;
    if (s.phase === "choice") s = chooseAll(s, 0).state;
    expect(s.phase).toBe("summary");
    const m = model(pub(s));
    expect(m.camp).toBe(true);
    expect(m.beats.map((b) => b.kind)).not.toContain("travel");
    expect(m.beats.at(-1)!.kind).toBe("settle");
  });

  it("halted at a fork: two alike paths, nothing about safety", () => {
    let s = toPlan(start(4, { length: "short" }, 3).state);
    for (let day = 0; day < 20 && s.phase === "plan" && !(s.caravan.leg === null && s.caravan.at === "tel-orrin"); day++) s = playDay(s);
    expect(s.caravan.at).toBe("tel-orrin");
    const m = model(pub(s));
    expect(m.fork).toBe(true);
    expect(m.speed).toBe(0);
    const swapped = structuredClone(s);
    const f = swapped.forks!["tel-orrin"]!;
    f.safe = f.safe === "saltmere" ? "vessa" : "saltmere";
    expect(model(pub(swapped))).toEqual(m);
  });

  it("terrain: a market stop at the start, the leg's kind on a leg", () => {
    const first = pub(toPlan(start(4).state));
    const startStop = first.route.stops.find((x) => x.id === first.at)!;
    expect(model(first).terrain).toBe(startStop.market ? "market" : "town");
    const leg = pub(planOnLeg());
    expect(model(leg).terrain).toBe(leg.leg!.kind);
  });

  it("left players and missing colours", () => {
    const s = planOnLeg();
    const removed = g.onPlayerRemoved!(s, "p1", ctx(s.deadline - 1000)).state;
    const game = pub(removed);
    const m = model(game, { colorOf: () => null });
    expect(m.walkers.map((w) => w.id)).not.toContain("p1");
    expect(m.walkers.length).toBeGreaterThan(0);
    for (const w of m.walkers) expect(w.color).toBe(FALLBACK_COLOR);
    // A seat marked left but still listed as a traveller is skipped too.
    const marked = structuredClone(pub(s));
    marked.players.find((p) => p.id === "p2")!.left = true;
    expect(model(marked).walkers.map((w) => w.id)).not.toContain("p2");
  });

  it("riders capped by camels", () => {
    const game = pub(planOnLeg());
    game.travellers = [
      { id: "p0", health: 1 },
      { id: "p1", health: 1 },
      { id: "p2", health: 3 },
      { id: "p3", health: 1 },
    ];
    game.stock.animals = 2;
    const m = model(game);
    expect(m.walkers.filter((w) => w.riding).map((w) => w.id)).toEqual(["p0", "p1"]);
    game.stock.animals = 0;
    expect(model(game).walkers.some((w) => w.riding)).toBe(false);
  });

  it("a traveller who dies today fades, then is gone", () => {
    const base = toSummary((p) => !p.lastDay!.plan.rest)!;
    const game = structuredClone(base);
    game.travellers = game.travellers.map((t) => (t.id === "p1" || t.id === "p2" ? { ...t, health: 0 } : t));
    game.lastDay!.report.healthChanges.push({ playerId: "p1", from: 1, to: 0 });
    const m = model(game);
    expect(m.walkers.find((w) => w.id === "p1")?.health).toBe(0);
    expect(m.walkers.map((w) => w.id)).not.toContain("p2");
    expect(m.beats[0]!.health.p1).toBe(1);
    expect(m.beats.at(-1)!.health.p1).toBe(0);
  });

  it("event health is applied last", () => {
    const base = toSummary((p) => !p.lastDay!.plan.rest)!;
    const game = structuredClone(base);
    game.travellers = [
      { id: "p0", health: 2 },
      { id: "p1", health: 1 },
    ];
    game.lastDay!.event = { id: pack.events.find((e) => !("options" in e))!.id, text: "" };
    game.lastDay!.report.healthChanges = [
      { playerId: "p0", from: 3, to: 2 },
      { playerId: "p1", from: 3, to: 1 },
    ];
    game.lastDay!.eventOutcome = { healthChanges: [{ playerId: "p1", from: 3, to: 1 }], stock: { animals: -1 }, km: 0, scoutSaved: false, cargo: 0, lucky: null };
    game.lastDay!.report.stockDelta = { animals: -2 };
    game.stock.animals = 3;
    const m = model(game);
    expect(m.beats.map((b) => b.kind)).toEqual(["travel", "event", "settle"]);
    expect(m.beats[0]!.health).toEqual({ p0: 3, p1: 3 });
    expect(m.beats[1]!.health).toEqual({ p0: 2, p1: 3 });
    expect(m.beats[2]!.health).toEqual({ p0: 2, p1: 1 });
    expect(m.beats.map((b) => b.camels)).toEqual([5, 4, 3]);
  });

  it("an old game without eventOutcome", () => {
    const base = toSummary((p) => !!p.lastDay?.event && !p.lastDay.event.choice)!;
    const game = structuredClone(base);
    delete game.lastDay!.eventOutcome;
    const ev = model(game).beats.find((b) => b.kind === "event")!;
    expect(ev.outcome).toBeNull();
  });

  it("an unfinished day has no beats", () => {
    const base = toSummary(() => true)!;
    const game = structuredClone(base);
    game.lastDay!.unfinished = true;
    expect(kinds(game)).toEqual([]);
  });
});
