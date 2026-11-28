import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardFaces, isRedSuit, SUIT_SYMBOL, withCardSizes, type FaceCard } from "../src/cards.ts";
import { joinList } from "../src/text.ts";

/** Just enough DOM for `h`: the tests run in Node. */
class FakeEl {
  attrs = new Map<string, string>();
  children: (FakeEl | string)[] = [];
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener() {}
  append(...kids: (FakeEl | string)[]) {
    this.children.push(...kids);
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  get kids(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => typeof c !== "string");
  }
}

const g = globalThis as unknown as { document?: unknown; Node?: unknown };
beforeEach(() => {
  g.Node = FakeEl;
  g.document = { createElement: (tag: string) => new FakeEl(tag) };
});
afterEach(() => {
  delete g.document;
  delete g.Node;
});

// Two games' ranks: Ace high (14) and Ace low (1).
const HIGH: Record<number, [string, string]> = { 14: ["A", "Ace"], 13: ["K", "King"], 12: ["Q", "Queen"], 11: ["J", "Jack"], 10: ["10", "Ten"], 2: ["2", "Two"] };
const LOW: Record<number, [string, string]> = { 1: ["A", "Ace"], 13: ["K", "King"], 9: ["9", "Nine"] };
const high = cardFaces<number>({ short: (r) => HIGH[r]![0], name: (r) => HIGH[r]![1] });
const low = cardFaces<number>({ short: (r) => LOW[r]![0], name: (r) => LOW[r]![1] });

const el = (n: Node) => n as unknown as FakeEl;
const cls = (n: Node) => el(n).getAttribute("class");

describe("suits", () => {
  it("ask for text presentation, so no platform draws an emoji", () => {
    for (const s of Object.values(SUIT_SYMBOL)) expect(s.endsWith("︎")).toBe(true);
  });
  it("hearts and diamonds are red", () => {
    expect(["spades", "hearts", "diamonds", "clubs"].map((s) => isRedSuit(s as never))).toEqual([false, true, true, false]);
  });
});

describe("text", () => {
  it("names a card with the game's own ranks", () => {
    expect(high.label({ suit: "spades", rank: 14 })).toBe("Ace of Spades");
    expect(low.label({ suit: "hearts", rank: 1 })).toBe("Ace of Hearts");
    expect(high.short({ suit: "diamonds", rank: 10 })).toBe("10♦︎");
  });
  it("lists cards with commas and a last 'and'", () => {
    const cards: FaceCard<number>[] = [{ suit: "spades", rank: 14 }, { suit: "hearts", rank: 2 }, { suit: "clubs", rank: 10 }];
    expect(high.list(cards)).toBe("Ace of Spades, Two of Hearts and Ten of Clubs");
    expect(high.list(cards.slice(0, 1))).toBe("Ace of Spades");
    expect(joinList([])).toBe("");
    expect(joinList(["A", "B"])).toBe("A and B");
  });
});

describe("faces", () => {
  it("are an image with the card's name, two corners and a middle", () => {
    const f = el(high.face({ suit: "hearts", rank: 2, id: "hearts-2" }));
    expect(f.tagName).toBe("span");
    expect(cls(f as never)).toBe("pcard red");
    expect(f.getAttribute("role")).toBe("img");
    expect(f.getAttribute("aria-label")).toBe("Two of Hearts");
    expect(f.getAttribute("data-card")).toBe("hearts-2");
    expect(f.kids.map((k) => k.getAttribute("class"))).toEqual(["corner tl", "pip", "corner br"]);
    expect(f.kids.every((k) => k.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(f.kids[0]!.textContent).toBe("2♥︎");
    expect(f.kids[1]!.textContent).toBe("♥︎");
  });
  it("show a letter in the middle for J, Q and K, but a suit for an Ace, high or low", () => {
    const pip = (faces: typeof high, rank: number) => el(faces.face({ suit: "spades", rank })).kids[1]!;
    for (const r of [11, 12, 13]) expect(pip(high, r).getAttribute("class")).toBe("pip face");
    expect(pip(high, 13).textContent).toBe("K");
    expect(pip(high, 14).getAttribute("class")).toBe("pip");
    expect(pip(low, 1).getAttribute("class")).toBe("pip");
    expect(pip(low, 13).getAttribute("class")).toBe("pip face");
  });
  it("leave out data-card for a card with no id", () => {
    expect(el(high.face({ suit: "clubs", rank: 10 })).getAttribute("data-card")).toBeNull();
    expect(cls(high.face({ suit: "clubs", rank: 10 }))).toBe("pcard");
  });
  it("are a button in a hand, named for a screen reader", () => {
    const b = el(high.handCard({ suit: "diamonds", rank: 12, id: "diamonds-Q" }));
    expect(b.tagName).toBe("button");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("class")).toBe("pcard red");
    expect(b.getAttribute("aria-label")).toBe("Queen of Diamonds");
    expect(b.getAttribute("data-card")).toBe("diamonds-Q");
    expect(b.kids).toHaveLength(3);
  });
});

describe("minis, backs and slots", () => {
  it("a mini is rank over suit", () => {
    const m = el(low.mini({ suit: "diamonds", rank: 9, id: "diamonds-9" }));
    expect(m.getAttribute("class")).toBe("pcard-mini red");
    expect(m.getAttribute("aria-label")).toBe("Nine of Diamonds");
    expect(m.kids.map((k) => `${k.tagName}:${k.textContent}`)).toEqual(["b:9", "i:♦︎"]);
  });
  it("backs are decorative unless named", () => {
    const plain = el(high.back());
    expect(plain.getAttribute("class")).toBe("pcard back");
    expect(plain.getAttribute("aria-hidden")).toBe("true");
    expect(plain.getAttribute("role")).toBeNull();
    const named = el(high.back({ label: "Face-down card" }));
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Face-down card");
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(cls(high.miniBack())).toBe("pcard-mini back");
    expect(cls(high.tinyBack())).toBe("pcard-tiny");
    expect(el(high.tinyBack()).getAttribute("aria-hidden")).toBe("true");
    expect(cls(high.slot())).toBe("pcard slot");
  });
});

describe("animation ghosts", () => {
  it("take the card sizes set where they stand in for a card, and nothing else", () => {
    const set = new Map<string, string>();
    const ghost = { style: { setProperty: (k: string, v: string) => set.set(k, v) } } as unknown as HTMLElement;
    const values: Record<string, string> = { "--pcard-corner": " 1.1rem", "--pcard-pip": "2.4rem", "--pcard-mini-ratio": "5 / 7", "--other": "1px" };
    const g = globalThis as unknown as { getComputedStyle?: unknown };
    g.getComputedStyle = () => ({ getPropertyValue: (k: string) => values[k] ?? "" });
    try {
      expect(withCardSizes(ghost, {} as Element)).toBe(ghost);
    } finally {
      delete g.getComputedStyle;
    }
    expect(Object.fromEntries(set)).toEqual({ "--pcard-corner": "1.1rem", "--pcard-pip": "2.4rem", "--pcard-mini-ratio": "5 / 7" });
  });
});
