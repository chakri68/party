import { describe, expect, it } from "vitest";
import {
  CACHE_FOOD,
  SEVERITY_WEIGHTS,
  applyEffect,
  drawEvent,
  resolveChoice,
  resolveEvent,
  rollDangers,
  type Armed,
  type Used,
} from "../shared/events.ts";
import { jobInfo } from "../shared/info.ts";
import type { ChoiceEvent, Danger, EventCard, PlainEvent, SettingPack } from "../shared/pack.ts";
import type { JobId } from "../shared/types.ts";
import { P4, never, onLeg, pack as basePack, plan, route, seeded, van, zero } from "./fixtures.ts";

const plain = (id: string, kind: PlainEvent["kind"], severity: Danger, effect: PlainEvent["effect"] = {}): PlainEvent => ({ id, kind, severity, text: id, effect });
const choice = (id: string, kind: ChoiceEvent["kind"], severity: Danger, a: ChoiceEvent["options"][0]["effect"], b: ChoiceEvent["options"][0]["effect"]): ChoiceEvent => ({
  id,
  kind,
  severity,
  text: id,
  options: [{ label: "safe", effect: a }, { label: "bold", effect: b }],
});

const events: EventCard[] = [
  plain("any-0-a", "any", 0, { stock: { food: 2 } }),
  plain("any-0-b", "any", 0, { stock: { coins: 5 } }),
  plain("any-1-c", "any", 1, { stock: { water: -1 } }),
  plain("any-2-d", "any", 2, { stock: { food: -5 } }),
  plain("desert-0-e", "desert", 0),
  plain("desert-2-f", "desert", 2),
  plain("river-1-g", "river", 1),
  plain("any-1-lost", "any", 1, { km: -15, lostTime: true }),
  choice("ch-1", "any", 1, { chance: { p: 0.3, then: {} } }, { chance: { p: 0.7, then: {} } }),
  choice("ch-0", "any", 0, {}, {}),
  choice("ch-2", "any", 2, {}, {}),
  choice("ch-lost", "any", 1, { km: -10, lostTime: true }, {}),
];
const pack = { ...basePack, events } as SettingPack;
const byId = (id: string) => events.find((e) => e.id === id) as EventCard;
const isChoice = (e: EventCard): e is ChoiceEvent => "options" in e;

const armedAll = (o: Partial<Armed> = {}): Armed => ({ guide: false, scout: false, quartermaster: false, lookout: false, ...o });
const usedNone = (): Used => ({ guide: false, scout: false, quartermaster: false, lookout: false });
const living = (): Record<JobId, boolean> => ({ guide: true, healer: true, trader: true, quartermaster: true, scout: true, driver: true, cook: true, lookout: true });

describe("SEVERITY_WEIGHTS and CACHE_FOOD", () => {
  it("has the brief's values", () => {
    expect(SEVERITY_WEIGHTS).toEqual({ 0: [3, 1, 0], 1: [1, 2, 1], 2: [0, 1, 3] });
    expect(CACHE_FOOD).toBe(10);
  });
});

describe("rollDangers", () => {
  it("keys every leg by from>to", () => {
    expect(Object.keys(rollDangers(route, zero)).sort()).toEqual(["a>b", "b>c", "b>d", "c>e", "d>e"]);
  });
  it("never makes the safe branch dangerous", () => {
    expect(rollDangers(route, (n) => n - 1)["b>c"]).toBe(1);
    expect(rollDangers(route, (n) => n - 1)["b>d"]).toBe(2);
    for (let s = 0; s < 50; s++) expect(rollDangers(route, seeded(s))["b>c"]).toBeLessThan(2);
    expect(Object.values(rollDangers(route, zero)).every((d) => d === 0)).toBe(true);
  });
});

describe("drawEvent", () => {
  it("never returns severity 2 at danger 0", () => {
    const rnd = seeded(3);
    for (let i = 0; i < 300; i++) expect(drawEvent(pack, "plain", 0, rnd, []).severity).not.toBe(2);
  });
  it("honours the leg kind, or any", () => {
    const rnd = seeded(5);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const e = drawEvent(pack, "desert", 1, rnd, []);
      expect(["desert", "any"]).toContain(e.kind);
      seen.add(e.kind);
    }
    expect(seen.has("desert")).toBe(true);
    expect(seen.has("any")).toBe(true);
    for (let i = 0; i < 100; i++) expect(drawEvent(pack, "river", 2, rnd, []).id).not.toMatch(/^desert/);
  });
  it("does not repeat an excluded id until the pool is used up, then reshuffles", () => {
    const rnd = seeded(11);
    const matching = events.filter((e) => e.kind === "river" || e.kind === "any");
    const drawn: string[] = [];
    for (let i = 0; i < matching.length; i++) drawn.push(drawEvent(pack, "river", 1, rnd, drawn).id);
    expect(new Set(drawn).size).toBe(matching.length);
    expect(matching.map((e) => e.id)).toContain(drawEvent(pack, "river", 1, rnd, drawn).id);
  });
  it("weights severity by danger, using only severities in the pool", () => {
    // danger 1 weights [1,2,1]. randomInt 0 -> severity 0, 1..2 -> 1, 3 -> 2.
    expect(drawEvent(pack, "plain", 1, () => 0, []).severity).toBe(0);
    let calls = 0;
    const r = () => (calls++ === 0 ? 1 : 0);
    expect(drawEvent(pack, "plain", 1, r, []).severity).toBe(1);
    const only2 = { ...pack, events: [plain("x", "any", 2)] } as SettingPack;
    expect(drawEvent(only2, "plain", 0, zero, []).id).toBe("x"); // weights all 0 -> falls back to what exists
  });
  it("draws every pick through randomInt", () => {
    const seen: number[] = [];
    drawEvent(pack, "plain", 1, (n) => (seen.push(n), 0), []);
    expect(seen.length).toBe(2);
  });
});

describe("applyEffect", () => {
  it("hits the weakest living traveller, ties by randomInt, never the dead", () => {
    const c = van({ health: { p1: 3, p2: 1, p3: 2, p4: 3 } });
    const r = applyEffect(c, { health: { target: "weakest", steps: 1 } }, P4, zero);
    expect(c.health.p2).toBe(0);
    expect(r.healthChanges).toEqual([{ playerId: "p2", from: 1, to: 0 }]);
    const t = van({ health: { p1: 2, p2: 2, p3: 3, p4: 0 } });
    applyEffect(t, { health: { target: "weakest", steps: 1 } }, P4, (n) => n - 1);
    expect(t.health).toEqual({ p1: 2, p2: 1, p3: 3, p4: 0 });
    const d = van({ health: { p1: 0, p2: 3, p3: 3, p4: 3 } });
    applyEffect(d, { health: { target: "weakest", steps: 1 } }, P4, zero);
    expect(d.health.p1).toBe(0);
    expect(d.health.p2).toBe(2);
  });
  it("hits everyone or a random living traveller", () => {
    const c = van({ health: { p1: 3, p2: 0, p3: 3, p4: 3 } });
    const r = applyEffect(c, { health: { target: "everyone", steps: 1 } }, P4, zero);
    expect(c.health).toEqual({ p1: 2, p2: 0, p3: 2, p4: 2 });
    expect(r.healthChanges).toHaveLength(3);
    const k = van({ health: { p1: 0, p2: 3, p3: 3, p4: 3 } });
    applyEffect(k, { health: { target: "random", steps: 1 } }, P4, zero);
    expect(k.health).toEqual({ p1: 0, p2: 2, p3: 3, p4: 3 });
  });
  it("clamps stock at 0 and reports what actually changed", () => {
    const c = van({ stock: { ...van().stock, food: 10 } });
    const r = applyEffect(c, { stock: { food: -50, coins: 7 } }, P4, zero);
    expect(c.stock.food).toBe(0);
    expect(c.stock.coins).toBe(57);
    expect(r.stock).toEqual({ food: -10, coins: 7 });
  });
  it("loses cargo from the most-held good", () => {
    const c = van({ stock: { ...van().stock, cargo: { silk: 5, tea: 2 } } });
    applyEffect(c, { cargo: -3 }, P4, zero);
    expect(c.stock.cargo).toEqual({ silk: 2, tea: 2 });
    applyEffect(c, { cargo: -9 }, P4, zero);
    expect(Object.values(c.stock.cargo).every((n) => n >= 0)).toBe(true);
  });
  it("applies then on a hit and else on a miss", () => {
    const e = { chance: { p: 1, then: { stock: { coins: 10 } }, else: { stock: { coins: -10 } } } };
    const a = van();
    applyEffect(a, e, P4, never);
    expect(a.stock.coins).toBe(60);
    const b = van();
    applyEffect(b, { chance: { ...e.chance, p: 0 } }, P4, zero);
    expect(b.stock.coins).toBe(40);
    const n = van();
    applyEffect(n, { chance: { p: 0, then: { stock: { coins: 10 } } } }, P4, zero);
    expect(n.stock.coins).toBe(50);
  });
  it("moves km on the current leg, never back past the stop it left", () => {
    const c = onLeg("plain", 20);
    expect(applyEffect(c, { km: -30 }, P4, zero).km).toBe(-30);
    expect(c.kmLeft).toBe(50);
    expect(applyEffect(c, { km: -200 }, P4, zero).km).toBe(-40);
    expect(c.kmLeft).toBe(90);
  });
  it("does nothing with km while halted at a stop", () => {
    const c = van();
    const r = applyEffect(c, { km: -30 }, P4, zero);
    expect(r.km).toBe(0);
    expect(c.kmLeft).toBe(0);
  });
  it("lets a Scout flag zero km on lostTime effects, including the chosen chance branch", () => {
    const c = onLeg("plain", 20);
    applyEffect(c, { km: -15, lostTime: true, stock: { coins: 1 } }, P4, zero, { scout: true });
    expect(c.kmLeft).toBe(20);
    expect(c.stock.coins).toBe(51);
    const d = onLeg("plain", 20);
    applyEffect(d, { chance: { p: 0, then: {}, else: { km: -20, lostTime: true } } }, P4, zero, { scout: true });
    expect(d.kmLeft).toBe(20);
    const e = onLeg("plain", 20);
    applyEffect(e, { km: -10 }, P4, zero, { scout: true });
    expect(e.kmLeft).toBe(30); // not a lostTime effect
  });
});

describe("resolveEvent", () => {
  it("rerolls the first plain event with an armed Guide, once", () => {
    const c = van();
    const armed = armedAll({ guide: true });
    const used = usedNone();
    const r = resolveEvent(c, pack, byId("any-0-a"), armed, used, living(), P4, zero);
    expect(r.fired).toContain("guide");
    expect(used.guide).toBe(true);
    expect(armed.guide).toBe(false);
    expect(r.card.id).not.toBe("any-0-a");
    expect(isChoice(r.card)).toBe(false);
    expect(r.pendingChoice).toBeNull();
    expect(r.report).not.toBeNull();
    const again = resolveEvent(c, pack, byId("any-0-a"), armed, used, living(), P4, zero);
    expect(again.card.id).toBe("any-0-a");
    expect(again.fired).toEqual([]);
  });
  it("does not reroll when the Guide is dead, unarmed or the event is a choice", () => {
    const dead = { ...living(), guide: false };
    const armed = armedAll({ guide: true });
    const used = usedNone();
    const r = resolveEvent(van(), pack, byId("any-0-a"), armed, used, dead, P4, zero);
    expect(r.card.id).toBe("any-0-a");
    expect(r.fired).toEqual([]);
    expect(used.guide).toBe(false);
    expect(resolveEvent(van(), pack, byId("any-0-a"), armedAll(), usedNone(), living(), P4, zero).card.id).toBe("any-0-a");
    const k = resolveEvent(van(), pack, byId("ch-1"), armed, used, living(), P4, zero);
    expect(k.card.id).toBe("ch-1");
    expect(armed.guide).toBe(true);
  });
  it("applies a plain event and reports it", () => {
    const c = van();
    const r = resolveEvent(c, pack, byId("any-0-a"), armedAll(), usedNone(), living(), P4, zero);
    expect(c.stock.food).toBe(102);
    expect(r.report?.stock).toEqual({ food: 2 });
    expect(r.pendingChoice).toBeNull();
  });
  it("swaps the first choice event with an armed Lookout", () => {
    const armed = armedAll({ lookout: true });
    const used = usedNone();
    const r = resolveEvent(van(), pack, byId("ch-1"), armed, used, living(), P4, zero);
    expect(r.fired).toContain("lookout");
    expect(used.lookout).toBe(true);
    expect(armed.lookout).toBe(false);
    expect(r.pendingChoice).not.toBeNull();
    expect(r.pendingChoice?.id).toBe(r.card.id);
    expect(r.pendingChoice?.id).not.toBe("ch-1");
    expect(r.report).toBeNull();
    const second = resolveEvent(van(), pack, byId("ch-1"), armed, used, living(), P4, zero);
    expect(second.pendingChoice?.id).toBe("ch-1");
    expect(second.fired).toEqual([]);
  });
  it("leaves a choice pending untouched without a Lookout", () => {
    const r = resolveEvent(van(), pack, byId("ch-0"), armedAll(), usedNone(), living(), P4, zero);
    expect(r.pendingChoice?.id).toBe("ch-0");
    expect(r.report).toBeNull();
  });
  it("zeroes a lostTime effect with an armed Scout", () => {
    const c = onLeg("plain", 20);
    const armed = armedAll({ scout: true });
    const used = usedNone();
    const r = resolveEvent(c, pack, byId("any-1-lost"), armed, used, living(), P4, zero);
    expect(c.kmLeft).toBe(20);
    expect(r.report?.km).toBe(0);
    expect(r.fired).toContain("scout");
    expect(used.scout).toBe(true);
    expect(armed.scout).toBe(false);
  });
  it("does nothing for a dead Scout, and for a Scout with nothing to save", () => {
    const c = onLeg("plain", 20);
    const armed = armedAll({ scout: true });
    const used = usedNone();
    const r = resolveEvent(c, pack, byId("any-1-lost"), armed, used, { ...living(), scout: false }, P4, zero);
    expect(c.kmLeft).toBe(35);
    expect(r.fired).toEqual([]);
    expect(used.scout).toBe(false);
    const q = resolveEvent(onLeg("plain", 20), pack, byId("any-0-a"), armed, used, living(), P4, zero);
    expect(q.fired).toEqual([]);
    expect(armed.scout).toBe(true);
  });
  it("keeps the Scout armed when it saved nothing", () => {
    const armed = armedAll({ scout: true });
    const used = usedNone();
    const miss = { ...plain("chancy", "any", 1), effect: { chance: { p: 0, then: {}, else: { km: -20, lostTime: true } } } } as PlainEvent;
    // p 0 -> else branch has lostTime, so it saves; p 1 -> then branch has none
    const hit = { ...miss, effect: { chance: { p: 1, then: { stock: { coins: 1 } }, else: { km: -20, lostTime: true } } } } as PlainEvent;
    const r = resolveEvent(onLeg("plain", 20), pack, hit, armed, used, living(), P4, never);
    expect(r.fired).toEqual([]);
    expect(used.scout).toBe(false);
    expect(armed.scout).toBe(true);
    const h = resolveEvent(van(), pack, byId("any-1-lost"), armed, used, living(), P4, zero);
    expect(h.fired).toEqual([]);
    expect(armed.scout).toBe(true);
    expect(used.scout).toBe(false);
    const c = onLeg("plain", 20);
    expect(resolveEvent(c, pack, miss, armed, used, living(), P4, zero).fired).toEqual(["scout"]);
    expect(c.kmLeft).toBe(20);
  });
  it("sets a pending choice for the Scout to act on later", () => {
    const c = onLeg("plain", 20);
    const armed = armedAll({ scout: true });
    const used = usedNone();
    const card = byId("ch-lost") as ChoiceEvent;
    expect(resolveEvent(c, pack, card, armed, used, living(), P4, zero).fired).toEqual([]);
    const r = resolveChoice(c, card, 0, armed, used, living(), P4, zero);
    expect(c.kmLeft).toBe(20);
    expect(r.fired).toContain("scout");
    expect(used.scout).toBe(true);
    const r2 = resolveChoice(onLeg("plain", 20), card, 1, armedAll({ scout: true }), usedNone(), living(), P4, zero);
    expect(r2.fired).toEqual([]); // option 1 has no lostTime
  });
});

describe("jobInfo", () => {
  const state = (o: Partial<Parameters<typeof jobInfo>[4]> = {}): Parameters<typeof jobInfo>[4] => ({
    dangers: { "a>b": 1, "b>c": 0, "b>d": 2, "c>e": 2, "d>e": 1 },
    plan: plan(),
    travellers: P4,
    choice: null,
    ...o,
  });
  const info = (job: JobId, c = van(), s = state()) => jobInfo(job, c, pack, route, s);

  it("quartermaster counts days at current rations and the next leg", () => {
    const c = van({ stock: { ...van().stock, food: 20 } });
    expect(info("quartermaster", c)).toEqual({ job: "quartermaster", foodDays: 2, waterDays: 25 });
    expect(info("quartermaster", c, state({ plan: plan({ rations: "half" }) }))).toMatchObject({ foodDays: 5 });
    const desert = van({ at: "b", stock: { ...van().stock, water: 20 } });
    expect(info("quartermaster", desert)).toMatchObject({ waterDays: 2 }); // b>c is the safe branch, desert: 8 a day
    expect(info("quartermaster", van({ health: { p1: 3, p2: 0, p3: 0, p4: 0 }, stock: { ...van().stock, food: 20 } }))).toMatchObject({ foodDays: 10 });
  });
  it("guide shows the next leg's danger, or null at the end", () => {
    expect(info("guide")).toEqual({ job: "guide", nextLeg: 1 });
    expect(info("guide", van({ at: "b" }))).toEqual({ job: "guide", nextLeg: 0 }); // safe branch
    expect(info("guide", onLeg("plain", 20))).toEqual({ job: "guide", nextLeg: 1 }); // heading to d, then d>e
    expect(info("guide", van({ at: "e" }))).toEqual({ job: "guide", nextLeg: null });
  });
  it("scout shows km on each branch of the next fork, or null", () => {
    expect(info("scout")).toEqual({ job: "scout", nextFork: { stop: "b", km: { c: 130, d: 100 } } });
    expect(info("scout", van({ at: "b" }))).toMatchObject({ nextFork: { stop: "b" } });
    expect(info("scout", van({ at: "d" }))).toEqual({ job: "scout", nextFork: null });
    const toB = van({ leg: { to: "b", km: 100, kind: "plain" }, kmLeft: 40 });
    expect(info("scout", toB)).toMatchObject({ nextFork: { stop: "b" } });
    expect(info("scout", onLeg("plain", 20))).toEqual({ job: "scout", nextFork: null }); // heading to d
  });
  it("trader shows the next market's prices", () => {
    expect(info("trader")).toEqual({ job: "trader", nextMarket: { stop: "a", prices: { silk: 10 } } });
    expect(info("trader", onLeg("plain", 20))).toEqual({ job: "trader", nextMarket: { stop: "d", prices: { silk: 10 } } });
    expect(info("trader", van({ at: "b" }))).toEqual({ job: "trader", nextMarket: null }); // safe branch has none
  });
  it("healer gives today's worsen chance per sick or hurt living traveller", () => {
    const c = van({ health: { p1: 2, p2: 3, p3: 0, p4: 1 } });
    expect(info("healer", c)).toEqual({ job: "healer", worsenChance: { p1: 0.12, p4: 0.12 } });
    const half = info("healer", c, state({ plan: plan({ rations: "half" }) }));
    expect(half).toEqual({ job: "healer", worsenChance: { p1: 0.24, p4: 0.24 } });
    const rest = info("healer", c, state({ plan: plan({ rest: true, pace: "hard" }) }));
    expect(rest).toMatchObject({ worsenChance: { p1: 0.12 } });
    const hard = info("healer", c, state({ plan: plan({ pace: "hard" }) }));
    expect(hard).toMatchObject({ worsenChance: { p1: 0.24 } });
    const thirsty = van({ stock: { ...van().stock, water: 1 }, health: { p1: 2, p2: 3, p3: 3, p4: 3 } });
    expect(info("healer", thirsty)).toMatchObject({ worsenChance: { p1: 0.48 } }); // sick 1 + thirst 3
    const forkHalt = van({ at: "b", stock: { ...van().stock, water: 5 }, health: { p1: 2, p2: 3, p3: 3, p4: 3 } });
    expect(info("healer", forkHalt, state({ plan: plan({ fork: "d" }) }))).toMatchObject({ worsenChance: { p1: 0.12 } }); // plain: 4 water needed
    expect(info("healer", forkHalt, state({ plan: plan({ fork: "c" }) }))).toMatchObject({ worsenChance: { p1: 0.48 } }); // desert: 8 needed, thirsty
    const worst = van({ stock: { ...van().stock, water: 0, food: 0 }, health: { p1: 1, p2: 3, p3: 3, p4: 3 } });
    expect(info("healer", worst, state({ plan: plan({ rations: "none", pace: "hard" }) }))).toMatchObject({ worsenChance: { p1: 0.84 } });
  });
  it("driver shows fatigue and its max", () => {
    expect(info("driver", van({ fatigue: 2 }))).toEqual({ job: "driver", fatigue: 2, max: 3 });
  });
  it("cook shows food days at each rations level", () => {
    expect(info("cook")).toEqual({ job: "cook", foodDays: { full: 12, half: 25, none: 99 } });
  });
  it("lookout shows the open choice's odds", () => {
    expect(info("lookout")).toEqual({ job: "lookout", odds: null });
    const ch = byId("ch-1") as ChoiceEvent;
    expect(info("lookout", van(), state({ choice: ch }))).toEqual({
      job: "lookout",
      odds: [{ option: 0, p: 0.3 }, { option: 1, p: 0.7 }],
    });
    expect(info("lookout", van(), state({ choice: byId("ch-0") as ChoiceEvent }))).toEqual({
      job: "lookout",
      odds: [{ option: 0, p: 0 }, { option: 1, p: 0 }],
    });
  });
});
