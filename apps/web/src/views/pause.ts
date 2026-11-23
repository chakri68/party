// The pause cover's lock: while the host has paused, keyboard, taps and
// screen readers can't reach the game under the cover. RoomView calls it on
// every render and again once a game view mounts (a reload, join or
// reconnect during a pause mounts the view after the cover).

/** Every child of the game host but `cover` is inert; with no cover, none is. */
export function lockGame(host: Element, cover: Element | null): void {
  for (const c of host.children) (c as HTMLElement).inert = cover !== null && c !== cover;
}
