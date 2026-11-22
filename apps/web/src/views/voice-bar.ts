// The voice bar: a compact row in games (mic, hear no one, who is speaking,
// the connection dot), and the full panel with everyone in voice in the lobby
// and on results. Lives as long as RoomView, outside the game host, so game
// switches never touch it. What to show is `voiceBarModel` (tested); the class
// is DOM glue that keeps its elements and only updates them, so a held talk
// button or a dragged slider is never swapped out under the finger.

import type { RoomPhase } from "@games/protocol";
import { closeOnBackdrop, h, openDialog } from "@games/ui";
import { icon, type IconName } from "../brand.ts";
import { MAX_GAIN } from "../voice/audio.ts";
import type { VoicePrefs } from "../voice/prefs.ts";
import type { PushToTalk } from "../voice/ptt.ts";
import type { VoiceController, VoiceMemberView, VoiceView } from "../voice/voice.ts";

export interface BarModel {
  show: "hidden" | "join" | "bar";
  /** The Join voice button (false where voice cannot work). */
  canJoin: boolean;
  /** hold: push-to-talk, hold to talk. pressed: muted, or held. */
  micButton: { label: string; pressed: boolean; hold: boolean };
  /** One line under the controls. */
  note: string | null;
  /** Read out when it changes. Not the push-to-talk hint, which changes on every press. */
  noteLive: boolean;
  /**
   * In a game: the note line is always there, one line high, even when empty,
   * so a talk press or a Mute never moves the game below.
   */
  keepNoteRow: boolean;
  /** The button that opens everyone in voice. */
  peopleLabel: string;
  tapSound: boolean;
  tapMic: boolean;
  speakingIds: string[];
  /** good: in voice and every link is up. */
  connection: "good" | "wait";
}

const inVoice = (v: VoiceView) => v.status === "on" || v.status === "joining";

/** Push-to-talk listens only in "ptt" mode while in voice; otherwise Space stays the page's. */
export function pttEnabled(v: VoiceView): boolean {
  return v.mode === "ptt" && inVoice(v);
}

/** `space`: Space is the talk key here (a keyboard, and no game on screen that uses Space). */
export function voiceBarModel(v: VoiceView, phase: RoomPhase, space = false): BarModel {
  const joined = inVoice(v);
  const live = v.mic === "on" || v.mic === "muted";
  const hold = live && v.mic === "on" && v.mode === "ptt";
  const micButton = !live
    ? { label: "Turn on mic", pressed: false, hold: false }
    : v.mic === "muted"
      ? { label: "Unmute", pressed: true, hold: false }
      : hold
        ? { label: "Talk", pressed: v.pttHeld, hold: true }
        : { label: "Mute", pressed: false, hold: false };

  let show: BarModel["show"];
  if (phase === "ended") show = "hidden";
  else if (joined) show = "bar";
  // Not worth a line in the middle of a game.
  else if (v.status === "unsupported") show = phase === "playing" ? "hidden" : "join";
  else show = "join";

  let note: string | null = null;
  if (v.status === "unsupported") note = "Voice does not work in this browser.";
  else if (v.status === "full") note = "Voice is full.";
  else if (!joined) note = null;
  else if (!live) note = "Your mic is off";
  else if (v.mic === "muted") note = "Muted: your mic is still on. Tap Turn off mic to stop it.";
  else if (v.status === "joining") note = "Connecting voice...";
  let hint = false;
  if (note === null && hold) {
    note = v.pttHeld ? "Talking" : space ? "Hold Space to talk" : "Hold to talk";
    hint = true;
  }
  // In a game and out of voice: only the small Join voice button.
  if (phase === "playing" && show === "join") note = null;

  return {
    show,
    canJoin: v.status !== "unsupported",
    micButton,
    note: show === "hidden" ? null : note,
    noteLive: show !== "hidden" && note !== null && !hint,
    keepNoteRow: show === "bar" && phase === "playing",
    peopleLabel: `People in voice (${v.members.length})`,
    tapSound: joined && v.needsSoundTap,
    tapMic: joined && v.needsMicTap,
    speakingIds: joined ? v.members.filter((m) => m.speaking).map((m) => m.id) : [],
    connection: v.status === "on" && v.members.every((m) => m.self || m.link === "connected") ? "good" : "wait",
  };
}

/** A join may start: the Join voice button is still up, and the bar is not destroyed. */
export function joinAllowed(model: BarModel | null, destroyed: boolean): boolean {
  return !destroyed && model?.show === "join" && model.canJoin;
}

/** The "Join voice" explainer. When the browser blocks the mic, it says how to allow it. */
export function joinLines(permission: "granted" | "denied" | "prompt" | "unknown"): string[] {
  return [
    "Talk with the room while you play.",
    permission === "denied"
      ? "Your browser blocks the mic for this site. To talk, allow the mic in the browser settings."
      : "Your browser will ask to use the mic.",
    "No one records your voice.",
  ];
}

/** No key pressed in voice controls reaches the game. */
function keepKeys(el: HTMLElement): void {
  const stop = (e: Event) => e.stopPropagation();
  el.addEventListener("keydown", stop);
  el.addEventListener("keyup", stop);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

interface Row {
  li: HTMLLIElement;
  dot: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  volume: HTMLInputElement | null;
  block: HTMLButtonElement | null;
}

export class VoiceBar {
  readonly el = h("section", { class: "voice-bar", "aria-label": "Voice", hidden: true });

  private readonly voice: VoiceController;
  private readonly ptt: PushToTalk;
  private readonly nameOf: (id: string) => string;
  private readonly coarse: boolean;
  private phase: RoomPhase | null = null;
  private model: BarModel | null = null;
  /** The talk button is held by this pointer or key. */
  private holding = false;
  /** The join explainer is up, or being decided on. */
  private asking = false;
  private destroyed = false;
  private panelDialog: HTMLDialogElement | null = null;
  private readonly dialogs = new Set<HTMLDialogElement>();
  private readonly unsubscribe: () => void;

  private readonly join = h("button", { type: "button", class: "voice-join" }, icon("mic"), "Join voice");
  private readonly micIcon = h("span", { class: "voice-mic-icon" });
  /** Hidden on narrow phones; the button keeps its aria-label. */
  private readonly micLabel = h("span", { class: "voice-mic-label", "aria-hidden": "true" });
  private readonly mic = h("button", { type: "button", class: "voice-mic" }, this.micIcon, this.micLabel);
  private readonly deafen = h("button", { type: "button", class: "icon-btn voice-deafen" });
  private readonly speaking = h("span", { class: "voice-speaking" });
  private readonly dot = h("span", { class: "voice-dot", role: "img" });
  private readonly settingsButton = h("button", { type: "button", class: "icon-btn", "aria-label": "Voice settings" }, icon("settings"));
  /** In a game: the dots. In the lobby and on results: a line with the count. */
  private readonly panelButton = h("button", { type: "button", class: "icon-btn voice-more", "aria-label": "People in voice" }, icon("more"));
  private readonly peopleButton = h("button", { type: "button", class: "voice-people-button" });
  private readonly controls = h(
    "div",
    { class: "voice-controls" },
    this.mic,
    this.deafen,
    this.speaking,
    this.dot,
    this.settingsButton,
    this.panelButton,
  );
  private readonly tapSound = h("button", { type: "button", class: "primary" }, "Tap to turn on sound");
  private readonly tapMic = h("button", { type: "button", class: "primary" }, "Tap to talk again.");
  private readonly taps = h("div", { class: "voice-taps" }, this.tapSound, this.tapMic);
  private readonly note = h("p", { class: "voice-note muted" });
  /** The live region: only notes that matter are read out. */
  private readonly announce = h("span", { class: "sr-only", role: "status" });
  private readonly turnOff = h("button", { type: "button" }, "Turn off mic");
  private readonly leave = h("button", { type: "button", class: "link" }, "Leave voice");
  private readonly people = h("ul", { class: "voice-people" });
  private readonly rows = new Map<string, Row>();
  /** Only ever shown in its dialog (openPanel). */
  private readonly panel = h("div", { class: "voice-panel" }, h("div", { class: "voice-actions" }, this.turnOff, this.leave), this.people);

  constructor(voice: VoiceController, ptt: PushToTalk, nameOf: (id: string) => string) {
    this.voice = voice;
    this.ptt = ptt;
    this.nameOf = nameOf;
    this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.el.append(this.join, this.controls, this.taps, this.note, this.peopleButton, this.announce);
    keepKeys(this.el);

    this.join.addEventListener("click", () => void this.startJoin());
    this.wireMic();
    this.deafen.addEventListener("click", () => this.voice.setDeafened(!this.voice.view().deafened));
    this.settingsButton.addEventListener("click", () => this.openSettings());
    this.panelButton.addEventListener("click", () => this.openPanel());
    this.peopleButton.addEventListener("click", () => this.openPanel());
    this.tapSound.addEventListener("click", () => this.voice.resumeSound());
    this.tapMic.addEventListener("click", () => void this.voice.turnOnMic());
    this.turnOff.addEventListener("click", () => this.voice.turnOffMic());
    this.leave.addEventListener("click", () => this.voice.leave());

    this.unsubscribe = voice.subscribe(() => this.sync());
  }

  /** The room's phase; null for screens outside a room (a fatal message). */
  render(phase: RoomPhase | null): void {
    this.phase = phase;
    this.sync();
  }

  /** Space as the talk key, off while a game that uses Space is on screen. */
  setSpaceKey(on: boolean): void {
    if (this.ptt.spaceEnabled === on) return;
    this.ptt.spaceEnabled = on;
    this.sync();
  }

  /** Everyone in voice, with volumes and Mute for me, in a dialog. */
  openPanel(): void {
    if (this.panelDialog || this.model?.show !== "bar") return;
    const dlg = this.dialog("Voice", this.panel);
    this.panelDialog = dlg;
    dlg.addEventListener("close", () => {
      this.panelDialog = null;
      this.panel.remove();
    });
    this.sync();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.letGo();
    for (const d of [...this.dialogs]) d.close();
    this.el.remove();
  }

  // ---- drawing ----

  private sync(): void {
    const v = this.voice.view();
    this.ptt.enabled = pttEnabled(v);
    const m = (this.model = voiceBarModel(v, this.phase ?? "ended", !this.coarse && this.ptt.spaceEnabled));
    // The hold button turned into something else (muted, mode change): let go.
    if (!m.micButton.hold) this.letGo();

    this.el.hidden = m.show === "hidden";
    this.el.dataset.layout = this.phase === "playing" ? "compact" : "panel";
    this.el.dataset.show = m.show;
    this.join.hidden = m.show !== "join" || !m.canJoin;
    this.controls.hidden = m.show !== "bar";
    this.tapSound.hidden = !m.tapSound;
    this.tapMic.hidden = !m.tapMic;
    this.taps.hidden = !m.tapSound && !m.tapMic;
    this.note.hidden = m.note === null && !m.keepNoteRow;
    setText(this.note, m.note ?? "");
    const spoken = m.noteLive ? (m.note ?? "") : "";
    setText(this.announce, spoken);
    // Out of the room (fatal, party over): nothing voice stays open, so no late tap turns the mic on.
    if (m.show === "hidden") for (const d of [...this.dialogs]) d.close();
    else if (m.show !== "bar") this.panelDialog?.close();
    this.panelButton.hidden = this.phase !== "playing";
    this.peopleButton.hidden = m.show !== "bar" || this.phase === "playing";
    setText(this.peopleButton, m.peopleLabel);

    // The mic: a toggle, or the talk button in push-to-talk. "Tap to talk again." stands in for it.
    this.mic.hidden = m.tapMic;
    const b = m.micButton;
    setText(this.micLabel, b.label);
    if (this.mic.getAttribute("aria-label") !== b.label) this.mic.setAttribute("aria-label", b.label);
    const micIcon: IconName = v.mic === "on" ? "mic" : "mic-off";
    if (this.micIcon.dataset.icon !== micIcon) {
      this.micIcon.dataset.icon = micIcon;
      this.micIcon.replaceChildren(icon(micIcon));
    }
    this.mic.classList.toggle("hold", b.hold);
    this.mic.classList.toggle("pressed", b.pressed);
    this.mic.classList.toggle("talking", v.talking);
    if (b.hold) this.mic.setAttribute("aria-pressed", String(b.pressed));
    else this.mic.removeAttribute("aria-pressed");

    const deafLabel = v.deafened ? "Hear everyone" : "Hear no one";
    if (this.deafen.getAttribute("aria-label") !== deafLabel) {
      this.deafen.setAttribute("aria-label", deafLabel);
      this.deafen.replaceChildren(icon(v.deafened ? "headphones-off" : "headphones"));
    }
    this.deafen.classList.toggle("pressed", v.deafened);

    const names = m.speakingIds.map((id) => this.nameOf(id));
    setText(this.speaking, names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
    this.speaking.classList.toggle("on", names.length > 0);
    this.dot.dataset.state = m.connection;
    this.dot.setAttribute("aria-label", m.connection === "good" ? "Voice is on" : "Connecting voice...");

    this.turnOff.hidden = !(v.mic === "on" || v.mic === "muted");
    this.syncPeople(v);
  }

  private syncPeople(v: VoiceView): void {
    const ids = new Set(v.members.map((m) => m.id));
    for (const [id, row] of this.rows) {
      if (ids.has(id)) continue;
      row.li.remove();
      this.rows.delete(id);
    }
    let at: ChildNode | null = this.people.firstChild;
    for (const m of v.members) {
      const row = this.rows.get(m.id) ?? this.newRow(m);
      if (row.li !== at) this.people.insertBefore(row.li, at);
      else at = at.nextSibling;
      this.syncRow(row, m);
    }
  }

  private newRow(m: VoiceMemberView): Row {
    const self = m.self;
    const dot = h("span", { class: "voice-person-dot", "aria-hidden": "true" });
    const name = h("span", { class: "name" });
    const state = h("span", { class: "muted voice-person-state" });
    let volume: HTMLInputElement | null = null;
    let block: HTMLButtonElement | null = null;
    if (!self) {
      volume = h("input", { type: "range", min: 0, max: MAX_GAIN, step: 0.05, class: "voice-volume" });
      // Saved on change, not on every step of a drag.
      volume.addEventListener("change", () => this.voice.setVolume(m.id, Number(volume!.value)));
      block = h("button", { type: "button", class: "small" });
      block.addEventListener("click", () => this.voice.setBlocked(m.id, !this.voice.view().members.find((x) => x.id === m.id)?.blocked));
    }
    const li = h("li", { class: "voice-person" }, dot, name, state, volume, block);
    const row = { li, dot, name, state, volume, block };
    this.rows.set(m.id, row);
    return row;
  }

  private syncRow(row: Row, m: VoiceMemberView): void {
    const name = this.nameOf(m.id);
    setText(row.name, m.self ? `${name} (you)` : name);
    row.li.classList.toggle("speaking", m.speaking);
    const state = m.link === "reconnecting" ? "Trying to connect..." : m.hostMuted || m.selfMuted ? "muted" : "";
    setText(row.state, state);
    if (row.volume) {
      row.volume.setAttribute("aria-label", `Volume for ${name}`);
      // Not while it's being moved.
      if (document.activeElement !== row.volume) row.volume.value = String(m.volume);
    }
    if (row.block) {
      setText(row.block, m.blocked ? "Unmute for me" : "Mute for me");
      row.block.setAttribute("aria-pressed", String(m.blocked));
    }
  }

  // ---- the mic button ----

  private wireMic(): void {
    const hold = () => this.model?.micButton.hold === true;
    this.mic.addEventListener("click", () => {
      if (hold()) return;
      const v = this.voice.view();
      if (v.mic === "on") this.voice.setMuted(true);
      else if (v.mic === "muted") this.voice.setMuted(false);
      else void this.voice.turnOnMic();
    });
    this.mic.addEventListener("pointerdown", (e) => {
      if (!hold() || e.button !== 0) return;
      try {
        this.mic.setPointerCapture(e.pointerId);
      } catch {
        // Not every browser; the let-go events below still come.
      }
      this.press();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) this.mic.addEventListener(type, () => this.letGo());
    // A long press must not open the text menu.
    this.mic.addEventListener("contextmenu", (e) => hold() && e.preventDefault());
    // By keyboard: hold Space or Enter on the button.
    this.mic.addEventListener("keydown", (e) => {
      if (!hold() || (e.key !== " " && e.key !== "Enter")) return;
      e.preventDefault();
      if (!e.repeat) this.press();
    });
    this.mic.addEventListener("keyup", (e) => {
      // Only a hold we started: a plain toggle clicks on Space keyup.
      if (!this.holding || (e.key !== " " && e.key !== "Enter")) return;
      e.preventDefault();
      this.letGo();
    });
    this.mic.addEventListener("blur", () => this.letGo());
  }

  private press(): void {
    this.holding = true;
    this.ptt.press();
  }

  private letGo(): void {
    if (!this.holding) return;
    this.holding = false;
    this.ptt.release();
  }

  // ---- dialogs ----

  private dialog(title: string, ...body: Node[]): HTMLDialogElement {
    const dlg = h(
      "dialog",
      { class: "dialog voice-dialog", "aria-label": title },
      h("h2", {}, title),
      ...body,
      h("form", { method: "dialog" }, h("button", {}, "Close")),
    );
    this.track(dlg);
    closeOnBackdrop(dlg);
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  private track(dlg: HTMLDialogElement): void {
    keepKeys(dlg);
    this.dialogs.add(dlg);
    dlg.addEventListener("close", () => {
      this.dialogs.delete(dlg);
      dlg.remove();
    });
  }

  /** The explainer, unless the browser already allows the mic. */
  private async startJoin(): Promise<void> {
    if (this.asking || !joinAllowed(this.model, this.destroyed)) return;
    this.asking = true;
    const permission = await this.voice.micPermission();
    // The party ended, a fatal came or the room went away while we asked.
    if (!joinAllowed(this.model, this.destroyed)) {
      this.asking = false;
      return;
    }
    if (permission === "granted") {
      this.asking = false;
      return void this.voice.join(true);
    }
    const pick = (withMic: boolean) => {
      dlg.close();
      if (joinAllowed(this.model, this.destroyed)) void this.voice.join(withMic);
    };
    const dlg = h(
      "dialog",
      { class: "dialog voice-dialog", "aria-label": "Join voice" },
      h("h2", {}, "Join voice"),
      joinLines(permission).map((line) => h("p", {}, line)),
      h(
        "div",
        { class: "dialog-list" },
        h("button", { type: "button", class: "primary", onclick: () => pick(true) }, icon("mic"), "Turn on mic"),
        h("button", { type: "button", onclick: () => pick(false) }, icon("headphones"), "Listen only"),
      ),
      h("form", { method: "dialog" }, h("button", { class: "link" }, "Cancel")),
    );
    this.track(dlg);
    dlg.addEventListener("close", () => (this.asking = false));
    closeOnBackdrop(dlg);
    document.body.append(dlg);
    dlg.showModal();
  }

  private openSettings(): void {
    const p = this.voice.settings();
    const v = this.voice.view();
    const set = (patch: Partial<VoicePrefs>) => void this.voice.updatePrefs(patch);

    const check = (label: string, checked: boolean, onChange: (on: boolean) => void, disabled = false) => {
      const input = h("input", { type: "checkbox", checked, disabled });
      input.addEventListener("change", () => onChange(input.checked));
      return h("label", {}, label, input);
    };
    const devices = (kind: "audioinput" | "audiooutput", selected: string | null, fallback: string, onChange: (id: string | null) => void) => {
      const select = h("select", { class: "voice-device" }, h("option", { value: "" }, "Default"));
      select.addEventListener("change", () => onChange(select.value || null));
      // Names show only after the mic was allowed once; until then, numbers.
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          list
            .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default")
            .forEach((d, i) => select.append(h("option", { value: d.deviceId, selected: d.deviceId === selected }, d.label || `${fallback} ${i + 1}`)));
        })
        .catch(() => {});
      return select;
    };
    const micSelect = devices("audioinput", p.micDeviceId, "Mic", (id) => set({ micDeviceId: id }));
    const speakerSelect = v.canPickOutput ? devices("audiooutput", p.outputDeviceId, "Speaker", (id) => set({ outputDeviceId: id })) : null;

    const dlg = openDialog(
      "Voice settings",
      h(
        "div",
        { class: "settings voice-settings" },
        h("label", {}, "Mic", micSelect),
        speakerSelect ? h("label", {}, "Speaker", speakerSelect) : null,
        check("Remove echo", p.echoCancellation, (on) => set({ echoCancellation: on })),
        check("Remove background noise", p.noiseSuppression, (on) => set({ noiseSuppression: on })),
        check("Keep my mic volume steady", p.autoGainControl, (on) => set({ autoGainControl: on })),
        check("Push to talk", p.mode === "ptt", (on) => set({ mode: on ? "ptt" : "open" })),
        check("Hear no one also mutes my mic", p.deafenAlsoMutes, (on) => set({ deafenAlsoMutes: on })),
        check("Hide my network address", p.relayOnly, (on) => set({ relayOnly: on }), !v.hasTurn),
        v.hasTurn ? null : h("p", { class: "muted setting-hint" }, "Needs a relay server."),
        h("p", { class: "muted" }, "The settings stay on your device."),
      ),
    );
    this.track(dlg);
  }
}
