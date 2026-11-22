import { describe, expect, it, vi } from "vitest";
import { isPttKey, PushToTalk } from "../../src/voice/ptt.ts";

/** A stand-in element: just what isPttKey reads. */
function el(
  tag: string,
  opts: { type?: string; readOnly?: boolean; attrs?: Record<string, string>; parent?: unknown } = {},
) {
  const attrs = opts.attrs ?? {};
  return {
    tagName: tag.toUpperCase(),
    type: opts.type ?? (tag === "input" ? "text" : undefined),
    readOnly: opts.readOnly ?? false,
    parentElement: opts.parent ?? null,
    hasAttribute: (name: string) => name in attrs,
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

const body = el("body");

function key(type: "keydown" | "keyup", k = " ", target: unknown = body, repeat = false) {
  return { type, key: k, repeat, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
}

/** Records listeners so a test can call them with plain objects. */
class FakeTarget {
  readonly listeners = new Map<string, { fn: (e: unknown) => void; capture: boolean }[]>();
  addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | AddEventListenerOptions) {
    const capture = opts === true || (typeof opts === "object" && !!opts.capture);
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn));
  }
  fire(e: { type: string }) {
    for (const l of this.listeners.get(e.type) ?? []) l.fn(e);
  }
  asTarget(): EventTarget {
    return this as unknown as EventTarget;
  }
}

function setup(enabled = true) {
  const held: boolean[] = [];
  const ptt = new PushToTalk((h) => held.push(h));
  ptt.enabled = enabled;
  const win = new FakeTarget();
  const detach = ptt.attach(win.asTarget());
  return { held, ptt, win, detach };
}

describe("isPttKey", () => {
  it("Space with nothing focused is push-to-talk", () => {
    expect(isPttKey({ key: " ", target: body })).toBe(true);
    expect(isPttKey({ key: " ", target: null })).toBe(true);
    expect(isPttKey({ key: "a", target: body })).toBe(false);
    expect(isPttKey({ key: "Enter", target: body })).toBe(false);
  });

  it("ignores Space while typing in an input or textarea", () => {
    expect(isPttKey({ key: " ", target: el("input") })).toBe(false);
    expect(isPttKey({ key: " ", target: el("input", { type: "search" }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("textarea") })).toBe(false);
    expect(isPttKey({ key: " ", target: el("div", { attrs: { contenteditable: "true" } }) })).toBe(false);
  });

  it("ignores Space on a button or a [tabindex] cell", () => {
    expect(isPttKey({ key: " ", target: el("button") })).toBe(false);
    expect(isPttKey({ key: " ", target: el("a", { attrs: { href: "x" } }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("select") })).toBe(false);
    expect(isPttKey({ key: " ", target: el("summary") })).toBe(false);
    expect(isPttKey({ key: " ", target: el("input", { type: "checkbox" }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("input", { type: "radio" }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("div", { attrs: { role: "button" } }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("div", { attrs: { tabindex: "0" } }) })).toBe(false);
    // A plain link (no href) is not pressed by Space; a focusable canvas is like any [tabindex].
    expect(isPttKey({ key: " ", target: el("a") })).toBe(true);
    expect(isPttKey({ key: " ", target: el("canvas", { attrs: { tabindex: "0" } }) })).toBe(false);
    // The icon inside a button is the button.
    expect(isPttKey({ key: " ", target: el("span", { parent: el("button") }) })).toBe(false);
    expect(isPttKey({ key: " ", target: el("div", { attrs: { contenteditable: "false" } }) })).toBe(true);
    expect(isPttKey({ key: " ", target: el("input", { readOnly: true }) })).toBe(false);
  });

  it("ignores Space with Ctrl, Alt or Meta held", () => {
    expect(isPttKey({ key: " ", ctrlKey: true, target: body })).toBe(false);
    expect(isPttKey({ key: " ", altKey: true, target: body })).toBe(false);
    expect(isPttKey({ key: " ", metaKey: true, target: body })).toBe(false);
    const { held, win } = setup();
    const down = { ...key("keydown"), ctrlKey: true };
    win.fire(down);
    expect(held).toEqual([]);
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores key repeat", () => {
    expect(isPttKey({ key: " ", repeat: true, target: body })).toBe(false);
    const { held, win } = setup();
    win.fire(key("keydown", " ", body, true));
    expect(held).toEqual([]);
  });
});

describe("PushToTalk", () => {
  it("does nothing while not enabled", () => {
    const { held, win } = setup(false);
    const down = key("keydown");
    win.fire(down);
    win.fire(key("keyup"));
    expect(held).toEqual([]);
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(down.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("holds on keydown, releases on keyup", () => {
    const { held, win } = setup();
    win.fire(key("keydown"));
    // A repeat while held changes nothing.
    win.fire(key("keydown", " ", body, true));
    expect(held).toEqual([true]);
    win.fire(key("keyup"));
    expect(held).toEqual([true, false]);
  });

  it("listens in the capture phase", () => {
    const { win } = setup();
    expect(win.listeners.get("keydown")?.[0]?.capture).toBe(true);
    expect(win.listeners.get("keyup")?.[0]?.capture).toBe(true);
  });

  it("stops the key reaching the game", () => {
    const { win } = setup();
    const down = key("keydown");
    const repeat = key("keydown", " ", body, true);
    const up = key("keyup");
    win.fire(down);
    win.fire(repeat);
    win.fire(up);
    for (const e of [down, repeat, up]) {
      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopImmediatePropagation).toHaveBeenCalled();
    }
    // Space typed in chat reaches the box.
    const typed = key("keydown", " ", el("textarea"));
    const typedUp = key("keyup", " ", el("textarea"));
    win.fire(typed);
    win.fire(typedUp);
    expect(typed.preventDefault).not.toHaveBeenCalled();
    expect(typedUp.preventDefault).not.toHaveBeenCalled();
    // Other keys pass.
    const other = key("keydown", "a");
    win.fire(other);
    expect(other.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("releases on blur and when the tab is hidden", () => {
    const { held, win } = setup();
    win.fire(key("keydown"));
    win.fire({ type: "blur" });
    expect(held).toEqual([true, false]);
    win.fire(key("keydown"));
    win.fire({ type: "visibilitychange" });
    expect(held).toEqual([true, false, true, false]);
  });

  it("with Space off, Space passes to the game and the mic button still holds", () => {
    const { held, ptt, win } = setup();
    ptt.spaceEnabled = false;
    const down = key("keydown");
    const up = key("keyup");
    win.fire(down);
    win.fire(up);
    expect(held).toEqual([]);
    for (const e of [down, up]) {
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    }
    ptt.press();
    expect(held).toEqual([true]);
    ptt.release();
    expect(held).toEqual([true, false]);
    // Turning Space off while it is held lets go.
    ptt.spaceEnabled = true;
    win.fire(key("keydown"));
    expect(held).toEqual([true, false, true]);
    ptt.spaceEnabled = false;
    expect(held).toEqual([true, false, true, false]);
    const late = key("keyup");
    win.fire(late);
    expect(late.preventDefault).not.toHaveBeenCalled();
  });

  it("the mic button holds on press and releases on release", () => {
    const { held, ptt } = setup();
    ptt.press();
    ptt.press();
    expect(held).toEqual([true]);
    ptt.release();
    expect(held).toEqual([true, false]);
  });

  it("turning it off, detaching or destroying releases and stops listening", () => {
    const { held, ptt, win, detach } = setup();
    ptt.press();
    ptt.enabled = false;
    expect(held).toEqual([true, false]);
    ptt.enabled = true;
    detach();
    win.fire(key("keydown"));
    expect(held).toEqual([true, false]);
    const other = new FakeTarget();
    ptt.attach(other.asTarget());
    other.fire(key("keydown"));
    expect(held).toEqual([true, false, true]);
    ptt.destroy();
    expect(held).toEqual([true, false, true, false]);
    other.fire(key("keydown"));
    ptt.press();
    expect(held).toEqual([true, false, true, false]);
  });
});
