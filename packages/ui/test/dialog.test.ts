import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelConfirm, confirmDialog, openDialog, updateConfirm } from "../src/index.ts";

/**
 * Just enough DOM for the dialogs: the tests run in Node. A real browser fires
 * "close" a little later; firing it at once is fine for the promise wiring.
 */
class FakeEl extends EventTarget {
  attrs = new Map<string, string>();
  children: (FakeEl | string)[] = [];
  parent: FakeEl | null = null;
  open = false;
  scrollTop = 40;
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  append(...kids: (FakeEl | string)[]) {
    for (const k of kids) {
      if (typeof k !== "string") k.parent = this;
      this.children.push(k);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(t: string) {
    this.children = [t];
  }
  /** Only ".class" selectors. */
  querySelector(sel: string): FakeEl | null {
    const cls = sel.slice(1);
    for (const c of this.children) {
      if (typeof c === "string") continue;
      if ((c.getAttribute("class") ?? "").split(" ").includes(cls)) return c;
      const deep = c.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
  focus() {
    fake.active = this;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
  getBoundingClientRect() {
    return { left: 0, right: 100, top: 0, bottom: 100 };
  }
  all(tag: string): FakeEl[] {
    return this.children.flatMap((c) => (typeof c === "string" ? [] : [...(c.tagName === tag ? [c] : []), ...c.all(tag)]));
  }
}

const fake = { body: new FakeEl("body"), active: null as FakeEl | null };
const g = globalThis as unknown as { document?: unknown; Node?: unknown };

beforeEach(() => {
  fake.body = new FakeEl("body");
  fake.active = null;
  g.Node = FakeEl;
  g.document = { body: fake.body, createElement: (tag: string) => new FakeEl(tag) };
});
afterEach(() => {
  cancelConfirm();
  delete g.document;
  delete g.Node;
});

const dialogs = () => fake.body.all("dialog");
const button = (dlg: FakeEl, text: string) => dlg.all("button").find((b) => b.textContent === text)!;

describe("confirmDialog", () => {
  it("says yes only for the action button, then goes away", async () => {
    const answer = confirmDialog("Restart this game for everyone?", { ok: "Restart", danger: true });
    const [dlg] = dialogs();
    expect(dlg.textContent).toContain("Restart this game for everyone?");
    expect(button(dlg, "Restart").getAttribute("class")).toBe("danger");
    button(dlg, "Restart").click();
    await expect(answer).resolves.toBe(true);
    expect(dialogs()).toEqual([]);
  });

  it("starts on Cancel, and Cancel says no", async () => {
    const answer = confirmDialog("Remove Ben?", { ok: "Remove" });
    const [dlg] = dialogs();
    expect(fake.active?.textContent).toBe("Cancel");
    button(dlg, "Cancel").click();
    await expect(answer).resolves.toBe(false);
  });

  it("Escape (the dialog closing by itself) says no", async () => {
    const answer = confirmDialog("Leave?", { ok: "Leave", cancel: "Stay" });
    const [dlg] = dialogs();
    expect(button(dlg, "Stay")).toBeTruthy();
    dlg.close();
    await expect(answer).resolves.toBe(false);
  });

  it("a tap outside says no", async () => {
    const answer = confirmDialog("Leave?", { ok: "Leave" });
    const [dlg] = dialogs();
    dlg.dispatchEvent(Object.assign(new Event("click"), { clientX: 200, clientY: 200 }));
    // The event's target is the dialog itself: EventTarget sets it on dispatch.
    await expect(answer).resolves.toBe(false);
  });

  it("one at a time: a new question closes the old one as a no", async () => {
    const first = confirmDialog("One?", { ok: "Yes" });
    const second = confirmDialog("Two?", { ok: "Yes" });
    await expect(first).resolves.toBe(false);
    expect(dialogs()).toHaveLength(1);
    cancelConfirm();
    await expect(second).resolves.toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("is named by its question once, and can be reworded in place", async () => {
    const answer = confirmDialog("Leave the room? Ben will be the host.", { ok: "Leave" });
    const [dlg] = dialogs();
    const text = dlg.querySelector(".confirm-text")!;
    expect(dlg.getAttribute("aria-label")).toBeNull();
    expect(dlg.getAttribute("aria-labelledby")).toBe(text.getAttribute("id"));
    updateConfirm("Leave the room? Cat will be the host.");
    expect(text.textContent).toBe("Leave the room? Cat will be the host.");
    expect(dialogs()).toHaveLength(1);
    cancelConfirm();
    await expect(answer).resolves.toBe(false);
  });
});

describe("openDialog", () => {
  it("focuses the dialog itself, at the top, not its button", () => {
    const dlg = openDialog("How to play", "Long rules") as unknown as FakeEl;
    expect(fake.active).toBe(dlg);
    expect(dlg.scrollTop).toBe(0);
    expect(button(dlg, "Got it")).toBeTruthy();
  });

  it("takes its own close word", () => {
    const dlg = openDialog({ title: "Sound and vibration", close: "Done" }) as unknown as FakeEl;
    expect(dlg.getAttribute("aria-label")).toBe("Sound and vibration");
    expect(button(dlg, "Done")).toBeTruthy();
  });
});
