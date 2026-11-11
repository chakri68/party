import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { THAction, THPublic } from "../shared/types.ts";

// The panel's picker, through a small fake DOM (the tests run in node).
class FakeNode {
  children: (FakeNode | string)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(v: boolean) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
  value = "";
  addEventListener(t: string, f: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = []; this.append(...c); }
  all(): FakeNode[] { return this.children.flatMap((c) => (c instanceof FakeNode ? [c, ...c.all()] : [])); }
  click() { for (const f of this.listeners.get("click") ?? []) f({}); }
}

const g = globalThis as Record<string, unknown>;
const saved = { Node: g.Node, document: g.document };
beforeAll(() => {
  g.Node = FakeNode;
  g.document = { createElement: (tag: string) => new FakeNode(tag) };
});
afterAll(() => Object.assign(g, saved));

const game = (phase: string) =>
  ({
    phase,
    teams: [{ id: 1, color: "orange", foundCount: 0, poolSize: 0 }],
    players: [
      { id: "me", teamId: 1, ready: true, removed: false, spectator: false, character: "male-b" },
      { id: "p2", teamId: 1, ready: true, removed: false, spectator: false, character: "female-a" },
    ],
  }) as unknown as THPublic;

async function panel(phase = "teams") {
  const { TeamsPanel } = await import("../client/teams.ts");
  const acts: THAction[] = [];
  const p = new TeamsPanel((a) => acts.push(a));
  p.update(game(phase), { me: "Asha", p2: "Ravi" }, "me", false);
  const pickers = (p.el as unknown as FakeNode).all().filter((n) => n.getAttribute("class") === "th-picker");
  const buttons = pickers.flatMap((n) => n.all().filter((b) => b.tag === "button"));
  return { acts, pickers, buttons, el: p.el as unknown as FakeNode };
}

describe("the character picker", () => {
  it("shows once, for my row only, with eight buttons", async () => {
    const { pickers, buttons } = await panel();
    expect(pickers).toHaveLength(1);
    expect(buttons).toHaveLength(8);
  });

  it("has the heading Your character", async () => {
    const { el } = await panel();
    expect(el.all().some((n) => n.getAttribute("class") === "th-picker-title" && n.children.join("") === "Your character")).toBe(true);
  });

  it("presses the chosen one only", async () => {
    const { buttons } = await panel();
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false", "false", "true", "false", "false"]);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Woman 1");
  });

  it("sends the character action on click", async () => {
    const { buttons, acts } = await panel();
    buttons[6]!.click();
    expect(acts).toEqual([{ type: "character", id: "male-c" }]);
  });

  it("is absent outside the teams phase", async () => {
    const { pickers } = await panel("playing");
    expect(pickers).toHaveLength(0);
  });
});
