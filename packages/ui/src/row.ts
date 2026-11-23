// A hand of cards is a row that scrolls sideways. When the hand changes, or the
// card to look at changes (the one you picked, or the first you can play), bring
// that card into the row's view. Only the row moves, never the page, and a swipe
// the player made is left alone until something changes.

/** How far to scroll a row so `item` is inside `view` with `pad` to spare. 0 when it already is. */
export function rowScrollDelta(view: { left: number; right: number }, item: { left: number; right: number }, pad = 8): number {
  const width = view.right - view.left;
  if (item.right - item.left + 2 * pad >= width) return item.left - pad - view.left; // too wide: show its start
  if (item.left < view.left + pad) return item.left - pad - view.left;
  if (item.right > view.right - pad) return item.right + pad - view.right;
  return 0;
}

const seen = new WeakMap<HTMLElement, { item: Element; kids: Element[] }>();

/**
 * Call after each render of the row with the card to show (or null). Scrolls
 * only when that card, or the row's cards, differ from the last call.
 */
export function keepInRow(row: HTMLElement, item: Element | null): void {
  if (!item || !row.isConnected || row.clientWidth === 0) return;
  const kids = [...row.children];
  const prev = seen.get(row);
  seen.set(row, { item, kids });
  if (prev && prev.item === item && prev.kids.length === kids.length && prev.kids.every((k, i) => k === kids[i])) return;
  const view = row.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  const delta = rowScrollDelta(view, box);
  if (!delta) return;
  let to = row.scrollLeft + delta;
  if (delta > 0 && getComputedStyle(row).scrollSnapType !== "none") {
    // The row snaps to card starts, and a snap back would hide the card's edge
    // again: stop at the first card start past the spot, which still shows it.
    const at = (el: Element) => el.getBoundingClientRect().left - view.left + row.scrollLeft;
    const starts = kids.map(at).filter((x) => x >= to - 1 && x <= at(item) + 1);
    if (starts.length) to = Math.min(...starts);
  }
  row.scrollLeft = to;
}
