import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextRevealState, roleReveal } from "../src/reveal.ts";

// The widget is a thin DOM shell over this; it's checked in browser QA of the
// first game that uses it (no DOM test environment here).
describe("nextRevealState", () => {
  it("a tap toggles", () => {
    expect(nextRevealState("hidden", "tap")).toBe("shown");
    expect(nextRevealState("shown", "tap")).toBe("hidden");
  });

  it("backgrounding the tab always hides, so you come back to a face-down card", () => {
    expect(nextRevealState("shown", "background")).toBe("hidden");
    expect(nextRevealState("hidden", "background")).toBe("hidden");
  });
});

/** Just enough DOM for the card: the tests run in Node. */
class FakeEl extends EventTarget {
  className = "";
  tabIndex = -1;
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: unknown[] = [];
  tagName: string;
  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  append(...kids: unknown[]) {
    this.children.push(...kids);
  }
  replaceChildren(...kids: unknown[]) {
    this.children = kids;
  }
  remove() {}
}

describe("roleReveal", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  beforeEach(() => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean; createElement(tag: string): FakeEl };
    doc.hidden = false;
    doc.createElement = (tag) => new FakeEl(tag);
    g.document = doc;
    g.window = new EventTarget();
  });
  afterEach(() => {
    g.document = saved.document;
    g.window = saved.window;
  });

  it("hide() turns a shown card face down, and a tap shows it again", () => {
    const r = roleReveal({ title: "Your card", body: "Wolf" });
    const card = (r.el as unknown as FakeEl).children[1] as FakeEl;
    expect(r.el.dataset.state).toBe("hidden");
    card.dispatchEvent(new Event("click"));
    expect(r.el.dataset.state).toBe("shown");
    r.hide();
    expect(r.el.dataset.state).toBe("hidden");
    expect(card.attrs.get("aria-pressed")).toBe("false");
    card.dispatchEvent(new Event("click"));
    expect(r.el.dataset.state).toBe("shown");
    r.destroy();
  });
});
