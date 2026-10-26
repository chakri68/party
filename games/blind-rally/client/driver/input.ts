import type { ControlInput } from "../../shared/types.ts";

// The Driver's hands, as three numbers. Touch zones and keys feed one
// Controls; a Sender turns its changes into `in` streams.
//
// Mechanism, because the failure mode is a car with its foot stuck down:
// every pointer is tracked by id with capture, so a thumb sliding off a pad
// or the screen edge still ends in pointerup/cancel/lostpointercapture, and
// each of those is a release. blur and visibilitychange go fully neutral.
// Every change is sent at once; a 25 Hz tick repeats the current state (Godot
// neutralises after ~300 ms of silence, so that's also the watchdog's food).

export type Control = "left" | "right" | "gas" | "brake";

export interface ControlState {
  steer: number;
  throttle: number;
  brake: number;
}

export const NEUTRAL: ControlState = { steer: 0, throttle: 0, brake: 0 };

export const KEYS: Record<string, Control> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "gas",
  ArrowUp: "gas",
  KeyS: "brake",
  ArrowDown: "brake",
};

export class Controls {
  /** Each finger or key → what it's holding. Keys are "k:KeyA". */
  private held = new Map<string, Control>();
  /** When each source last went down, so the newer steering direction wins. */
  private since = new Map<string, number>();
  private stamp = 0;
  private cleanup: (() => void)[] = [];
  onChange: (s: ControlState) => void = () => {};
  /** Which controls are down, for lighting the pads. */
  onHeld: (held: ReadonlySet<Control>) => void = () => {};

  state(): ControlState {
    let steer = 0;
    let newest = -1;
    let throttle = 0;
    let brake = 0;
    for (const [src, c] of this.held) {
      if (c === "gas") throttle = 1;
      else if (c === "brake") brake = 1;
      else if (this.since.get(src)! > newest) {
        newest = this.since.get(src)!;
        steer = c === "left" ? -1 : 1;
      }
    }
    return { steer, throttle, brake };
  }

  private set(src: string, c: Control | null) {
    const before = this.held.get(src);
    if (before === c) return;
    if (c) {
      this.held.set(src, c);
      this.since.set(src, ++this.stamp);
    } else {
      this.held.delete(src);
      this.since.delete(src);
    }
    this.changed();
  }

  /** Let go of everything: lost focus, tab hidden, race over. */
  neutral() {
    if (!this.held.size) return;
    this.held.clear();
    this.since.clear();
    this.changed();
  }

  private changed() {
    this.onHeld(new Set(this.held.values()));
    this.onChange(this.state());
  }

  /**
   * A zone of pads: which pad a pointer is on is decided by position, so
   * sliding a thumb from ◀ to ▶ switches without lifting. `pick` maps a
   * point to a control, or null for the gap between pads.
   */
  zone(el: HTMLElement, pick: (x: number, y: number) => Control | null) {
    const src = (e: PointerEvent) => `p:${e.pointerId}`;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.set(src(e), pick(e.clientX, e.clientY));
    };
    const move = (e: PointerEvent) => {
      if (this.held.has(src(e)) || el.hasPointerCapture(e.pointerId)) this.set(src(e), pick(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => this.set(src(e), null);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"] as const) el.addEventListener(t, up);
    this.cleanup.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"] as const) el.removeEventListener(t, up);
    });
  }

  /** WASD and arrows, page-wide while mounted. Typing in a field doesn't drive. */
  keyboard() {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      const c = KEYS[e.code];
      if (!c || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault(); // arrows would scroll the page
      if (!e.repeat) this.set(`k:${e.code}`, c);
    };
    const up = (e: KeyboardEvent) => {
      if (KEYS[e.code]) this.set(`k:${e.code}`, null);
    };
    const away = () => this.neutral();
    const hidden = () => document.visibilityState !== "visible" && this.neutral();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", away);
    addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", away);
      removeEventListener("pagehide", away);
      document.removeEventListener("visibilitychange", hidden);
    });
  }

  destroy() {
    for (const f of this.cleanup) f();
    this.cleanup = [];
  }
}

/** 25 Hz, the spec's 20–30 middle. */
export const TICK_MS = 40;
/**
 * Edges go out at once, but never closer than this: the server drops a
 * seat's streams past 40 a second, and mashing two pads could get there.
 * Ticks plus capped edges stay under ~36/s.
 */
export const MIN_GAP_MS = 28;
/** After going neutral, keep repeating it this long, then fall quiet. */
const IDLE_REPEAT_MS = 250;

/**
 * Turns control states into numbered `in` packets. Only sends while `live`;
 * going live sends the current state at once, so a pedal held through "GO"
 * bites on the first frame.
 */
export class Sender {
  private seq = 0;
  private current: ControlState = NEUTRAL;
  private live = false;
  private lastSent = -Infinity;
  private neutralSince = 0;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval>;
  /** Packets sent, for the dashboard's debug line and tests. */
  sent = 0;

  private send: (data: ControlInput) => void;
  private now: () => number;

  constructor(send: (data: ControlInput) => void, now: () => number = () => performance.now()) {
    this.send = send;
    this.now = now;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** A reloaded page carries on from the server's count instead of starting at 1. */
  catchUp(lastSeq: number) {
    this.seq = Math.max(this.seq, lastSeq);
  }

  setLive(live: boolean) {
    if (live === this.live) return;
    this.live = live;
    if (live) this.flush();
  }

  update(s: ControlState) {
    const wasNeutral = isNeutral(this.current);
    this.current = s;
    if (isNeutral(s) && !wasNeutral) this.neutralSince = this.now();
    this.edge();
  }

  private edge() {
    if (!this.live) return;
    const wait = this.lastSent + MIN_GAP_MS - this.now();
    if (wait <= 0) return this.flush();
    this.pending ??= setTimeout(() => {
      this.pending = undefined;
      this.flush();
    }, wait);
  }

  private tick() {
    if (!this.live || this.now() - this.lastSent < TICK_MS - 5) return;
    if (isNeutral(this.current) && this.now() - this.neutralSince > IDLE_REPEAT_MS) return;
    this.flush();
  }

  private flush() {
    if (!this.live) return;
    clearTimeout(this.pending);
    this.pending = undefined;
    this.lastSent = this.now();
    this.sent++;
    this.send({ t: "in", seq: ++this.seq, ...this.current });
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.pending);
  }
}

const isNeutral = (s: ControlState) => s.steer === 0 && s.throttle === 0 && s.brake === 0;
