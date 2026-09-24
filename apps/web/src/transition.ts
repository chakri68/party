// Page-level motion via the View Transitions API: the browser snapshots the
// page, we swap the DOM, and it animates old → new. CSS picks the animation
// from `html[data-vt]` (see style.css, "Page transitions").
//
// Why a data attribute and not the API's `types`: engines that shipped view
// transitions before `types` throw on the options form, and the attribute
// works in all of them.

import { motionAllowed } from "@games/animation";

/**
 * "forward"/"back": moving between pages. "phase": the room changes screen
 * (lobby → game → results). "lobby": same screen, new data; only named
 * blocks move.
 */
export type TransitionKind = "forward" | "back" | "phase" | "lobby";

type Update = () => void | Promise<void>;

let running = false;
let waiting: { kind: TransitionKind; update: Update } | null = null;

/** Whether `transition` would animate right now, rather than just run the update. */
export function canTransition(): boolean {
  return !!document.startViewTransition && motionAllowed() && document.visibilityState === "visible";
}

/**
 * Runs `update` inside a view transition, or just runs it: no API, reduced
 * motion, or animations switched off in the debug panel. `update` may be
 * async; the new state is captured once it settles.
 *
 * Starting a view transition cuts off the one playing, so they queue: one
 * plays, at most one waits. If another comes along, the waiting one is
 * applied on the spot, unanimated, so a burst of updates can't build a
 * backlog of animations.
 */
export function transition(kind: TransitionKind, update: Update): void {
  if (!canTransition()) {
    void update();
    return;
  }
  if (running) {
    if (waiting) void waiting.update();
    waiting = { kind, update };
    return;
  }
  running = true;
  const root = document.documentElement;
  root.dataset.vt = kind;
  const vt = document.startViewTransition(update);
  void vt.finished.finally(() => {
    running = false;
    delete root.dataset.vt;
    const next = waiting;
    waiting = null;
    if (next) transition(next.kind, next.update);
  });
}
