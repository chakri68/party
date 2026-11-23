// A hand of cards is a row that scrolls sideways. Bring the card that matters
// into the row's view: a card the player just got or picked, or else (only when
// the hand itself changes, or it becomes their turn) the first one they can
// play. Only the row moves, never the page, and a swipe the player made is left
// alone until one of those things happens.

/** How far to scroll a row so `item` is inside `view` with `pad` to spare. 0 when it already is. */
export function rowScrollDelta(view: { left: number; right: number }, item: { left: number; right: number }, pad = 8): number {
  const width = view.right - view.left;
  if (item.right - item.left + 2 * pad >= width) return item.left - pad - view.left; // too wide: show its start
  if (item.left < view.left + pad) return item.left - pad - view.left;
  if (item.right > view.right - pad) return item.right + pad - view.right;
  return 0;
}

/** What a row showed last time: the explicit card, the fallback card, and the row's cards in order. */
export interface RowMemo<T> {
  explicit: T | null;
  fallback: T | null;
  kids: readonly T[];
}

/**
 * Which card to scroll to, or null to leave the row alone.
 * - A new explicit card (just picked, or just arrived): scroll to it.
 * - The row's cards changed: scroll to the explicit card, or else the fallback.
 * - No explicit card now or before, and the fallback changed (say, the turn
 *   came round and a card became playable): scroll to the fallback.
 * - Anything else, including dropping back from an explicit card to the
 *   fallback with the same cards (an unpick, or the update after new cards):
 *   leave it, so the row doesn't jump back.
 */
export function rowTarget<T>(prev: RowMemo<T> | undefined, next: RowMemo<T>): T | null {
  if (next.explicit && next.explicit !== prev?.explicit) return next.explicit;
  const sameKids = !!prev && prev.kids.length === next.kids.length && prev.kids.every((k, i) => k === next.kids[i]);
  if (!sameKids) return next.explicit ?? next.fallback;
  if (!next.explicit && !prev.explicit && next.fallback !== prev.fallback) return next.fallback;
  return null;
}

const seen = new WeakMap<HTMLElement, RowMemo<Element>>();

/**
 * Call after each render of the row. `explicit`: a card the player just got or
 * picked (or null). `fallback`: the card to show otherwise, like the first
 * playable one. See `rowTarget` for when it scrolls.
 */
export function keepInRow(row: HTMLElement, explicit: Element | null, fallback: Element | null): void {
  if (!row.isConnected || row.clientWidth === 0) return;
  const next: RowMemo<Element> = { explicit, fallback, kids: [...row.children] };
  const item = rowTarget(seen.get(row), next);
  seen.set(row, next);
  if (!item) return;
  const view = row.getBoundingClientRect();
  const delta = rowScrollDelta(view, item.getBoundingClientRect());
  if (!delta) return;
  let to = row.scrollLeft + delta;
  if (delta > 0 && getComputedStyle(row).scrollSnapType !== "none") {
    // The row snaps to card starts, and a snap back would hide the card's edge
    // again: stop at the first card start past the spot, which still shows it.
    const at = (el: Element) => el.getBoundingClientRect().left - view.left + row.scrollLeft;
    const starts = next.kids.map(at).filter((x) => x >= to - 1 && x <= at(item) + 1);
    if (starts.length) to = Math.min(...starts);
  }
  row.scrollLeft = to;
}
