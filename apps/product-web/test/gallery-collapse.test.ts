import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootGallery, collapseList } from "../src/gallery-collapse.ts";
import { galleryHtml } from "../src/gallery.ts";

/** Just enough DOM: the tests run in Node. */
class FakeEl extends EventTarget {
  hidden = false;
  type = "";
  className = "";
  textContent = "";
  parent: FakeEl | null = null;
  kids: FakeEl[] = [];
  attrs = new Map<string, string>();
  constructor(readonly tag: string, cls = "") {
    super();
    this.className = cls;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  append(...k: FakeEl[]) {
    for (const c of k) {
      c.parent = this;
      this.kids.push(c);
    }
  }
  remove() {
    if (this.parent) this.parent.kids = this.parent.kids.filter((c) => c !== this);
    this.parent = null;
  }
  all(): FakeEl[] {
    return this.kids.flatMap((k) => [k, ...k.all()]);
  }
  querySelectorAll(sel: string) {
    const [tag, cls] = sel.split(".");
    return this.all().filter((e) => (!tag || e.tag === tag) && (!cls || e.className.split(" ").includes(cls)));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  focus() {
    focused = this;
  }
  after(n: FakeEl) {
    const sibs = this.parent!.kids;
    n.parent = this.parent;
    sibs.splice(sibs.indexOf(this) + 1, 0, n);
  }
  closest(sel: string) {
    const cls = sel.slice(1);
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.className.split(" ").includes(cls)) return e;
    return null;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}

let focused: FakeEl | null = null;

/** shelves: how many games in each. */
function fakeList(shelves: number[]) {
  const root = new FakeEl("body");
  const list = new FakeEl("ul");
  root.append(list);
  for (const n of shelves) {
    const shelf = new FakeEl("section", "shelf");
    const ul = new FakeEl("ul");
    for (let i = 0; i < n; i++) ul.append(new FakeEl("li", "game"));
    shelf.append(ul);
    list.append(shelf);
  }
  return list;
}

const asEl = (l: FakeEl) => l as unknown as HTMLElement;
const games = (l: FakeEl) => l.querySelectorAll("li.game");
const button = (l: FakeEl) => l.parent!.querySelector("button");

function stubDom(narrow: boolean, hash = "") {
  const mq = Object.assign(new EventTarget(), { matches: narrow });
  vi.stubGlobal("document", { createElement: (t: string) => new FakeEl(t) });
  vi.stubGlobal("matchMedia", (q: string) => {
    expect(q).toBe("(max-width: 599px)");
    return mq;
  });
  const win = new EventTarget();
  vi.stubGlobal("location", { hash });
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  return { mq, win };
}

afterEach(() => {
  vi.unstubAllGlobals();
  focused = null;
});

describe("galleryHtml with JS off", () => {
  it("keeps every game, and nothing in the HTML hides one", () => {
    const g = { name: "G", description: "d", players: "2 players", pass: false, computers: false };
    const html = galleryHtml([{ id: "cards", section: "Cards", games: Array.from({ length: 12 }, (_, i) => ({ ...g, id: `g${i}` })) }]);
    expect(html.match(/<li class="game"/g)).toHaveLength(12);
    expect(html).not.toMatch(/ hidden[ >=]|collapsed/);
  });

  it("only hides with a class that script adds", () => {
    const css = readFileSync(new URL("../src/site.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.game\[hidden\]/);
    expect(css).toMatch(/\.shelf\[hidden\]/);
  });
});

describe("collapseList", () => {
  beforeEach(() => void stubDom(true));
  it("hides the games after the first N and adds a Show all button", () => {
    const list = fakeList([5, 5, 5]);
    collapseList(asEl(list), 8);
    expect(games(list).map((g) => g.hidden)).toEqual([...Array(8).fill(false), ...Array(7).fill(true)]);
    const b = button(list)!;
    expect(b.textContent).toBe("Show all 15 games");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.type).toBe("button");
  });

  it("hides a shelf with no visible game", () => {
    const list = fakeList([8, 3]);
    collapseList(asEl(list), 8);
    expect(list.querySelectorAll("section.shelf").map((s) => s.hidden)).toEqual([false, true]);
  });

  it("opens everything on click, flips aria-expanded, then removes the button", () => {
    const list = fakeList([5, 5, 5]);
    collapseList(asEl(list), 8);
    const b = button(list)!;
    let seen = "";
    b.addEventListener("click", () => (seen = b.getAttribute("aria-expanded") ?? ""));
    b.click();
    expect(games(list).some((g) => g.hidden)).toBe(false);
    expect(list.querySelectorAll("section.shelf").some((s) => s.hidden)).toBe(false);
    expect(button(list)).toBeNull();
  });

  it("sets aria-expanded to true before it removes the button", () => {
    const list = fakeList([5, 5, 5]);
    collapseList(asEl(list), 8);
    const b = button(list)!;
    const states: Array<string | null> = [];
    const rm = b.remove.bind(b);
    b.remove = () => {
      states.push(b.getAttribute("aria-expanded"));
      rm();
    };
    b.click();
    expect(states).toEqual(["true"]);
  });

  it("puts the button after the list, not inside it", () => {
    const list = fakeList([5, 5, 5]);
    collapseList(asEl(list), 8);
    expect(list.querySelector("button")).toBeNull();
    expect(list.parent!.kids.map((k) => k.tag)).toEqual(["ul", "button"]);
  });

  it("moves focus to the first new game's link on click", () => {
    const list = fakeList([5, 5, 5]);
    const g = games(list)[8]!;
    const a = new FakeEl("a");
    g.append(a);
    collapseList(asEl(list), 8);
    button(list)!.click();
    expect(focused).toBe(a);
  });

  it("focuses the game itself when it has no link", () => {
    const list = fakeList([5, 5, 5]);
    collapseList(asEl(list), 8);
    button(list)!.click();
    expect(focused).toBe(games(list)[8]);
    expect(games(list)[8]!.getAttribute("tabindex")).toBe("-1");
  });

  it("does nothing for a list that already fits", () => {
    const list = fakeList([4, 4]);
    collapseList(asEl(list), 8);
    expect(button(list)).toBeNull();
    expect(games(list).some((g) => g.hidden)).toBe(false);
  });
});

describe("bootGallery", () => {
  it("collapses on a phone", () => {
    stubDom(true);
    const list = fakeList([10, 10]);
    bootGallery(asEl(list));
    expect(button(list)!.textContent).toBe("Show all 20 games");
  });

  it("leaves a wide screen alone", () => {
    stubDom(false);
    const list = fakeList([10, 10]);
    bootGallery(asEl(list));
    expect(button(list)).toBeNull();
    expect(games(list).some((g) => g.hidden)).toBe(false);
  });

  it("opens the full list when the page loads on #games", () => {
    stubDom(true, "#games");
    const list = fakeList([10, 10]);
    bootGallery(asEl(list));
    expect(button(list)).toBeNull();
    expect(games(list).some((g) => g.hidden)).toBe(false);
    expect(focused).toBeNull();
  });

  it("opens the full list when the hero link jumps to #games", () => {
    const { win } = stubDom(true);
    const list = fakeList([10, 10]);
    bootGallery(asEl(list));
    (location as { hash: string }).hash = "#games";
    win.dispatchEvent(new Event("hashchange"));
    expect(button(list)).toBeNull();
    expect(games(list).some((g) => g.hidden)).toBe(false);
  });

  it("opens the list when the screen grows past a phone", () => {
    const { mq } = stubDom(true);
    const list = fakeList([10, 10]);
    bootGallery(asEl(list));
    mq.matches = false;
    mq.dispatchEvent(new Event("change"));
    expect(button(list)).toBeNull();
    expect(games(list).some((g) => g.hidden)).toBe(false);
  });
});
