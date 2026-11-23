import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signalLevel, signalMeter, signalText, TIP_MS } from "../src/signal.ts";

describe("ping meter", () => {
  it("grades the round trip", () => {
    expect(signalLevel(null)).toBe("none");
    expect(signalLevel(40)).toBe("good");
    expect(signalLevel(149)).toBe("good");
    expect(signalLevel(150)).toBe("ok");
    expect(signalLevel(299)).toBe("ok");
    expect(signalLevel(300)).toBe("slow");
  });

  it("says it in words", () => {
    expect(signalText(84.4)).toBe("Connection: Good");
    expect(signalText(200)).toBe("Connection: Weak");
    expect(signalText(450)).toBe("Connection: Bad");
    expect(signalText(null)).toBe("Connection: not connected yet");
  });
});

// A small fake DOM, just enough for the meter: the test runs in node.
class FakeNode {
  children: (FakeNode | string)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };
  innerHTML = "";
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(t: string, f: () => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  click() { for (const f of this.listeners.get("click") ?? []) f(); }
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(v: string) { this.children = v ? [v] : []; }
}

const g = globalThis as Record<string, unknown>;
const saved = { Node: g.Node, document: g.document };
beforeAll(() => {
  g.Node = FakeNode;
  g.document = { createElement: (tag: string) => new FakeNode(tag) };
});
afterAll(() => Object.assign(g, saved));

describe("ping meter tip", () => {
  it("a tap shows the word next to the bars, then hides it", () => {
    vi.useFakeTimers();
    try {
      const m = signalMeter();
      const [button, tip] = (m.el as unknown as FakeNode).children as FakeNode[];
      // The tip is the button's sibling (a live region), not inside it.
      expect(button).toBe(m.button as unknown);
      expect(tip!.getAttribute("role")).toBe("status");
      m.set(200);
      expect(tip!.classList.contains("show")).toBe(false);
      button!.click();
      expect(tip!.classList.contains("show")).toBe(true);
      expect(tip!.textContent).toBe("Connection: Weak");
      vi.advanceTimersByTime(TIP_MS - 1);
      expect(tip!.classList.contains("show")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(tip!.classList.contains("show")).toBe(false);
      expect(tip!.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
