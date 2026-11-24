import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countdown, formatSeconds } from "../src/index.ts";

/** Just enough DOM for the pill: the tests run in Node. */
class FakeEl {
  attrs = new Map<string, string>();
  children: (FakeEl | string)[] = [];
  hidden = false;
  innerHTML = "";
  classes = new Set<string>();
  constructor(readonly tagName: string) {}
  classList = {
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classes.has(c);
      if (want) this.classes.add(c);
      else this.classes.delete(c);
      return want;
    },
  };
  setAttribute(k: string, v: string) {
    if (k === "class") for (const c of v.split(" ")) this.classes.add(c);
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  append(...kids: (FakeEl | string)[]) {
    this.children.push(...kids);
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(t: string) {
    this.children = [t];
  }
}

const g = globalThis as unknown as { document?: unknown; Node?: unknown };

beforeEach(() => {
  g.Node = FakeEl;
  g.document = { createElement: (tag: string) => new FakeEl(tag) };
});
afterEach(() => {
  delete g.Node;
  delete g.document;
});

describe("formatSeconds", () => {
  it("rounds up to whole seconds", () => {
    expect(formatSeconds(45_000)).toBe("45 s");
    expect(formatSeconds(44_001)).toBe("45 s");
    expect(formatSeconds(1)).toBe("1 s");
  });
  it("uses minutes from 60 s", () => {
    expect(formatSeconds(59_001)).toBe("1:00");
    expect(formatSeconds(65_000)).toBe("1:05");
    expect(formatSeconds(600_000)).toBe("10:00");
  });
  it("never goes below zero", () => {
    expect(formatSeconds(-5)).toBe("0 s");
    expect(formatSeconds(0)).toBe("0 s");
  });
});

describe("countdown", () => {
  const pill = () => {
    const c = countdown();
    return { c, el: c.el as unknown as FakeEl };
  };

  it("is a span.countdown timer with an icon and a text span", () => {
    const { el } = pill();
    expect(el.tagName).toBe("span");
    expect(el.classList.contains("countdown")).toBe(true);
    expect(el.getAttribute("role")).toBe("timer");
    expect(el.getAttribute("aria-live")).toBe("off");
    const [icon, text] = el.children as FakeEl[];
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.innerHTML).toContain("<svg");
    expect(text.tagName).toBe("span");
  });

  it("hides with no time, or none left", () => {
    const { c, el } = pill();
    c.set(null);
    expect(el.hidden).toBe(true);
    c.set(30_000);
    expect(el.hidden).toBe(false);
    c.set(0);
    expect(el.hidden).toBe(true);
    c.set(-200);
    expect(el.hidden).toBe(true);
    c.set(30_000);
    c.set(NaN);
    expect(el.hidden).toBe(true);
    c.set(NaN, { stopped: true });
    expect(el.hidden).toBe(true);
  });

  it("goes low at 10 s or less", () => {
    const { c, el } = pill();
    c.set(5_000);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("5 s");
    expect(el.classList.contains("low")).toBe(true);
    c.set(30_000);
    expect(el.textContent).toBe("30 s");
    expect(el.classList.contains("low")).toBe(false);
    c.set(10_000);
    expect(el.classList.contains("low")).toBe(true);
    c.set(25_000, { lowAt: 30_000 });
    expect(el.classList.contains("low")).toBe(true);
  });

  it("says Paused while paused, even with no time left", () => {
    const { c, el } = pill();
    c.set(30_000, { paused: true });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("Paused");
    expect(el.classList.contains("low")).toBe(false);
    c.set(0, { paused: true });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("Paused");
    expect(el.getAttribute("aria-label")).toBe("Timer paused");
  });

  it("shows a held clock's time, muted, and says it is paused", () => {
    const { c, el } = pill();
    c.set(5_000, { stopped: true });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("5 s");
    expect(el.classList.contains("stopped")).toBe(true);
    expect(el.classList.contains("low")).toBe(false);
    expect(el.getAttribute("aria-label")).toBe("Paused. Time left: 5 seconds");
    c.set(5_000);
    expect(el.classList.contains("stopped")).toBe(false);
    expect(el.classList.contains("low")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Time left: 5 seconds");
  });

  it("updates its label at most once per 10 s", () => {
    const { c, el } = pill();
    c.set(30_000);
    expect(el.getAttribute("aria-label")).toBe("Time left: 30 seconds");
    c.set(29_500);
    expect(el.getAttribute("aria-label")).toBe("Time left: 30 seconds");
    c.set(25_000);
    expect(el.getAttribute("aria-label")).toBe("Time left: 30 seconds");
    c.set(19_000);
    expect(el.getAttribute("aria-label")).toBe("Time left: 19 seconds");
    c.set(1_000);
    expect(el.getAttribute("aria-label")).toBe("Time left: 1 second");
  });

  it("says minutes in the label from 60 s", () => {
    const { c, el } = pill();
    c.set(65_000);
    expect(el.textContent).toBe("1:05");
    expect(el.getAttribute("aria-label")).toBe("Time left: 1 minute 5 seconds");
    c.set(120_000);
    expect(el.getAttribute("aria-label")).toBe("Time left: 2 minutes");
  });

  it("owns no timer of its own", () => {
    const src = readFileSync(new URL("../src/countdown.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
