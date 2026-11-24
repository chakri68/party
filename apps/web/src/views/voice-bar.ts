// Room voice on screen. On every room screen there is no voice row: in voice
// the mic sits in the room header (`headerMic`); Join voice and the Voice
// panel (everyone in voice, Hear no one, Voice settings) open from the Room
// menu. A row shows only for the tap prompts. Lives as long as RoomView,
// outside the game host, so game switches never touch it. What to show is
// `voiceBarModel` (tested); the class is DOM glue that keeps its elements and
// only updates them, so a held talk button or a dragged slider is never
// swapped out under the finger.

import type { ClientMessage, RoomPhase } from "@games/protocol";
import { closeOnBackdrop, h, openDialog } from "@games/ui";
import { icon, type IconName } from "../brand.ts";
import { MAX_GAIN } from "../voice/audio.ts";
import { focusPhase } from "./focus.ts";
import type { VoicePrefs } from "../voice/prefs.ts";
import type { PushToTalk } from "../voice/ptt.ts";
import type { VoiceController, VoiceMemberView, VoiceView } from "../voice/voice.ts";

export interface BarModel {
  /** header: on a room screen and in voice; the mic is in the room header. */
  show: "hidden" | "header";
  /** hold: push-to-talk, hold to talk. pressed: muted, or held. */
  micButton: { label: string; pressed: boolean; hold: boolean };
  /** The mic button's accessible name: the label, and the note, as there is no note line. */
  micName: string;
  /** The room menu's voice item (voiceMenuItem). Null off the room screens (party over). */
  menu: "join" | "voice" | "unsupported" | null;
  /** What the live region reads out: the note in the mic name. Never the push-to-talk hint. */
  spoken: string;
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

/** The room menu's voice item: Join voice, the Voice panel, or (unsupported) a line saying voice does not work here. */
export function voiceMenuItem(v: VoiceView): "join" | "voice" | "unsupported" {
  if (inVoice(v)) return "voice";
  // Full keeps Join voice, so a player can try again: someone may have left.
  return v.status === "unsupported" ? "unsupported" : "join";
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

  const focus = focusPhase(phase);
  // No voice row: in voice, the mic is in the header; out of voice, Join voice is in the room menu.
  const show: BarModel["show"] = focus && joined ? "header" : "hidden";

  // There is no Turn off mic next to the mic, and the name must not change on every press.
  let note: string | null = null;
  let hint = false;
  const hostMuted = v.members.some((m) => m.self && m.hostMuted);
  if (show === "header") {
    if (!live) note = "Your mic is off.";
    else if (hostMuted) note = "The host muted you.";
    else if (v.mic === "muted") note = "Muted: your mic is still on.";
    else if (v.status === "joining") note = "Connecting voice...";
    else if (hold) {
      note = space ? "Hold Space to talk." : "Hold to talk.";
      hint = true;
    }
  }

  return {
    show,
    micButton,
    micName: note ? `${micButton.label}. ${note}` : micButton.label,
    menu: focus ? voiceMenuItem(v) : null,
    spoken: hint ? "" : (note ?? ""),
    tapSound: joined && v.needsSoundTap,
    tapMic: joined && v.needsMicTap,
    speakingIds: joined ? v.members.filter((m) => m.speaking).map((m) => m.id) : [],
    connection: v.status === "on" && v.members.every((m) => m.self || m.link === "connected") ? "good" : "wait",
  };
}

/** The host's button on another person's row in the Voice panel: Mute, or Allow to talk. Null for myself or a non-host. */
export function hostVoiceAction(m: VoiceMemberView, isHost: boolean): { label: "Mute" | "Allow to talk"; message: ClientMessage } | null {
  if (!isHost || m.self) return null;
  return m.hostMuted
    ? { label: "Allow to talk", message: { type: "host-mute", playerId: m.id, muted: false } }
    : { label: "Mute", message: { type: "host-mute", playerId: m.id, muted: true } };
}

/** What the Voice panel can ask of the room: am I the host, and send a message. */
export interface VoiceHost {
  isHost(): boolean;
  send(msg: ClientMessage): void;
}

/** A join may start: the menu's Join voice is still up, and the bar is not destroyed. */
export function joinAllowed(model: BarModel | null, destroyed: boolean): boolean {
  return !destroyed && !!model && model.menu === "join";
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
  /** The host's Mute / Allow to talk; hidden when hostVoiceAction is null. */
  host: HTMLButtonElement | null;
}

export class VoiceBar {
  /** Only the tap prompts: without them voice silently fails. */
  readonly el = h("section", { class: "voice-bar", "aria-label": "Voice", hidden: true });

  private readonly voice: VoiceController;
  private readonly ptt: PushToTalk;
  private readonly nameOf: (id: string) => string;
  private readonly host: VoiceHost;
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

  private readonly micIcon = h("span", { class: "voice-mic-icon" });
  private readonly mic = h("button", { type: "button", class: "voice-mic" }, this.micIcon);
  private readonly deafen = h("button", { type: "button", class: "icon-btn voice-deafen" });
  private readonly settingsButton = h("button", { type: "button", class: "icon-btn", "aria-label": "Voice settings" }, icon("settings"));
  /** In voice: speaking (green, lit) and the connection (amber while it waits). */
  private readonly headerDot = h("span", { class: "voice-header-dot", role: "img" });
  /** The live region: only notes that matter are read out. */
  private readonly announce = h("span", { class: "sr-only", role: "status" });
  /**
   * The mic and a small dot. RoomView puts it in the room header.
   *
   * Place it once, in a slot that stays, and leave it there: it hides and
   * shows itself. Never re-insert it, also not through a `replaceChildren` of
   * the header: moving it lets go of a held talk press and can cut off what
   * its live region reads out.
   */
  readonly headerMic = h("div", { class: "voice-header-mic", hidden: true }, this.mic, this.headerDot, this.announce);
  private readonly tapSound = h("button", { type: "button", class: "primary" }, "Tap to turn on sound");
  private readonly tapMic = h("button", { type: "button", class: "primary" }, "Tap to talk again.");
  private readonly taps = h("div", { class: "voice-taps" }, this.tapSound, this.tapMic);
  private readonly turnOff = h("button", { type: "button" }, "Turn off mic");
  private readonly leave = h("button", { type: "button", class: "link" }, "Leave voice");
  private readonly people = h("ul", { class: "voice-people" });
  private readonly rows = new Map<string, Row>();
  private readonly actions = h("div", { class: "voice-actions" }, this.deafen, this.settingsButton, this.turnOff, this.leave);
  /** Only ever shown in its dialog (openPanel). */
  private readonly panel = h("div", { class: "voice-panel" }, this.actions, this.people);

  constructor(voice: VoiceController, ptt: PushToTalk, nameOf: (id: string) => string, host: VoiceHost) {
    this.voice = voice;
    this.ptt = ptt;
    this.nameOf = nameOf;
    this.host = host;
    this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.el.append(this.taps);
    keepKeys(this.el);
    keepKeys(this.headerMic);

    this.wireMic();
    this.deafen.addEventListener("click", () => this.voice.setDeafened(!this.voice.view().deafened));
    this.settingsButton.addEventListener("click", () => this.openSettings());
    this.tapSound.addEventListener("click", () => this.voice.resumeSound());
    this.tapMic.addEventListener("click", () => void this.voice.turnOnMic());
    this.turnOff.addEventListener("click", () => this.voice.turnOffMic());
    this.leave.addEventListener("click", () => this.voice.leave());

    this.unsubscribe = voice.subscribe(() => this.sync());
  }

  /** The room's phase; null for screens outside a room (a fatal message). */
  render(phase: RoomPhase | null): void {
    // Off the room screens (party over) the mic hides: let go first, so the
    // model below is built after the release and the mic never looks held.
    if (focusPhase(phase) !== focusPhase(this.phase)) this.letGo();
    this.phase = phase;
    this.sync();
  }

  /** Space as the talk key, off while a game that uses Space is on screen. */
  setSpaceKey(on: boolean): void {
    if (this.ptt.spaceEnabled === on) return;
    this.ptt.spaceEnabled = on;
    this.sync();
  }

  /** Everyone in voice, with volumes and Mute for me, Hear no one and Voice settings, in a dialog (the menu's Voice). */
  openPanel(): void {
    if (this.panelDialog || this.model?.show !== "header") return;
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
    // The hold button turned into something else (muted, mode change), or hid: let go.
    if (!m.micButton.hold || m.show !== "header") this.letGo();

    const taps = m.tapSound || m.tapMic;
    // The row is only there for the tap prompts.
    this.el.hidden = m.show !== "header" || !taps;
    this.headerMic.hidden = m.show !== "header";
    this.tapSound.hidden = !m.tapSound;
    this.tapMic.hidden = !m.tapMic;
    setText(this.announce, m.spoken);
    // Out of the room (fatal, party over): nothing voice stays open, so no late tap turns the mic on.
    if (!focusPhase(this.phase)) for (const d of [...this.dialogs]) d.close();
    else if (m.show !== "header") this.panelDialog?.close();

    // The mic: a toggle, or the talk button in push-to-talk. "Tap to talk again." stands in for it.
    this.mic.hidden = m.tapMic;
    const b = m.micButton;
    if (this.mic.getAttribute("aria-label") !== m.micName) this.mic.setAttribute("aria-label", m.micName);
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

    this.headerDot.dataset.state = m.connection;
    this.headerDot.setAttribute("aria-label", m.connection === "good" ? "Voice is on" : "Connecting voice...");
    this.headerDot.classList.toggle("on", v.talking || m.speakingIds.length > 0);
    // "Tap to talk again." stands in for the mic: no dot on its own in the header.
    this.headerDot.hidden = m.tapMic;

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
    let host: HTMLButtonElement | null = null;
    if (!self) {
      volume = h("input", { type: "range", min: 0, max: MAX_GAIN, step: 0.05, class: "voice-volume" });
      // Saved on change, not on every step of a drag.
      volume.addEventListener("change", () => this.voice.setVolume(m.id, Number(volume!.value)));
      block = h("button", { type: "button", class: "small" });
      block.addEventListener("click", () => this.voice.setBlocked(m.id, !this.voice.view().members.find((x) => x.id === m.id)?.blocked));
      host = h("button", { type: "button", class: "small voice-host-mute", hidden: true });
      host.addEventListener("click", () => {
        // Read now, not when the row was drawn: the host or the mute may have changed.
        const now = this.voice.view().members.find((x) => x.id === m.id);
        const act = now ? hostVoiceAction(now, this.host.isHost()) : null;
        if (!act) return;
        this.host.send(act.message);
        // The label changes under the finger: say what happened.
        const who = this.nameOf(m.id);
        setText(this.announce, act.label === "Mute" ? `${who} is muted.` : `${who} can talk again.`);
      });
    }
    const buttons = block ? h("span", { class: "voice-person-buttons" }, host, block) : null;
    const li = h("li", { class: "voice-person" }, dot, name, state, volume, buttons);
    const row = { li, dot, name, state, volume, block, host };
    this.rows.set(m.id, row);
    return row;
  }

  private syncRow(row: Row, m: VoiceMemberView): void {
    const name = this.nameOf(m.id);
    setText(row.name, m.self ? `${name} (you)` : name);
    row.li.classList.toggle("speaking", m.speaking);
    const state = m.link === "reconnecting" ? "Trying to connect..." : m.hostMuted ? "muted by host" : m.selfMuted ? "muted" : "";
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
    if (row.host) {
      const act = hostVoiceAction(m, this.host.isHost());
      // Not the host any more: focus must not be lost with the button.
      if (!act && document.activeElement === row.host) row.block?.focus();
      row.host.hidden = !act;
      if (act) {
        setText(row.host, act.label);
        row.host.setAttribute("aria-label", `${act.label}: ${name}`);
      }
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

  /** The room menu's Join voice: the explainer, unless the browser already allows the mic. */
  async startJoin(): Promise<void> {
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
        check("Lower game sound when people talk", p.duck, (on) => set({ duck: on })),
        check("Hide my network address", p.relayOnly, (on) => set({ relayOnly: on }), !v.hasTurn),
        v.hasTurn ? null : h("p", { class: "muted setting-hint" }, "Needs a relay server."),
        h("p", { class: "muted" }, "The settings stay on your device."),
      ),
    );
    this.track(dlg);
  }
}
