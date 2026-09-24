// Animation coordinator (§18–19). The server never waits on any of this: state
// arrives, and the queue decides how much of it to act out before showing it.

/** Global switch, e.g. the debug panel's "skip animations". */
export const motion = { enabled: true };

/** Animate only if the user hasn't asked for less motion and nothing's switched it off. */
export function motionAllowed(): boolean {
  if (!motion.enabled) return false;
  return !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export interface Batch {
  /** Acts out the events. Skipped when behind or when motion is off. */
  animate?: () => Promise<void>;
  /** Shows the settled state. Always runs, in order, unless the queue was cleared. */
  settle: () => void;
}

/**
 * Runs batches strictly in order: animate, then settle. If more than
 * `maxBacklog` batches are waiting (a backgrounded tab catching up), the ones
 * behind skip their animations and just settle, so the table is never stale for
 * long.
 */
export class AnimationQueue {
  private items: { batch: Batch; generation: number }[] = [];
  private running = false;
  private generation = 0;
  private readonly maxBacklog: number;

  constructor(maxBacklog = 3) {
    this.maxBacklog = maxBacklog;
  }

  push(batch: Batch): void {
    this.items.push({ batch, generation: this.generation });
    if (!this.running) void this.drain();
  }

  /** Drops everything pending; a batch mid-animation won't settle (§12: snapshots win). */
  clear(): void {
    this.items = [];
    this.generation++;
  }

  get pending(): number {
    return this.items.length + (this.running ? 1 : 0);
  }

  private idlers: (() => void)[] = [];

  /** Resolves once everything queued so far has animated and settled. */
  idle(): Promise<void> {
    if (!this.running && !this.items.length) return Promise.resolve();
    return new Promise((resolve) => this.idlers.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.items.length) {
      const { batch, generation } = this.items.shift()!;
      const behind = this.items.length >= this.maxBacklog;
      if (batch.animate && !behind && motionAllowed()) {
        try {
          await batch.animate();
        } catch {
          // A failed animation must never block the real state.
        }
      }
      if (generation === this.generation) batch.settle();
    }
    this.running = false;
    for (const resolve of this.idlers.splice(0)) resolve();
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Flies `ghost` from one rect to another in a fixed layer, using transforms
 * only (§18), then removes it. The ghost is sized to `to` and scaled at `from`.
 */
export async function fly(ghost: HTMLElement, from: DOMRect, to: DOMRect, duration = 320): Promise<void> {
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: "0",
    zIndex: "50",
    pointerEvents: "none",
    willChange: "transform",
  });
  document.body.append(ghost);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const s = Math.max(from.width / Math.max(to.width, 1), 0.2);
  try {
    await ghost.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${s}) rotate(-6deg)` },
        { transform: "translate3d(0, 0, 0) scale(1.12) rotate(0deg)", offset: 0.85 },
        { transform: "translate3d(0, 0, 0) scale(1)" },
      ],
      { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
    ).finished;
  } finally {
    ghost.remove();
  }
}

/** A short-lived bubble over an element ("Pass"), without moving layout. */
export async function bubble(anchor: Element, text: string, className = "anim-bubble", duration = 900): Promise<void> {
  const r = anchor.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    left: `${r.left + r.width / 2}px`,
    top: `${r.top}px`,
    zIndex: "50",
    pointerEvents: "none",
  });
  document.body.append(el);
  const anim = el.animate(
    [
      { transform: "translate(-50%, 0) scale(.6)", opacity: 0 },
      { transform: "translate(-50%, -110%) scale(1)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -130%) scale(1)", opacity: 1, offset: 0.75 },
      { transform: "translate(-50%, -150%) scale(.95)", opacity: 0 },
    ],
    { duration, easing: "ease-out" },
  );
  // Don't hold the queue for the whole fade; the next move can start under it.
  await wait(Math.min(duration * 0.55, 500));
  void anim.finished.finally(() => el.remove());
}
