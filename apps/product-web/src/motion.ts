// Small motion helpers for the product pages. Everything here is a
// courtesy: with reduced motion asked for, the change just happens.

const EASE = "cubic-bezier(.2, .8, .2, 1)";

function reduced(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs `fn` once any page transition has played out, right away if none is.
 * Arriving by link, the whole new page fades in (public/page-motion.css);
 * an entrance started under that fade is lost in it, so it waits its turn.
 */
export function whenSettled(fn: () => void): void {
  const vt = (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition;
  if (!vt) return fn();
  void vt.finished.then(fn, fn);
}

function shown(box: HTMLElement): Element[] {
  return [...box.children].filter((c) => !(c instanceof HTMLElement && c.hidden));
}

/**
 * Runs `change` on `box`, then eases the box from its old height to its new
 * one and fades up any child that wasn't showing before. Content that comes
 * in late (after a fetch) slides into place instead of shoving the page.
 */
export function morph(box: HTMLElement, change: () => void): void {
  whenSettled(() => morphNow(box, change));
}

function morphNow(box: HTMLElement, change: () => void): void {
  const before = new Set(shown(box));
  const from = box.getBoundingClientRect().height;
  change();
  if (reduced() || !box.isConnected) return;

  const to = box.getBoundingClientRect().height;
  if (Math.abs(to - from) > 0.5) {
    const overflow = box.style.overflow;
    box.style.overflow = "hidden";
    const a = box.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 220, easing: EASE });
    const done = () => void (box.style.overflow = overflow);
    a.onfinish = done;
    a.oncancel = done;
  }
  let i = 0;
  for (const kid of shown(box)) {
    if (before.has(kid)) continue;
    kid.animate(
      [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: 200, delay: 40 * i++, easing: EASE, fill: "backwards" },
    );
  }
}

/** Replaces `box`'s children the `morph` way. */
export function swapIn(box: HTMLElement, ...children: (Node | string)[]): void {
  morph(box, () => box.replaceChildren(...children));
}

/**
 * Sets a number's text with a little roll: the old value lifts out, the new
 * one rises in. `delay` staggers a row of them. Same text, nothing moves.
 */
export function rollText(el: HTMLElement, text: string, delay = 0): void {
  whenSettled(() => rollNow(el, text, delay));
}

function rollNow(el: HTMLElement, text: string, delay: number): void {
  if (el.textContent === text) return;
  if (reduced()) {
    el.textContent = text;
    return;
  }
  const out = el.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-35%)" }],
    { duration: 140, delay, easing: "ease-in", fill: "forwards" },
  );
  out.onfinish = () => {
    el.textContent = text;
    riseIn(el);
    out.cancel();
  };
}

/** Brings an element up from just below, faded out. */
export function riseIn(el: Element, delay = 0): void {
  if (reduced()) return;
  el.animate(
    [{ opacity: 0, transform: "translateY(35%)" }, { opacity: 1, transform: "none" }],
    { duration: 260, delay, easing: EASE, fill: "backwards" },
  );
}

/** Fades an element up from nothing, starting now. */
export function fadeIn(el: Element): void {
  if (reduced()) return;
  el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
}
