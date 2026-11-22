// Push-to-talk: hold Space, or hold the mic button. Space counts only when
// nothing that takes Space is focused, so typing in chat and pressing game
// buttons work as before. A Space we take never reaches the game.

import { isTyping } from "../keyboard.ts";

interface ElementLike {
  tagName?: unknown;
  parentElement?: unknown;
  hasAttribute?(name: string): boolean;
  getAttribute?(name: string): string | null;
}

/**
 * Something Space presses or types into: button, a[href], select, summary,
 * any input, textarea, [role=button], contenteditable, or [tabindex]. A canvas
 * with a tabindex is a game surface, not a control. Read by tag and attribute,
 * not instanceof, so it works for elements inside an iframe too.
 */
function takesSpace(el: ElementLike): boolean {
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (["BUTTON", "SELECT", "SUMMARY", "INPUT", "TEXTAREA"].includes(tag)) return true;
  const has = (name: string) => el.hasAttribute?.(name) ?? false;
  if (tag === "A" && has("href")) return true;
  if (el.getAttribute?.("role") === "button") return true;
  if (has("contenteditable") && el.getAttribute?.("contenteditable") !== "false") return true;
  return tag !== "CANVAS" && has("tabindex");
}

/** Space, not a repeat, not while typing, not on something Space presses (button, a[href], select, summary, checkbox, radio, [role=button], [tabindex]). */
export function isPttKey(e: { key: string; repeat?: boolean; target: unknown }): boolean {
  if (e.key !== " " || e.repeat) return false;
  if (isTyping(e.target)) return false;
  // Walk up: the icon inside a button is the button.
  for (let n: unknown = e.target, depth = 0; n && typeof n === "object" && depth < 50; n = (n as ElementLike).parentElement, depth++) {
    if (takesSpace(n as ElementLike)) return false;
  }
  return true;
}

interface KeyEventLike {
  key: string;
  repeat?: boolean;
  target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

export class PushToTalk {
  private on = false;
  private keyHeld = false;
  private buttonHeld = false;
  private held = false;
  private destroyed = false;
  private readonly detachers = new Set<() => void>();
  private readonly onHeld: (held: boolean) => void;

  constructor(onHeld: (held: boolean) => void) {
    this.onHeld = onHeld;
  }

  /** True only in "ptt" mode. Turning it off lets go. */
  get enabled(): boolean {
    return this.on;
  }
  set enabled(v: boolean) {
    this.on = v;
    if (!v) this.release();
  }

  /** keydown and keyup in capture on that window; a PTT key gets preventDefault and stopImmediatePropagation, so the game never sees it. blur releases. */
  attach(target: EventTarget): () => void {
    if (this.destroyed) return () => {};
    const swallow = (e: KeyEventLike) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const down = (ev: Event) => {
      const e = ev as unknown as KeyEventLike;
      if (!this.on || e.key !== " ") return;
      // Repeats while held are ours too, or the page would scroll.
      if (this.keyHeld) return swallow(e);
      if (!isPttKey(e)) return;
      swallow(e);
      this.keyHeld = true;
      this.update();
    };
    const up = (ev: Event) => {
      const e = ev as unknown as KeyEventLike;
      if (e.key !== " " || !this.keyHeld) return;
      swallow(e);
      this.keyHeld = false;
      this.update();
    };
    const letGo = () => this.release();
    target.addEventListener("keydown", down, true);
    target.addEventListener("keyup", up, true);
    target.addEventListener("blur", letGo);
    // Fired at the document; it bubbles to the window.
    target.addEventListener("visibilitychange", letGo);
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      this.detachers.delete(detach);
      try {
        target.removeEventListener("keydown", down, true);
        target.removeEventListener("keyup", up, true);
        target.removeEventListener("blur", letGo);
        target.removeEventListener("visibilitychange", letGo);
      } catch {
        // A window that is gone.
      }
    };
    this.detachers.add(detach);
    return detach;
  }

  /** Attaches to every same-origin iframe under root, now and as they come, and again on each iframe load. DOM glue, not unit tested. */
  watchFrames(root: Element): () => void {
    const frames = new Map<HTMLIFrameElement, { onLoad: () => void; detach: () => void }>();
    const hookWindow = (frame: HTMLIFrameElement): (() => void) => {
      try {
        const win = frame.contentWindow;
        // Reading the document throws for another origin: nothing to do there.
        if (!win || !win.document) return () => {};
        return this.attach(win);
      } catch {
        return () => {};
      }
    };
    const add = (frame: HTMLIFrameElement) => {
      if (frames.has(frame)) return;
      const entry = {
        detach: hookWindow(frame),
        onLoad: () => {
          entry.detach();
          entry.detach = hookWindow(frame);
        },
      };
      frame.addEventListener("load", entry.onLoad);
      frames.set(frame, entry);
    };
    const remove = (frame: HTMLIFrameElement) => {
      const entry = frames.get(frame);
      if (!entry) return;
      frame.removeEventListener("load", entry.onLoad);
      entry.detach();
      frames.delete(frame);
    };
    const framesIn = (node: Node): HTMLIFrameElement[] => {
      if (!(node instanceof Element)) return [];
      const found = [...node.querySelectorAll("iframe")];
      if (node instanceof HTMLIFrameElement) found.push(node);
      return found;
    };
    for (const f of framesIn(root)) add(f);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) for (const f of framesIn(n)) add(f);
        for (const n of r.removedNodes) for (const f of framesIn(n)) if (!root.contains(f)) remove(f);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const f of [...frames.keys()]) remove(f);
    };
  }

  /** The mic button: pointerdown. */
  press(): void {
    if (!this.on || this.destroyed) return;
    this.buttonHeld = true;
    this.update();
  }

  /** The mic button let go (pointerup, pointercancel, pointerleave), and any other let-go: blur, hidden tab, game unmount. */
  release(): void {
    this.keyHeld = false;
    this.buttonHeld = false;
    this.update();
  }

  destroy(): void {
    this.release();
    this.destroyed = true;
    for (const detach of [...this.detachers]) detach();
  }

  private update(): void {
    const held = this.keyHeld || this.buttonHeld;
    if (held === this.held) return;
    this.held = held;
    try {
      this.onHeld(held);
    } catch {
      // Voice trouble never reaches the game.
    }
  }
}
