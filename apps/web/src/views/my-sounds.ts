// The "My sounds" screen: the host's 6 slots, with add, play, rename, replace
// and remove. Load it only with import(): it is the one file that pulls in the
// mp3 encoder (sounds/encode.ts). What it shows is my-sounds-model.ts (tested).

import "./my-sounds.css";
import { audio } from "@games/audio";
import { cleanSoundName, SOUND_NAME_MAX } from "@games/sounds/check";
import { h, replaceChildren } from "@games/ui";
import { decodeFile, encodeMp3 } from "../sounds/encode.ts";
import { type Library, type LibraryApi, type LibraryResult, resetMySounds, SAVE_FAILED } from "../sounds/library.ts";
import { checkInput, clipWindow, defaultName, HOST_CUT_S, NOT_A_SOUND, prepareClip, TOO_LONG, toMono } from "../sounds/process.ts";
import { type LibraryWrite, MY_SOUNDS_COPY as T, mySoundsModel, type SlotAction, type SlotRow, startLabel, writeLanded } from "./my-sounds-model.ts";

type Decoded = { channels: Float32Array[]; sampleRate: number };

/** What one row shows instead of its buttons. */
type Editing =
  | { kind: "pick"; slot: string; file: File; decoded: Decoded; name: string; start: number }
  | { kind: "rename"; slot: string; name: string }
  | { kind: "remove"; slot: string };

const ACTION_LABEL: Record<SlotAction, string> = { add: T.add, play: T.play, rename: T.rename, replace: T.replace, remove: T.remove };

/** Starts the context on this tap (iOS needs the tap) and waits for it to run. */
async function readyAudio(): Promise<AudioContext | null> {
  audio.unlock();
  const ctx = audio.context;
  if (!ctx) return null;
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  return ctx;
}

/** One dialog at a time: a double tap must not open two. */
let openNow = false;

/** Opens the dialog. Returns a function that closes it (for a view that goes away). */
export function openMySounds(opts: { api: LibraryApi; onClose?(): void }): () => void {
  if (openNow) return () => {};
  openNow = true;
  const { api } = opts;
  let lib: Library | null = null;
  let editing: Editing | null = null;
  /** A write, a file read or a decode is running: every other button waits. */
  let busy = false;
  let error: { slot: string | null; text: string } | null = null;
  /** Where focus goes after the next draw: the first of these that exists, else Close. */
  let focusTo: string[] | null = null;
  let closed = false;
  /** Saved files, decoded once. Keyed on the url, which names the version. */
  const clips = new Map<string, AudioBuffer>();

  const picker = h("input", { type: "file", accept: "audio/*", hidden: true, "aria-hidden": "true", tabindex: -1 });
  const body = h("div", { class: "my-sounds-body", "aria-busy": "true" });
  const close = h("button", { type: "button", class: "my-sounds-close" }, T.close);
  const dlg = h(
    "dialog",
    { class: "dialog my-sounds", "aria-label": T.title, tabindex: -1 },
    h(
      "div",
      { class: "my-sounds-inner" },
      h("div", { class: "my-sounds-head" }, h("h2", {}, T.title), close),
      h("p", { class: "muted my-sounds-intro" }, T.intro),
      body,
      picker,
    ),
  ) as HTMLDialogElement;
  close.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    closed = true;
    openNow = false;
    dlg.remove();
    opts.onClose?.();
  });

  const draw = () => {
    if (closed) return;
    if (!lib) {
      body.removeAttribute("aria-busy");
      replaceChildren(body, h("p", { class: "my-sounds-error", role: "alert" }, T.loadFailed));
      return;
    }
    const { notes, rows } = mySoundsModel(lib);
    body.toggleAttribute("aria-busy", busy);
    replaceChildren(
      body,
      notes.map((n) => h("p", { class: "my-sounds-note" }, n)),
      error && error.slot === null ? h("p", { class: "my-sounds-error", role: "alert" }, error.text) : null,
      h("ol", { class: "my-sounds-rows" }, rows.map(row)),
    );
    if (focusTo) {
      const to = focusTo.map((sel) => body.querySelector<HTMLElement>(sel)).find((el) => el && !el.hasAttribute("disabled"));
      (to ?? close).focus();
      focusTo = null;
    }
  };

  const errorLine = (slot: string) =>
    error && error.slot === slot ? h("p", { class: "my-sounds-error", role: "alert" }, error.text) : null;

  function row(r: SlotRow): HTMLElement {
    const e = editing && editing.slot === r.id ? editing : null;
    const title = r.name
      ? h("div", { class: "my-sounds-title" }, h("span", { class: "my-sounds-name" }, r.name), h("span", { class: "muted my-sounds-len" }, r.seconds))
      : null;
    let rest: (Node | null)[];
    if (e?.kind === "pick") rest = [pickPanel(e)];
    else if (e?.kind === "rename") rest = [renamePanel(e)];
    else if (e?.kind === "remove") rest = [removePanel(e)];
    else
      rest = [
        r.actions.length
          ? h(
              "div",
              { class: `my-sounds-actions${r.name ? "" : " empty"}` },
              r.actions.map((a) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: a === "remove" ? "danger" : "",
                    "data-act": a,
                    disabled: busy,
                    "aria-label": a === "add" ? `${T.add}, slot ${r.id}` : r.name ? `${ACTION_LABEL[a]}: ${r.name}` : undefined,
                    onclick: () => act(a, r),
                  },
                  ACTION_LABEL[a],
                ),
              ),
            )
          : null,
      ];
    return h(
      "li",
      { class: `my-sounds-row${r.name ? "" : " empty"}`, "data-slot": r.id },
      title,
      ...rest,
      errorLine(r.id),
    );
  }

  /** The Name field for a new sound or a rename: Enter saves. */
  function nameField(value: string, onInput: (v: string) => void, onEnter: () => void): HTMLElement {
    const input = h("input", { name: "sound-name", value, maxlength: SOUND_NAME_MAX, autocomplete: "off", "data-focus": "name" });
    input.addEventListener("input", () => onInput(input.value));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        onEnter();
      }
    });
    return h("label", { class: "field" }, h("span", {}, T.name), input);
  }

  function saveButton(onSave: () => void, label: string = T.save): HTMLButtonElement {
    return h(
      "button",
      { type: "button", class: label === T.remove ? "danger" : "primary", disabled: busy, "aria-busy": busy ? "true" : undefined, "data-act": "save", onclick: onSave },
      busy ? T.saving : label,
    );
  }

  function cancelButton(slot: string): HTMLButtonElement {
    return h("button", { type: "button", disabled: busy, onclick: () => cancel(slot) }, T.cancel);
  }

  function pickPanel(e: Extract<Editing, { kind: "pick" }>): HTMLElement {
    const lengthS = e.decoded.channels[0]!.length / e.decoded.sampleRate;
    const win = clipWindow(lengthS, e.start);
    let slider: HTMLElement | null = null;
    // A file only a hair too long is still cut, but a slider with no room to move is no use.
    if (win.cut && lengthS - HOST_CUT_S >= 0.1) {
      const label = h("span", {}, startLabel(win.start));
      const range = h("input", {
        type: "range",
        class: "my-sounds-start",
        min: 0,
        max: Math.floor((lengthS - HOST_CUT_S) * 10) / 10,
        step: 0.1,
        value: win.start,
        disabled: busy,
        "aria-valuetext": startLabel(win.start),
      });
      range.addEventListener("input", () => {
        e.start = clipWindow(lengthS, Number(range.value)).start;
        label.textContent = startLabel(e.start);
        range.setAttribute("aria-valuetext", startLabel(e.start));
      });
      slider = h("div", { class: "my-sounds-cut" }, h("p", { class: "my-sounds-note" }, TOO_LONG), h("label", { class: "field" }, label, range));
    }
    const play = h("button", { type: "button", disabled: busy, "data-act": "play", onclick: () => void playPicked(e) }, T.play);
    return h(
      "div",
      { class: "my-sounds-edit" },
      nameField(e.name, (v) => (e.name = v), () => void savePicked(e)),
      slider,
      h("div", { class: "my-sounds-buttons" }, play, saveButton(() => void savePicked(e)), cancelButton(e.slot)),
    );
  }

  function renamePanel(e: Extract<Editing, { kind: "rename" }>): HTMLElement {
    return h(
      "div",
      { class: "my-sounds-edit" },
      nameField(e.name, (v) => (e.name = v), () => void saveRename(e)),
      h("div", { class: "my-sounds-buttons" }, saveButton(() => void saveRename(e)), cancelButton(e.slot)),
    );
  }

  function removePanel(e: Extract<Editing, { kind: "remove" }>): HTMLElement {
    return h(
      "div",
      { class: "my-sounds-edit" },
      h("p", { class: "my-sounds-ask" }, T.removeAsk),
      h("div", { class: "my-sounds-buttons" }, saveButton(() => void saveRemove(e), T.remove), cancelButton(e.slot)),
    );
  }

  const slotSel = (slot: string, inner: string) => `[data-slot="${slot}"] ${inner}`;

  function cancel(slot: string) {
    editing = null;
    error = null;
    focusTo = [slotSel(slot, "button")];
    draw();
  }

  function act(a: SlotAction, r: SlotRow) {
    if (busy) return;
    error = null;
    if (a === "play") return void playSaved(r);
    if (a === "add" || a === "replace") {
      pickFor = r.id;
      picker.value = "";
      picker.click();
      return;
    }
    if (a === "rename") editing = { kind: "rename", slot: r.id, name: r.name ?? "" };
    else editing = { kind: "remove", slot: r.id };
    focusTo = [slotSel(r.id, a === "rename" ? "[data-focus=name]" : "[data-act=save]")];
    draw();
  }

  /** The slot the file picker is for. */
  let pickFor: string | null = null;
  picker.addEventListener("change", () => {
    const slot = pickFor;
    const file = picker.files?.[0];
    pickFor = null;
    if (!slot || !file) return;
    void readFile(slot, file);
  });

  async function readFile(slot: string, file: File) {
    const bad = checkInput(file);
    if (bad) {
      error = { slot, text: bad };
      focusTo = [slotSel(slot, "button")];
      return draw();
    }
    busy = true;
    draw();
    let decoded: Decoded | null = null;
    try {
      decoded = await decodeFile(await file.arrayBuffer());
    } catch {
      decoded = null;
    }
    busy = false;
    if (!decoded) {
      error = { slot, text: NOT_A_SOUND };
      focusTo = [slotSel(slot, "button")];
      return draw();
    }
    // Keep one mono channel: half the memory of stereo, and the decoded buffer can go.
    decoded = { channels: [toMono(decoded.channels)], sampleRate: decoded.sampleRate };
    editing = { kind: "pick", slot, file, decoded, name: defaultName(file.name), start: 0 };
    focusTo = [slotSel(slot, "[data-focus=name]")];
    draw();
  }

  /** A line in the row when nothing was heard. */
  function playLine(slot: string, text: string | null) {
    error = text ? { slot, text } : null;
    // The redraw makes new buttons: keep focus on Play.
    focusTo = [slotSel(slot, "[data-act=play]")];
    draw();
  }

  /** Plays on this phone, or says why not. */
  function playNow(slot: string, clip: AudioBuffer) {
    if (audio.playClip(clip)) {
      if (error?.slot === slot && (error.text === T.soundsOff || error.text === T.playFailed)) playLine(slot, null);
      return;
    }
    playLine(slot, T.soundsOff);
  }

  async function playPicked(e: Extract<Editing, { kind: "pick" }>) {
    const ctx = await readyAudio();
    const clip = prepareClip(e.decoded, e.start);
    if (!ctx || !clip.samples.length) return playLine(e.slot, T.playFailed);
    let buf: AudioBuffer;
    try {
      buf = ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
      buf.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
    } catch {
      return playLine(e.slot, T.playFailed);
    }
    playNow(e.slot, buf);
  }

  async function playSaved(r: SlotRow) {
    const slot = lib?.slots.find((s) => s.id === r.id);
    if (!slot) return;
    // Unlock on the tap itself, before any await.
    const ready = readyAudio();
    let clip = clips.get(slot.url);
    if (!clip) {
      const bytes = await api.bytes(slot.url);
      await ready;
      const decoded = bytes ? await audio.decode(bytes) : null;
      if (!decoded) return playLine(r.id, T.playFailed);
      clip = decoded;
      clips.set(slot.url, clip);
    }
    await ready;
    playNow(r.id, clip);
  }

  /** Runs one write; a 2xx with no list is checked against a fresh list. */
  async function write(w: LibraryWrite, run: () => Promise<LibraryResult>) {
    busy = true;
    error = null;
    draw();
    let res: LibraryResult;
    try {
      res = await run();
    } catch {
      res = { ok: false, error: SAVE_FAILED };
    }
    let next: Library | null = res.ok ? res.library : null;
    if (!res.ok) {
      // Any "no": read the list again. The write may have landed (a 2xx with no list),
      // a Pass may have lapsed, or another tab may have changed a slot.
      const fresh = await api.get().catch(() => null);
      if (fresh && res.refetch && writeLanded(w, lib, fresh)) next = fresh;
      else if (fresh) lib = fresh;
    }
    busy = false;
    if (next) {
      lib = next;
      editing = null;
      resetMySounds();
      // After a remove a lapsed row has no button: then Close.
      focusTo = [slotSel(w.slot, "button")];
      // A write that lands after the dialog closed: let the room list the sounds again.
      if (closed) opts.onClose?.();
    } else {
      error = { slot: w.slot, text: res.ok ? SAVE_FAILED : res.error };
      const slotNow = lib?.slots.some((s) => s.id === w.slot);
      // A lapsed Pass, or a slot another tab removed: that edit has nothing to save now.
      if (editing && ((editing.kind === "pick" && !lib?.active) || (editing.kind !== "pick" && !slotNow))) editing = null;
      focusTo = [slotSel(w.slot, "[data-act=save]"), slotSel(w.slot, "[data-focus=name]"), slotSel(w.slot, "button")];
    }
    draw();
  }

  async function savePicked(e: Extract<Editing, { kind: "pick" }>) {
    if (busy) return;
    const name = cleanSoundName(e.name);
    if (name === null) {
      error = { slot: e.slot, text: T.noName };
      focusTo = [slotSel(e.slot, "[data-focus=name]")];
      return draw();
    }
    await write({ kind: "save", slot: e.slot, name }, async () => api.save(e.slot, await encodeMp3(prepareClip(e.decoded, e.start)), name));
  }

  async function saveRename(e: Extract<Editing, { kind: "rename" }>) {
    if (busy) return;
    const name = cleanSoundName(e.name);
    if (name === null) {
      error = { slot: e.slot, text: T.noName };
      focusTo = [slotSel(e.slot, "[data-focus=name]")];
      return draw();
    }
    await write({ kind: "rename", slot: e.slot, name }, () => api.rename(e.slot, name));
  }

  async function saveRemove(e: Extract<Editing, { kind: "remove" }>) {
    if (busy) return;
    await write({ kind: "remove", slot: e.slot }, () => api.remove(e.slot));
  }

  document.body.append(dlg);
  dlg.showModal();
  // Start at the top, on the dialog: the first control can be far down.
  dlg.focus({ preventScroll: true });
  void api.get().then((got) => {
    lib = got;
    draw();
    if (!got) close.focus();
  });
  return () => {
    if (!closed) dlg.close();
  };
}
