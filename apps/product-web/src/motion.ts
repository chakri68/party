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
  const vt =
    (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition ??
    // Set by public/page-motion.js from pagereveal, for browsers without the property.
    (window as Window & { __pageTransition?: ViewTransition | null }).__pageTransition;
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
  // A first fill has nothing to roll out: set it now, so whatever measures
  // the layout next (morph) sees the real height.
  if (reduced() || !el.textContent) {
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
    [{ opacity: 0, transform: "translateY(60%) scale(0.96)" }, { opacity: 1, transform: "none" }],
    { duration: 420, delay, easing: EASE, fill: "backwards" },
  );
}

/** Fades an element up from nothing, starting now. */
export function fadeIn(el: Element): void {
  if (reduced()) return;
  el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
}

/** A progress fill growing out from its left edge to the width it was given. */
export function growBar(el: HTMLElement): void {
  if (reduced()) return;
  el.animate([{ transform: "scaleX(0)" }, { transform: "none" }], { duration: 700, delay: 120, easing: EASE, fill: "backwards" });
}

/**
 * Makes `<details>` open and close with a slide instead of a snap. The
 * summary click is taken over: the height eases between the summary alone
 * and the whole thing, and `open` flips at the right end (set first when
 * opening, so the answer is there to slide into; cleared last when closing,
 * so it stays visible while it slides away). Clicking again mid-way turns
 * it around from wherever it is. Without JS or with reduced motion, the
 * browser's own snap is still there.
 */
export function slideDetails(root: ParentNode = document): void {
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details")) {
    const summary = d.querySelector("summary");
    if (!summary) continue;
    let anim: Animation | null = null;
    let want = d.open;

    summary.addEventListener("click", (e) => {
      if (reduced()) return;
      e.preventDefault();
      const from = d.getBoundingClientRect().height;
      if (anim) {
        anim.onfinish = null;
        anim.cancel();
      }
      want = !want;
      d.classList.toggle("closing", !want);
      if (want) d.open = true;
      // Closed height: the summary plus the details' own borders.
      const to = want ? d.getBoundingClientRect().height : summary.getBoundingClientRect().height + (d.offsetHeight - d.clientHeight);
      d.style.overflow = "hidden";
      anim = d.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: want ? 280 : 220, easing: EASE });
      if (want) {
        for (const kid of d.children) {
          if (kid === summary) continue;
          kid.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 40, easing: EASE, fill: "backwards" });
        }
      }
      anim.onfinish = () => {
        if (!want) d.open = false;
        d.classList.remove("closing");
        d.style.overflow = "";
        anim = null;
      };
    });
  }
}
