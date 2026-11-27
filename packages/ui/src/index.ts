import type { RoomPublicState } from "@games/protocol";
import { h, type Child } from "./dom.ts";
import { faceColor, faceSvg } from "./faces.ts";

export { faceColor, faceSvg };
export { dieSvg, diePlural, DIE_NAMES, type DieOptions } from "./dice.ts";
export { keepInRow, rowScrollDelta, rowTarget, type RowMemo } from "./row.ts";
export { countdown, formatSeconds, type Countdown, type CountdownOptions } from "./countdown.ts";
export { cardFaces, isRedSuit, joinList, SUIT_NAME, SUIT_SYMBOL, type CardFaces, type FaceCard, type CardSuit, type RankText } from "./cards.ts";

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
  /** With a snapshot, the game's stream history (e.g. the drawing so far). */
  stream?: unknown;
}

export interface GameClientApi {
  /** Sends a game action; returns its clientActionId. */
  act(action: unknown): string;
  /** Sends ephemeral data (§35). No reply; the others get it via `GameView.stream`. */
  stream(data: unknown): void;
  /** The server's clock, give or take a round trip. For countdowns. */
  serverNow(): number;
  /**
   * Says it's this player's turn (`"Pick a word"`), or that it isn't (`null`).
   * Optional: by default the shell works it out from who the room is waiting
   * on. Call it when that doesn't tell the whole story; once called, the
   * game's word wins for the rest of the game.
   */
  setTurn(label: string | null): void;
}

export interface GameView extends View<GameViewProps> {
  /** The server rejected an action this view sent. `code` is the game's error code. */
  rejected(clientActionId: string, message: string, code?: string): void;
  /**
   * Resolves once the view has acted out everything it was given. The shell
   * waits on it before covering the table (e.g. with results), so the last
   * move isn't cut off mid-flight.
   */
  whenIdle?(): Promise<void>;
  /** Another player's ephemeral data, in order, after the update it follows. */
  stream?(from: string, data: unknown): void;
}

export interface GameClientModule {
  createView(api: GameClientApi): GameView;
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

export { h, replaceChildren } from "./dom.ts";

/** Seat name for a player id, for joining game projections with room state (§7). */
export function seatName(room: RoomPublicState, playerId: string | null | undefined): string {
  return room.seats.find((s) => s.id === playerId)?.name ?? "Someone";
}

/** The small "computer" tag for a computer player's seat row; null for a person. */
export function botTag(seat: { bot?: boolean } | undefined): HTMLElement | null {
  return seat?.bot ? h("span", { class: "tag bot-tag" }, "computer") : null;
}

/** A robot head, as a 24x24 line icon in the shell's icon style. */
const ROBOT_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 4.5V8"/><circle cx="12" cy="3.5" r="1.2" fill="currentColor" stroke="none"/>' +
  '<rect x="4" y="8" width="16" height="12" rx="3.5"/>' +
  '<circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>' +
  "</svg>";

/**
 * The small round robot badge for a computer player; null for a person.
 * Decorative (aria-hidden): say "(computer)" in the label of whatever holds it.
 * Put it on an avatar with `withBotBadge`.
 */
export function botBadge(seat: { bot?: boolean } | undefined): HTMLElement | null {
  if (!seat?.bot) return null;
  const el = h("span", { class: "bot-badge", title: "Computer", "aria-hidden": "true" });
  el.innerHTML = ROBOT_SVG;
  return el;
}

/**
 * Pins the robot badge to the avatar's bottom right, like a status dot, if the
 * seat is a computer player. Returns the avatar. Safe to call twice: an avatar
 * gets one badge at most.
 *
 * The badge CSS lives in the shell's stylesheet (apps/web/src/style.css), which
 * every game view gets. The ring around the badge takes `--bot-badge-ring`
 * (default `--surface`), so the badge reads as cut out of the chip. A game whose
 * lit or current chip has another background sets `--bot-badge-ring` on that
 * chip's `.bot-badge` in its own styles so the ring matches.
 */
export function withBotBadge(avatarEl: HTMLElement, seat: { bot?: boolean } | undefined): HTMLElement {
  if (avatarEl.querySelector(":scope > .bot-badge")) return avatarEl;
  const badge = botBadge(seat);
  if (badge) {
    avatarEl.classList.add("has-bot-badge");
    avatarEl.append(badge);
  }
  return avatarEl;
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

/**
 * Opens a modal <dialog> (focus trap and Esc for free) and removes it on close.
 * `title` can carry the close button's word (default "Got it").
 *
 * The dialog itself takes focus, not its first button: a long body (the rules)
 * then opens at the top, not scrolled down to the button. Tab goes on to the
 * button; Escape still closes.
 */
export function openDialog(title: string | { title: string; close?: string }, ...body: (Child | Child[])[]): HTMLDialogElement {
  const { title: name, close = "Got it" } = typeof title === "string" ? { title } : title;
  const dlg = h(
    "dialog",
    { class: "dialog", "aria-label": name, tabindex: -1 },
    h("h2", {}, name),
    h("div", { class: "dialog-body" }, ...body),
    h("form", { method: "dialog" }, h("button", { class: "primary" }, close)),
  );
  dlg.addEventListener("close", () => dlg.remove());
  closeOnBackdrop(dlg);
  document.body.append(dlg);
  dlg.showModal();
  // showModal puts focus on the first control, which can be far down.
  dlg.focus({ preventScroll: true });
  dlg.scrollTop = 0;
  return dlg;
}

export interface ConfirmOptions {
  /** The word on the yes button: says the action ("Restart", "Remove"). */
  ok: string;
  /** The word on the no button. Default "Cancel". */
  cancel?: string;
  /** The action can't be taken back: the yes button looks dangerous. */
  danger?: boolean;
}

/** The confirm on screen, if any. One at a time. */
let openConfirm: HTMLDialogElement | null = null;
let confirmCount = 0;

/**
 * Asks a yes or no question in the page, in place of `confirm()` (which some
 * in-app browsers block, and which freezes the page while it's up). Resolves
 * true for the yes button only: Cancel, Escape, a tap outside and
 * `cancelConfirm()` all give false. Focus starts on Cancel, so a stray Enter
 * does nothing harmful. A new question closes the one before (as a no).
 *
 * It sits on `document.body`, so a screen redraw leaves it alone. The caller
 * checks, when it resolves, that the action still makes sense.
 */
export function confirmDialog(text: string, opts: ConfirmOptions): Promise<boolean> {
  openConfirm?.close();
  return new Promise((resolve) => {
    let answer = false;
    const no = h("button", { type: "button", onclick: () => dlg.close() }, opts.cancel ?? "Cancel");
    const yes = h("button", {
      type: "button",
      class: opts.danger ? "danger" : "primary",
      onclick: () => {
        answer = true;
        dlg.close();
      },
    }, opts.ok);
    // Named by its question, so a screen reader reads it once.
    const id = `confirm-text-${++confirmCount}`;
    const dlg = h(
      "dialog",
      { class: "dialog confirm-dialog", role: "alertdialog", "aria-labelledby": id },
      h("p", { class: "confirm-text", id }, text),
      h("div", { class: "confirm-buttons" }, yes, no),
    );
    dlg.addEventListener("close", () => {
      if (openConfirm === dlg) openConfirm = null;
      dlg.remove();
      resolve(answer);
    });
    closeOnBackdrop(dlg);
    document.body.append(dlg);
    openConfirm = dlg;
    dlg.showModal();
    no.focus();
  });
}

/** Rewords the confirm on screen, if any (a detail in it changed). */
export function updateConfirm(text: string): void {
  const p = openConfirm?.querySelector(".confirm-text");
  if (p && p.textContent !== text) p.textContent = text;
}

/** Closes the confirm on screen, if any, as a no. For when its question no longer applies. */
export function cancelConfirm(): void {
  openConfirm?.close();
}

/**
 * A click on the backdrop closes a modal dialog. The dialog's own padding targets
 * the dialog too, so "clicked the dialog" isn't "clicked the backdrop": only a
 * point outside its box is. Keyboard clicks land on a button, never the dialog,
 * so the 0,0 they report can't get here.
 */
export function closeOnBackdrop(dlg: HTMLDialogElement): void {
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
}
