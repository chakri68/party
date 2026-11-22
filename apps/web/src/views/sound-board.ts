// The sound board: a header button that opens a grid of short sounds. A tap
// goes to the room, and the room sends it to everyone (the sender too). What to
// show is `soundBoardModel` (tested); the class is DOM glue that keeps its
// elements and rebuilds the tiles only when the list changes. The cooldown is
// a CSS animation plus one timer per tap: nothing runs while nobody taps.

import type { ClientMessage, RoomPublicState } from "@games/protocol";
import { h } from "@games/ui";
import { icon } from "../brand.ts";
import type { SoundBoard } from "../sounds/board.ts";
import type { BoardSound } from "../sounds/packs.ts";

export interface BoardModel {
  button: boolean;
  hostSwitch: { label: "Sounds: on" | "Sounds: off"; pressed: boolean; message: ClientMessage } | null;
  tiles: { id: string; name: string }[];
  note: string | null;
}

export function soundBoardModel(room: RoomPublicState, me: string, sounds: readonly BoardSound[], playHere: boolean): BoardModel {
  const isHost = room.hostId === me;
  const on = room.sounds;
  let note: string | null = null;
  if (!on && isHost) note = "Sounds are off for everyone.";
  else if (!playHere) note = "Sounds are off on this phone. Turn them on in Settings.";
  else if (sounds.length === 0) note = "No sounds yet.";
  return {
    button: room.phase !== "ended" && (on || isHost),
    hostSwitch: isHost
      ? { label: on ? "Sounds: on" : "Sounds: off", pressed: on, message: { type: "room-sounds", on: !on } }
      : null,
    tiles: on ? sounds.map(({ id, name }) => ({ id, name })) : [],
    note,
  };
}

export interface SoundBoardViewOptions {
  send(msg: ClientMessage): void;
  toast(text: string): void;
  /** The phone's Sound board setting. */
  playHere(): boolean;
}

type BoardPart = Pick<SoundBoard<unknown>, "list" | "onChange" | "tap" | "coolingMs">;

export class SoundBoardView {
  readonly wrap = h("span", { class: "sound-wrap", hidden: true });

  private button = h("button", { type: "button", class: "icon-btn", "aria-label": "Sounds", "aria-expanded": "false" }, icon("sound-board"));
  private panel = h("div", { class: "sound-board", role: "group", "aria-label": "Sounds", hidden: true });
  private switchBtn = h("button", { type: "button", class: "sound-switch", "aria-pressed": "false" });
  private note = h("p", { class: "sound-note muted", hidden: true });
  private tiles = h("div", { class: "sound-tiles" });
  private cool = h("div", { class: "sound-cool", "aria-hidden": "true" });
  private board: BoardPart;
  private opts: SoundBoardViewOptions;
  private room: RoomPublicState | null = null;
  private me: string | null = null;
  /** The tile ids on screen, joined, so a render with the same list leaves the buttons alone. */
  private shown: string | null = null;
  private switchMessage: ClientMessage | null = null;
  private coolTimer: ReturnType<typeof setTimeout> | undefined;
  private offChange: () => void;

  constructor(board: BoardPart, opts: SoundBoardViewOptions) {
    this.board = board;
    this.opts = opts;
    this.switchBtn.addEventListener("click", () => {
      if (this.switchMessage) this.opts.send(this.switchMessage);
    });
    this.panel.append(this.switchBtn, this.note, this.tiles, this.cool);
    this.button.addEventListener("click", () => this.toggle());
    this.wrap.append(this.button, this.panel);
    this.wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.panel.hidden) {
        this.toggle(false);
        this.button.focus();
      }
    });
    document.addEventListener("pointerdown", this.onOutside);
    this.offChange = board.onChange(() => {
      this.shown = null;
      this.render(this.room, this.me);
    });
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  render(room: RoomPublicState | null, me: string | null): void {
    this.room = room;
    this.me = me;
    const model = room && me ? soundBoardModel(room, me, this.board.list(), this.opts.playHere()) : null;
    this.wrap.hidden = !model?.button;
    if (!model?.button) {
      this.toggle(false);
      return;
    }
    const sw = model.hostSwitch;
    this.switchBtn.hidden = !sw;
    this.switchMessage = sw?.message ?? null;
    if (sw) {
      this.switchBtn.textContent = sw.label;
      this.switchBtn.setAttribute("aria-pressed", String(sw.pressed));
    }
    this.note.hidden = !model.note;
    this.note.textContent = model.note ?? "";
    const key = model.tiles.map((t) => t.id).join(" ");
    this.tiles.hidden = this.cool.hidden = model.tiles.length === 0;
    if (key !== this.shown) {
      this.shown = key;
      this.tiles.replaceChildren(
        ...model.tiles.map((t) => h("button", { type: "button", onclick: () => this.tap(t.id) }, t.name)),
      );
    }
  }

  destroy(): void {
    clearTimeout(this.coolTimer);
    this.offChange();
    document.removeEventListener("pointerdown", this.onOutside);
  }

  private tap(id: string) {
    const result = this.board.tap(id);
    if (result === "cooling") return this.opts.toast("Wait a moment before the next sound.");
    if (result !== "sent") return;
    const ms = this.board.coolingMs();
    // On the panel, so both the grid and the bar under it read it.
    this.panel.style.setProperty("--cool", `${ms}ms`);
    this.tiles.classList.add("cooling");
    clearTimeout(this.coolTimer);
    this.coolTimer = setTimeout(() => this.tiles.classList.remove("cooling"), ms);
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.panel.hidden && !this.wrap.contains(e.target as Node)) this.toggle(false);
  };
}
