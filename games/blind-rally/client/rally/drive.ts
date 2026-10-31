import { h, type GameClientApi } from "@games/ui";
import type { TrackData, Vec3 } from "../../shared/track-data.ts";
import { Controls, NEUTRAL, type ControlState } from "../driver/input.ts";
import { bindPads, coarse, fullscreenButton, pedalZone, steerZone } from "../driver/pads.ts";
import type { GodotBridge, GodotPhysicsEvent, GodotSnapshot } from "../navigator/bridge.ts";
import type { SeatAddon } from "../navigator/host.ts";
import { navigatorTrack } from "../navigator/track.ts";
import type { RoleProps } from "../role.ts";
import { routeProgress, upcoming } from "./progress.ts";

// Rally's controls, on the same device as the car (rally-spec §3). The
// Driver's Controls (pads, WASD and arrows, neutral on blur) feed the
// bridge's receiveControl straight away: no socket between your thumb and
// the wheel. The car's in this iframe; the server still gets every snapshot
// and judges it exactly as it would a Navigator's.
//
// Keys reach whichever document has focus. With the page focused, Controls
// hears them here; with the course focused (someone clicked the map),
// Godot's own keyboard drive does (initSession `keyboard`). Either way it's
// the same car and the same bindings.

/** Godot goes neutral after 300 ms without control; a held pad repeats well inside that. */
const REPEAT_MS = 40;
/** The second R or tap has to come this soon, or Reset forgets. */
const CONFIRM_MS = 3_000;
/** Pace notes this close count as "now". */
const NOW_M = 15;

export class LocalDrive implements SeatAddon {
  private bridge: GodotBridge;
  private api: GameClientApi;
  private controls = new Controls();
  private current: ControlState = NEUTRAL;
  private seq = 0;
  private repeat: ReturnType<typeof setInterval>;
  private confirming: ReturnType<typeof setTimeout> | undefined;
  private off: (() => void)[] = [];
  private live = false;
  private props: RoleProps | null = null;

  private steer = steerZone();
  private pedals = pedalZone();
  /** Touch only: over the course, a thumb's reach from each edge. */
  private pads = h("div", { class: "rl-pads" }, this.steer, this.pedals);
  private reset = h("button", { type: "button", class: "br-chip rl-reset" }, "Reset");
  private digits = h("span", { class: "rl-speed-digits" }, "0");
  private gear = h("span", { class: "rl-gear" }, "D");
  private speed = h("div", { class: "rl-speed", "aria-label": "Speed" }, this.digits, h("span", { class: "rl-unit" }, "km/h"), this.gear);
  private callNow = h("span", { class: "rl-call" });
  private callIn = h("span", { class: "rl-call-in" });
  private callNext = h("span", { class: "rl-call-next" });
  /** The co-driver: the next call, how far, and the one after. Pace notes, read out in order. */
  private codriver = h("div", { class: "rl-codriver", "aria-label": "Pace notes", hidden: true }, h("span", { class: "rl-call-main" }, this.callNow, this.callIn), this.callNext);

  private track: TrackData | null = null;
  /** Godot's own checkpoint count and the trip meter when it last changed: the co-driver's dead reckoning. */
  private gate = -1;
  private tripAtGate = 0;

  constructor(bridge: GodotBridge, api: GameClientApi) {
    this.bridge = bridge;
    this.api = api;
    this.controls.onChange = (s) => this.send(s);
    bindPads(this.controls, this.pads, this.steer, this.pedals);
    this.controls.keyboard();
    // R, twice: the reset. In the course's own window Godot sees R and asks us (physics `reset`).
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.code === "KeyR" && !e.repeat && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) this.onReset();
    };
    addEventListener("keydown", key);
    this.off.push(() => removeEventListener("keydown", key));
    this.reset.addEventListener("pointerup", (e) => e.button === 0 && this.onReset());
    this.reset.addEventListener("click", (e) => e.detail === 0 && this.onReset());
    this.repeat = setInterval(() => {
      if (!isNeutral(this.current)) this.push();
    }, REPEAT_MS);
    // Nothing on this screen scrolls or zooms: a stray pinch mid-hairpin is a crash.
    const stop = (e: Event) => e.preventDefault();
    for (const t of ["contextmenu", "gesturestart", "dblclick", "selectstart"]) {
      this.pads.addEventListener(t, stop);
      this.off.push(() => this.pads.removeEventListener(t, stop));
    }
    document.documentElement.classList.add("br-locked");
  }

  mount(strip: HTMLElement, view: HTMLElement) {
    // Reset sits by the clock; the full-screen toggle (phones) at the end.
    strip.querySelector(".br-nclock")?.after(this.reset);
    const fs = fullscreenButton();
    if (fs) strip.append(fs);
    view.append(this.codriver, this.speed);
    if (coarse()) {
      view.append(this.pads);
      view.closest(".br-navigator")?.classList.add("rl-touch");
    }
    view.closest(".br-navigator")?.classList.add("rl-seat");
  }

  update(props: RoleProps) {
    this.props = props;
    if (props.private.role !== "navigator") return;
    const id = props.private.session.trackId;
    if (this.track?.id !== id) {
      this.track = navigatorTrack(id);
      this.gate = -1;
    }
    this.reset.hidden = props.game.phase === "teams" || props.game.phase === "finished";
  }

  snapshot(s: GodotSnapshot) {
    const kmh = Math.round(Math.abs(s.speed) * 3.6);
    const text = String(kmh);
    if (this.digits.textContent !== text) this.digits.textContent = text;
    const rev = s.speed < -0.5;
    this.gear.textContent = rev ? "R" : "D";
    this.gear.classList.toggle("rev", rev);
    this.coDrive(s);
  }

  physics(e: GodotPhysicsEvent) {
    if (e.kind === "reset") this.onReset();
  }

  tick(move: boolean) {
    this.live = move;
    this.reset.disabled = !move;
    if (!move) this.unconfirm();
    const g = this.props?.game;
    const status = g?.teams.find((t) => t.id === this.props?.private.teamId)?.status ?? null;
    // The co-driver talks while you're out there, and on the grid it reads you the first call.
    this.codriver.hidden = !this.track || !g || g.phase === "finished" || (status !== null && status !== "running");
    // Parked at the finish, under the results: the speedo has nothing left to say.
    this.speed.hidden = g?.phase === "finished";
  }

  destroy() {
    clearInterval(this.repeat);
    this.unconfirm();
    this.controls.neutral();
    this.controls.destroy();
    for (const f of this.off) f();
    document.documentElement.classList.remove("br-locked");
  }

  private send(s: ControlState) {
    this.current = s;
    this.push();
  }

  private push() {
    this.bridge.control({ ...this.current, seq: ++this.seq });
  }

  /** Two presses, like the Driver's: a reset costs 5 s, so one stray R mustn't. */
  private onReset() {
    if (!this.live || this.reset.disabled) return;
    if (!this.confirming) {
      this.reset.textContent = "Tap again: +5 s";
      this.reset.classList.add("confirm");
      this.confirming = setTimeout(() => this.unconfirm(), CONFIRM_MS);
      return;
    }
    this.unconfirm();
    this.api.act({ type: "race.reset" });
  }

  private unconfirm() {
    clearTimeout(this.confirming);
    this.confirming = undefined;
    this.reset.textContent = "Reset";
    this.reset.classList.remove("confirm");
  }

  private coDrive(s: GodotSnapshot) {
    const t = this.track;
    const p = s.position;
    if (!t || !Array.isArray(p) || p.length !== 3) return;
    const passed = typeof s.checkpointHint === "number" ? s.checkpointHint : 0;
    const trip = typeof s.distance === "number" ? s.distance : 0;
    // A new gate (or a reset back to an old one): dead reckoning starts again from it.
    if (passed !== this.gate || trip < this.tripAtGate) {
      this.gate = passed;
      this.tripAtGate = trip;
    }
    const at = routeProgress(t, passed, p as Vec3, trip - this.tripAtGate);
    // Notes just behind the estimate still count: it runs early, and a call that's due is the one to say.
    const [next, after] = upcoming(t, at - NOW_M);
    if (!next) return;
    const to = next.note.distance - at;
    this.callNow.textContent = next.note.text;
    this.callNow.classList.toggle("landmark", !/^[A-Z]{2,}/.test(next.note.text));
    this.callIn.textContent = to <= NOW_M ? "now" : `${Math.round(to / 10) * 10} m`;
    this.callNext.textContent = after ? `then ${after.note.text}` : "";
  }
}

const isNeutral = (s: ControlState) => s.steer === 0 && s.throttle === 0 && s.brake === 0;
