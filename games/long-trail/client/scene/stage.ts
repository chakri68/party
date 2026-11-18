// The trail scene: a canvas band that draws the caravan in its land, and plays
// the day's beats over time. It draws at most 30 frames a second, and stops
// when the tab is hidden or the band is off screen. Standing still with no beat
// to play, it draws only after a change (see paint-gate.ts). Under reduced motion it
// draws one still frame for each beat.
import type { Health } from "../../shared/types.ts";
import { loadArt, type Art } from "./art.ts";
import { drawBackdrop, type View } from "./backdrop.ts";
import { castWalkers, drawCaravan, layoutCaravan } from "./caravan.ts";
import { beatAt, startAt, totalMs } from "./director.ts";
import { walkFrame } from "./events/fx.ts";
import { SCENES, type EventScene, type Pose, type Stagehand } from "./events/index.ts";
import { type Beat, type SceneModel, type Terrain } from "./model.ts";
import { FIRE_MS, needsPaint, sleepMs } from "./paint-gate.ts";
import { drawFire, drawGate, drawHouse, drawStall, drawTent } from "./sprites.ts";

type C = CanvasRenderingContext2D;

const FRAME_MS = 33;
/** The longest step one frame may take, so a slow frame never jumps. */
const MAX_DT = 100;
const MAX_DPR = 2;
/** In the settle beat, changes from outside the event (rest, risk, doses) show from here. */
const SETTLE_SWITCH = 0.4;
const NIGHT = "rgba(16,20,48,0.38)";

const scrollPerSec = (speed: number) => speed * 13; // px at s = 1
/** On an arrival the ground carries the town at least this far (px at s = 1), so it comes in from off screen. */
const ARRIVE_PX = 130;
const SLOW_FROM = 0.6; // an arrival slows to a stop from here
const slowing = (t: number) => 1 - ramp(t, SLOW_FROM, 1);
/** The share of an arrival beat's full-speed distance still to go at t, with the slow-down at the end. */
function leftToGo(t: number): number {
  const tail = 1 - SLOW_FROM;
  return t < SLOW_FROM ? SLOW_FROM - t + tail / 2 : (1 - t) ** 2 / (2 * tail);
}
const stepsPerSec = (speed: number) => (speed > 0 ? 0.45 + 0.3 * speed : 0);
const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const isTown = (t: Terrain): t is "town" | "market" | "gate" => t === "town" || t === "market" || t === "gate";

function sceneOf(beat: Beat | null): EventScene | null {
  if (!beat || (beat.kind !== "event" && beat.kind !== "situation")) return null;
  return SCENES[beat.scene ?? "calm"] ?? SCENES.calm;
}

/** Where a town's buildings stand: houses, stalls for a market, or the gate at the end. */
function drawTown(c: C, v: View, kind: "town" | "market" | "gate", shift: number): void {
  const s = v.s;
  const x = (u: number) => v.w - u * s + shift;
  const y = v.ground - 6 * s;
  if (kind === "gate") return drawGate(c, x(44), y, s);
  if (kind === "market") {
    drawStall(c, x(100), y + 1 * s, s, 20);
    drawHouse(c, x(62), y, s);
    drawStall(c, x(26), y + 1 * s, s, 200);
    return;
  }
  drawHouse(c, x(64), y, s);
  drawHouse(c, x(24), y - 2 * s, s);
}

export class TrailScene {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: C | null;
  private art: Art = { far: {}, clouds: [] };
  private model: SceneModel | null = null;
  private beatsKey = "";
  private beatsStart = 0;
  private view: View = { w: 0, h: 0, ground: 0, s: 1 };
  private dpr = 1;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = 0; // when the last frame was drawn, 0 = none since the loop began
  private scroll = 0;
  private arriveKey = ""; // the arrival beat the town is placed for
  private arriveEnd = 0; // the scroll at which the town stands in its place
  private phase = 0; // the walk cycle
  private reduced = false;
  private onScreen = true;
  private stillKey = "";
  private dirty = true;
  private wasRunning = false; // a beat was playing at the last frame
  private dead = false;
  private motion: MediaQueryList | null;
  private resize: ResizeObserver | null = null;
  private seen: IntersectionObserver | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.el = document.createElement("div");
    this.el.className = "lt-scene";
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.reduced = !!this.motion?.matches;
    this.motion?.addEventListener("change", this.onMotion);
    document.addEventListener("visibilitychange", this.kick);
    if (typeof ResizeObserver === "function") {
      this.resize = new ResizeObserver((entries) => {
        const r = entries[entries.length - 1]?.contentRect;
        if (r) this.size(r.width, r.height);
      });
      this.resize.observe(this.el);
    }
    if (typeof IntersectionObserver === "function") {
      this.seen = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        this.onScreen = e.isIntersecting;
        this.kick();
      });
      this.seen.observe(this.el);
    }
    void loadArt().then((art) => {
      if (this.dead) return;
      this.art = art;
      this.dirty = true;
      this.kick();
    });
  }

  /** A new `beatsKey` starts the beats again; anything else only changes what is drawn. */
  update(model: SceneModel, opts: { snapshot: boolean }): void {
    if (model.beatsKey !== this.beatsKey) {
      this.beatsKey = model.beatsKey;
      this.beatsStart = performance.now() - startAt(model.beats, opts);
    }
    this.model = model;
    this.dirty = true;
    this.kick();
  }

  destroy(): void {
    this.dead = true;
    this.stop();
    this.motion?.removeEventListener("change", this.onMotion);
    document.removeEventListener("visibilitychange", this.kick);
    this.resize?.disconnect();
    this.seen?.disconnect();
  }

  // ---- the loop -------------------------------------------------------------

  private onMotion = () => {
    this.reduced = !!this.motion?.matches;
    this.dirty = true;
    this.stop();
    this.kick();
  };

  private active(): boolean {
    return !this.dead && !!this.model && !!this.ctx && this.view.w > 0 && this.onScreen && document.visibilityState === "visible";
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.last = 0;
  }

  /** Starts, resumes or stops drawing to match what can be seen. */
  private kick = () => {
    if (!this.active()) return this.stop();
    if (this.reduced) return this.still();
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.active() || this.reduced) return;
    // 3 ms of slack, so every second frame of a 60 Hz display draws: a steady 30 fps.
    if (this.last && now - this.last < FRAME_MS - 3) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const m = this.model!;
    const running = m.beats.length > 0 && now - this.beatsStart < totalMs(m.beats);
    // The frame after the last beat ends draws its end state once.
    if (this.wasRunning && !running) this.dirty = true;
    this.wasRunning = running;
    const gate = { running, speed: m.speed, camp: m.camp, dirty: this.dirty, now, last: this.last };
    if (needsPaint(gate)) {
      // The first frame after a pause draws the present, with no catch-up.
      const dt = this.last ? Math.min(now - this.last, MAX_DT) : 0;
      this.last = now;
      this.paint(now, dt);
    }
    // Standing still: sleep until the fire changes, or until `update`, a resize or the art wakes it.
    const wait = sleepMs(gate);
    if (wait === 0) this.raf = requestAnimationFrame(this.tick);
    else if (Number.isFinite(wait)) this.timer = setTimeout(this.wake, wait);
  };

  /** After a sleep: draw on the next frame, keeping `last` so the fire stays at 3 a second. */
  private wake = () => {
    this.timer = undefined;
    if (!this.active() || this.reduced) return this.kick();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  /** Reduced motion: draw when the model or the beat changes, and wait for the next beat. */
  private still(): void {
    const beats = this.model!.beats;
    const now = performance.now();
    const elapsed = now - this.beatsStart;
    const pos = beatAt(beats, elapsed);
    const key = pos ? String(pos.index) : "-";
    if (this.dirty || key !== this.stillKey) {
      this.stillKey = key;
      this.paint(now, 0);
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!pos || pos.index >= beats.length - 1) return;
    let end = 0;
    for (let i = 0; i <= pos.index; i++) end += beats[i]!.ms;
    if (Number.isFinite(end)) this.timer = setTimeout(this.kick, Math.max(0, end - elapsed) + 20);
  }

  private size(w: number, h: number): void {
    this.dpr = Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1));
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.view = { w, h, ground: 0.78 * h, s: h / 150 };
    this.dirty = true;
    // Resizing clears the canvas: draw again now, not on the next frame.
    if (this.active()) this.paint(performance.now(), 0);
    this.kick();
  }

  // ---- one frame ------------------------------------------------------------

  private paint(now: number, dt: number): void {
    const c = this.ctx;
    const m = this.model;
    if (!c || !m) return;
    this.dirty = false;
    const v = this.view;
    const pos = beatAt(m.beats, now - this.beatsStart);
    const beat = pos ? m.beats[pos.index]! : null;
    const scene = sceneOf(beat);
    const t = !beat ? 0 : this.reduced ? (scene ? scene.still : 1) : pos!.t;
    const travel = beat?.kind === "travel";

    // Who is drawn and how: the beat's start, or the final state.
    const late = !beat || (beat.kind === "settle" && t >= SETTLE_SWITCH);
    const final = Object.fromEntries(m.walkers.map((w) => [w.id, w.health])) as Record<string, Health>;
    const health = late ? final : beat.health;
    const camels = late ? m.camels : beat.camels;
    // A walker who fades in this beat is drawn as at its start; one already dead is not drawn.
    const fade = beat?.fade ?? [];
    const shownHealth = { ...health };
    for (const id of fade) if (beat!.health[id] !== undefined) shownHealth[id] = beat!.health[id]!;
    const walkers = castWalkers(m.walkers, { health: shownHealth, fade, t, camels });
    const lay = layoutCaravan(v, walkers, camels);

    // How fast: travel at the day's pace (slowing into a town), still for events, else the plan's.
    const arriving = travel && !!beat.arrive;
    let speed = m.speed as number;
    if (travel) speed = (beat.speed ?? m.speed) * (arriving ? slowing(t) : 1);
    else if (scene) speed = 0;
    if (this.reduced) speed = 0;
    // An arrival moves the ground fast enough to bring the town in from the right.
    const arrivePx = arriving ? Math.max(scrollPerSec(beat.speed ?? m.speed), ARRIVE_PX / ((leftToGo(0) * beat.ms) / 1000)) : 0;
    const rate = arriving ? (this.reduced ? 0 : arrivePx * slowing(t)) : scrollPerSec(speed);
    this.scroll += (dt / 1000) * rate * v.s;
    this.phase += (dt / 1000) * stepsPerSec(speed);
    const frame = speed > 0 ? this.phase : 0;

    // The land: the beat's (the leg walked), fading to the model's (the stop reached) through settle.
    const terrain = beat?.terrain ?? m.terrain;
    const landing = beat?.kind === "settle" && terrain !== m.terrain ? t : terrain === m.terrain ? 1 : 0;
    const outcome = beat?.kind === "event" ? (beat.outcome ?? null) : null;
    const hurt = outcome?.healthChanges.find((h) => h.to < h.from);
    const seat = hurt ? lay.seat.get(hurt.playerId) : undefined;
    const hurtX = !hurt ? undefined : seat !== undefined ? lay.camelX[seat] : lay.footX.get(hurt.playerId);
    const hand: Stagehand = {
      c,
      v,
      t,
      ms: beat?.ms ?? Infinity,
      loop: beat?.kind === "situation",
      outcome,
      caravan: { x0: lay.x0, x1: lay.x1 },
      target: hurt && hurtX !== undefined ? { id: hurt.playerId, x: hurtX } : null,
      terrain,
      camels,
      camelX: lay.camelX,
      walkers: [...lay.footX].map(([id, x]) => ({ id, x })),
    };
    const pose: Pose = scene?.pose?.(hand) ?? {};

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, v.w, v.h);
    const scrollPx = this.reduced ? 0 : this.scroll;
    if (landing < 1) drawBackdrop(c, this.art, v, terrain, scrollPx, { fork: false, night: !!pose.night });
    if (landing > 0) {
      c.globalAlpha = landing;
      drawBackdrop(c, this.art, v, m.terrain, scrollPx, { fork: m.fork && !travel, night: !!pose.night });
      c.globalAlpha = 1;
    }
    if (arriving) {
      // The town rides on the ground: it moves with the scroll and stops in its place.
      const key = `${this.beatsKey}:${pos!.index}`;
      if (key !== this.arriveKey) {
        this.arriveKey = key;
        this.arriveEnd = this.scroll + arrivePx * v.s * leftToGo(t) * (beat.ms / 1000);
      }
      drawTown(c, v, isTown(m.terrain) ? m.terrain : "town", Math.max(0, this.arriveEnd - this.scroll));
    }
    else if (!travel && isTown(m.terrain)) drawTown(c, v, m.terrain, 0);
    if (m.camp && scene !== SCENES.thief) {
      const x = Math.min(v.w - 26 * v.s, lay.x1 + 52 * v.s);
      drawTent(c, x, v.ground - 7 * v.s, v.s);
      drawFire(c, lay.x1 + 26 * v.s, v.ground - 1 * v.s, v.s * 0.9, this.reduced ? 0 : Math.floor(now / FIRE_MS) / 4);
    }
    scene?.back?.(hand);
    const moveFrame = this.reduced ? 0 : walkFrame(hand);
    drawCaravan(c, v, walkers, lay, pose, frame, m.overloaded ? "high" : "normal", moveFrame);
    if (pose.night) {
      c.fillStyle = NIGHT;
      c.fillRect(0, 0, v.w, v.h);
    }
    scene?.front?.(hand);
  }
}
