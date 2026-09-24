import type { RoomPublicState } from "@games/protocol";
import { faceSvg } from "./faces.ts";

export { faceSvg };

// ---------------------------------------------------------------------------
// View lifecycle (§9)
// ---------------------------------------------------------------------------

export interface View<TProps = void> {
  mount(container: HTMLElement): void;
  update(props: TProps): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Client half of the game plugin contract
// ---------------------------------------------------------------------------

export interface GameViewProps {
  room: RoomPublicState;
  /** The game's public projection (`room.game`), typed by the game. */
  game: unknown;
  /** This player's private projection. */
  private: unknown;
  playerId: string;
  /** Events that produced this state; drive animations, never settled UI (§7). */
  events: unknown[];
  /** A full resync (reconnect): drop queued animations and show this as-is (§12). */
  snapshot: boolean;
}

export interface GameClientApi {
  /** Sends a game action; returns its clientActionId. */
  act(action: unknown): string;
}

export interface GameView extends View<GameViewProps> {
  /** The server rejected an action this view sent. */
  rejected(clientActionId: string, message: string): void;
}

export interface GameClientModule {
  createView(api: GameClientApi): GameView;
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false;

/**
 * `h("button", { class: "x", onclick: fn }, "Play")`. Keys starting with `on`
 * become listeners; `false`/`null`/`undefined` attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Replaces an element's children in one go. */
export function replaceChildren(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren(
    ...children.flat().filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : String(c))),
  );
}

/** Seat name for a player id, for joining game projections with room state (§7). */
export function seatName(room: RoomPublicState, playerId: string | null | undefined): string {
  return room.seats.find((s) => s.id === playerId)?.name ?? "Someone";
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * A generated face from the player's seed (the name, if there's no seed).
 * Decorative: the name next to it carries the meaning.
 */
export function avatar(name: string, seed: string, size: "sm" | "md" | "lg" = "md"): HTMLElement {
  const el = h("span", { class: `avatar avatar-${size}`, "aria-hidden": "true" });
  el.innerHTML = faceSvg(seed || name);
  return el;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/** Opens a modal <dialog> (focus trap and Esc for free) and removes it on close. */
export function openDialog(title: string, ...body: (Child | Child[])[]): HTMLDialogElement {
  const dlg = h(
    "dialog",
    { class: "dialog", "aria-label": title },
    h("h2", {}, title),
    h("div", { class: "dialog-body" }, ...body),
    h("form", { method: "dialog" }, h("button", { class: "primary" }, "Got it")),
  );
  dlg.addEventListener("close", () => dlg.remove());
  // Click on the backdrop closes it too.
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
