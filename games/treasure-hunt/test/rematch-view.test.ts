import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BridgeCall } from "../client/godot/bridge.ts";
import type { THPrivate, THPublic } from "../shared/types.ts";

// C1: "Play again" from results keeps the view mounted, and with Same map
// again the seed doesn't change. The round must still be a new one on the
// page: ready again, a new session for Godot, and nothing carried from the
// last round. A desktop view over a small fake DOM, with a fake Godot host on
// the iframe's window.

class FakeNode {
  children: (FakeNode | string)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  dataset: Record<string, string> = {};
  style = { setProperty() {}, transform: "" } as Record<string, unknown>;
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  contentWindow: Record<string, unknown> | null = null;
  contentDocument = null;
  parent: FakeNode | null = null;
  /** textContent writes, for the HUD test. */
  writes = 0;
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
    if (tag === "iframe") this.contentWindow = { addEventListener() {} };
  }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(v: boolean) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
  addEventListener(t: string, f: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  append(...c: (FakeNode | string)[]) { for (const x of c) { if (x instanceof FakeNode) x.parent = this; this.children.push(x); } }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = []; this.append(...c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  focus() {}
  get lastElementChild(): FakeNode | null { return [...this.children].reverse().find((c): c is FakeNode => c instanceof FakeNode) ?? null; }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(v: string) { this.writes++; this.children = v ? [v] : []; }
  all(): FakeNode[] { return this.children.flatMap((c) => (c instanceof FakeNode ? [c, ...c.all()] : [])); }
}

const g = globalThis as Record<string, unknown>;
const KEYS = ["Node", "document", "matchMedia", "fetch", "addEventListener", "removeEventListener", "location", "devicePixelRatio"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, g[k]]));

beforeAll(() => {
  g.Node = FakeNode;
  g.document = { createElement: (tag: string) => new FakeNode(tag), addEventListener() {}, removeEventListener() {} };
  // A desktop: a fine pointer.
  g.matchMedia = (q: string) => ({ matches: q === "(any-pointer: fine)" });
  g.fetch = async () => ({ ok: true, headers: { get: () => "application/wasm" } });
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.location = { origin: "http://x" };
  g.devicePixelRatio = 1;
});
afterAll(() => Object.assign(g, saved));
afterEach(() => vi.useRealTimers());

const SEED = 4242;
const game = (round: number, phase: THPublic["phase"]): THPublic => ({
  phase,
  mode: "timed",
  target: 5,
  sky: { startMin: 600 },
  seed: SEED,
  round,
  teams: [{ id: 1, color: "orange", foundCount: 0, poolSize: 2 }],
  players: [{ id: "p1", teamId: 1, ready: false, removed: false, spectator: false }],
  startedAt: phase === "hunting" ? 0 : null,
  endsAt: phase === "hunting" ? 600_000 : null,
  countdownEndsAt: null,
  replay: null,
  vehicles: [],
});
const priv = (active: THPrivate["hotcold"]["active"] = null): THPrivate => ({
  teamId: 1,
  pins: [],
  clues: [{ id: "c1", clues: ["a"], difficulty: 1, found: false, taken: false, photo: null }],
  revealed: [],
  hotcold: { used: active !== null, unlockAt: 0, active },
});

type Host = Record<string, (arg?: unknown) => void>;

async function mounted() {
  vi.useFakeTimers();
  const { TreasureHuntView } = await import("../client/view.ts");
  const acts: { type: string }[] = [];
  const api = { act: (a: { type: string }) => (acts.push(a), String(acts.length)), stream() {}, serverNow: () => 1000, setTurn() {} };
  const view = new TreasureHuntView(api as never);
  // The minimap base paints a canvas; not this test's business.
  (view as unknown as { paintBase: () => void }).paintBase = () => {};
  const container = new FakeNode("div");
  view.mount(container as unknown as HTMLElement);
  await vi.advanceTimersByTimeAsync(0);
  const iframe = container.all().find((n) => n.tag === "iframe")!;
  const host = iframe.contentWindow!.treasureHuntHost as Host;
  const sessions: { round: number; layout: { seed: number } }[] = [];
  const calls: BridgeCall[] = [];
  host.initSession = (c) => sessions.push(c as (typeof sessions)[number]);
  for (const fn of ["revealCache", "cacheFound", "setPhase", "roster", "remotePos", "vehicles", "pins", "skyClock", "photos", "hotCold", "sound"])
    host[fn] = (arg) => calls.push({ fn, arg } as BridgeCall);
  const update = (gm: THPublic, p: THPrivate) =>
    view.update({ game: gm, private: p, playerId: "p1", room: { hostId: "p1", seats: [{ id: "p1", name: "Asha" }] } } as never);
  const built = (round: number) => host.emitStatus!({ kind: "world-ready", ms: 1, chunks: 1, seed: SEED, round });
  return { view, host, acts, sessions, calls, update, built };
}

describe("a same-map rematch with the view still mounted", () => {
  it("is a new round: ready again, a new session, no old reveals or level", async () => {
    const { view, host, acts, sessions, calls, update, built } = await mounted();
    // Round 1.
    update(game(1, "teams"), priv());
    host.ready!();
    expect(sessions.map((s) => [s.layout.seed, s.round])).toEqual([[SEED, 1]]);
    built(1);
    expect(acts.filter((a) => a.type === "ready")).toHaveLength(1);
    update(game(1, "hunting"), priv({ id: "c1", until: 900_000, level: null }));
    view.stream("p1", { t: "reveal", id: "c1", x: 5, z: 6, dy: 0 });
    view.stream("p1", { t: "hotcold", id: "c1", level: 3 });
    expect(calls.some((c) => c.fn === "hotCold" && (c.arg as { level: number }).level === 3)).toBe(true);
    update(game(1, "hunting"), priv({ id: "c1", until: 900_000, level: null }));
    expect(calls.some((c) => c.fn === "revealCache")).toBe(true);

    // Results, then Play again: the same seed in round 2. (The signal is
    // still listed here, so only the round change can drop its level.)
    update(game(1, "finished"), priv({ id: "c1", until: 900_000, level: null }));
    calls.length = 0;
    update(game(2, "teams"), priv({ id: "c1", until: 900_000, level: null }));
    expect(sessions.map((s) => [s.layout.seed, s.round])).toEqual([[SEED, 1], [SEED, 2]]);
    expect(calls.filter((c) => c.fn === "revealCache")).toEqual([]);
    // Round 1's relayed 3 is gone: only the state's own (null) level counts, so no meter.
    expect(calls.filter((c) => c.fn === "hotCold").map((c) => c.arg)).toEqual([{ level: -1 }]);
    // Not ready until Godot says round 2 is built; round 1's world-ready again doesn't count.
    expect(acts.filter((a) => a.type === "ready")).toHaveLength(1);
    built(1);
    expect(acts.filter((a) => a.type === "ready")).toHaveLength(1);
    built(2);
    expect(acts.filter((a) => a.type === "ready")).toHaveLength(2);
    // And a resend of round 2 is quiet.
    update(game(2, "teams"), priv());
    built(2);
    expect(sessions).toHaveLength(2);
    expect(acts.filter((a) => a.type === "ready")).toHaveLength(2);
    view.destroy();
  });
});

describe("the HUD on a quiet tick", () => {
  it("writes no text that did not change", async () => {
    const { Hud, hotColdView } = await import("../client/hud.ts");
    const hud = new Hud();
    const p = priv({ id: "c1", until: 60_000, level: 2 });
    const opensP: THPrivate = { ...priv(), hotcold: { used: false, unlockAt: 120_000, active: null } };
    const state = (now: number, pr: THPrivate) => ({ left: 300_000, countdown: null, score: { found: 0, pool: 2, mode: "timed" as const }, priv: pr, clock: 600, hot: hotColdView(pr, now, null) });
    const nodes = [hud.timer, hud.clock, hud.score, hud.count, hud.meter.lastElementChild!, hud.board.children[1]!] as unknown as FakeNode[];
    for (const pr of [p, opensP]) {
      hud.render(state(10_000, pr));
      const before = nodes.map((n) => n.writes);
      hud.render(state(10_100, pr));
      hud.render(state(10_200, pr));
      expect(nodes.map((n) => n.writes)).toEqual(before);
    }
  });
});
