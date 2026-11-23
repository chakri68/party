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
  // Named lobby blocks animate on a layer above the whole page, top-layer
  // dialogs included: with a modal open they'd flash over it on every join.
  // The modal keeps its own content current, so the update just lands.
  if (!canTransition() || (kind === "lobby" && document.querySelector("dialog[open]"))) {
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
  // The browser skips a transition when the viewport changes size mid-way (a
  // phone turned sideways), the tab is hidden, or the update takes too long:
  // `ready` rejects, the update still lands, only the animation is lost.
  // Catch exactly that; anything else stays an error.
  vt.ready.catch(rethrowUnlessSkip);
  void vt.finished.finally(() => {
    running = false;
    delete root.dataset.vt;
    const next = waiting;
    waiting = null;
    if (next) transition(next.kind, next.update);
  });
}

/** The rejection a skipped view transition gives: the DOM change landed, the animation didn't. */
export function isSkip(e: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    e instanceof DOMException &&
    (e.name === "InvalidStateError" || e.name === "AbortError" || e.name === "TimeoutError")
  );
}

/** For `ready`'s rejection: a skip is fine, anything else is thrown on so it still shows. */
export function rethrowUnlessSkip(e: unknown): void {
  if (!isSkip(e)) throw e;
}
