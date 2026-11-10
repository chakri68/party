import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { THPublic } from "../shared/types.ts";

// A small fake DOM, just enough for the view's constructor and render: the
// test runs in node, and a phone never touches the Godot iframe.
class FakeNode {
  children: (FakeNode | string)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  dataset: Record<string, string> = {};
  style = { setProperty() {}, transform: "" } as Record<string, unknown>;
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  value = "";
  parent: FakeNode | null = null;
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(v: boolean) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
  get disabled() { return this.attrs.has("disabled"); }
  addEventListener(t: string, f: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  append(...c: (FakeNode | string)[]) { for (const x of c) { if (x instanceof FakeNode) x.parent = this; this.children.push(x); } }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = []; this.append(...c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(v: string) { this.children = v ? [v] : []; }
  /** Every element under this one, depth first. */
  all(): FakeNode[] { return this.children.flatMap((c) => (c instanceof FakeNode ? [c, ...c.all()] : [])); }
  /** Shown: neither it nor anything above it is hidden. */
  shown(): boolean { return !this.hidden && (this.parent ? this.parent.shown() : true); }
}

const g = globalThis as Record<string, unknown>;
const saved = { Node: g.Node, document: g.document, matchMedia: g.matchMedia };

beforeAll(() => {
  g.Node = FakeNode;
  g.document = { createElement: (tag: string) => new FakeNode(tag) };
  // Touch only: a coarse pointer and no fine one.
  g.matchMedia = (q: string) => ({ matches: q === "(pointer: coarse)" });
});
afterAll(() => Object.assign(g, saved));

const game = (ready: boolean) =>
  ({
    phase: "teams",
    mode: "timed",
    target: 5,
    sky: { startMin: 600 },
    seed: 1,
    teams: [{ id: 1, color: "orange", foundCount: 0, poolSize: 0 }],
    players: [
      { id: "host", teamId: 1, ready: false, removed: false, spectator: false },
      { id: "p2", teamId: 1, ready, removed: false, spectator: false },
    ],
    startedAt: null,
    endsAt: null,
    countdownEndsAt: null,
    replay: null,
    vehicles: [],
  }) as THPublic;

async function phoneHost(ready: boolean) {
  const { TreasureHuntView } = await import("../client/view.ts");
  const acts: unknown[] = [];
  const api = { act: (a: unknown) => (acts.push(a), String(acts.length)), stream() {}, serverNow: () => 0, setTurn() {} };
  const view = new TreasureHuntView(api);
  const container = new FakeNode("div");
  view.mount(container as unknown as HTMLElement);
  view.update({
    game: game(ready),
    private: null,
    playerId: "host",
    room: { hostId: "host", seats: [{ id: "host", name: "Asha" }, { id: "p2", name: "Ravi" }] },
  } as never);
  const start = container.all().find((n) => n.tag === "button" && n.textContent === "Start");
  return { start, acts };
}

describe("a touch-only host", () => {
  it("gets an enabled Start in teams once someone is ready", async () => {
    const { start } = await phoneHost(true);
    expect(start).toBeDefined();
    expect(start!.shown()).toBe(true);
    expect(start!.disabled).toBe(false);
  });

  it("gets a disabled Start while nobody is ready", async () => {
    const { start } = await phoneHost(false);
    expect(start?.disabled).toBe(true);
  });
});
