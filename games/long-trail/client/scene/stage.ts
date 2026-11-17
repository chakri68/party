// The trail scene: a canvas band that draws the caravan in its land, and plays
// the day's beats over time. It draws at most 30 frames a second, and stops
// when the tab is hidden or the band is off screen. Under reduced motion it
// draws one still frame for each beat.
import type { Health } from "../../shared/types.ts";
import { loadArt, type Art } from "./art.ts";
import { drawBackdrop, type View } from "./backdrop.ts";
import { drawCaravan, layoutCaravan, type CaravanWalker } from "./caravan.ts";
import { beatAt, startAt } from "./director.ts";
import { SCENES, type EventScene, type Pose, type Stagehand } from "./events/index.ts";
import { ridingIds, type Beat, type SceneModel, type Terrain } from "./model.ts";
import { drawFire, drawGate, drawHouse, drawStall, drawTent } from "./sprites.ts";

type C = CanvasRenderingContext2D;

const FRAME_MS = 33;
/** The longest step one frame may take, so a slow frame never jumps. */
const MAX_DT = 100;
const MAX_DPR = 2;
/** In the settle beat, changes from outside the event (rest, risk, doses) show from here. */
const SETTLE_SWITCH = 0.4;
const NIGHT = "rgba(16,20,48,0.38)";
const EVENT_MS = 4000;

const scrollPerSec = (speed: number) => speed * 13; // px at s = 1
const stepsPerSec = (speed: number) => (speed > 0 ? 0.45 + 0.3 * speed : 0);
const ease = (t: number) => 1 - (1 - t) * (1 - t);
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
  if (kind === "gate") return drawGate(c, x(62), y, s);
  if (kind === "market") {
    drawStall(c, x(128), y + 1 * s, s, 20);
    drawHouse(c, x(88), y, s);
    drawStall(c, x(42), y + 1 * s, s, 200);
    return;
  }
  drawHouse(c, x(98), y, s);
  drawHouse(c, x(44), y - 2 * s, s);
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
  private phase = 0; // the walk cycle
  private reduced = false;
  private onScreen = true;
  private stillKey = "";
  private dirty = true;
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
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private tick = () => {
    this.raf = 0;
    if (!this.active() || this.reduced) return;
    const now = performance.now();
    if (this.last && now - this.last < FRAME_MS) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    // The first frame after a pause draws the present, with no catch-up.
    const dt = this.last ? Math.min(now - this.last, MAX_DT) : 0;
    this.last = now;
    this.paint(now, dt);
    this.raf = requestAnimationFrame(this.tick);
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
    const riding = ridingIds(m.walkers.map((w) => w.id), health, camels);
    const walkers: CaravanWalker[] = [];
    for (const w of m.walkers) {
      const alpha = beat?.kind === "settle" && w.health === 0 ? 1 - t : 1;
      if (alpha <= 0) continue;
      walkers.push({ id: w.id, color: w.color, health: Math.max(1, health[w.id] ?? w.health) as Health, riding: riding.has(w.id), alpha });
    }
    const lay = layoutCaravan(v, walkers, camels);

    // How fast: travel at the day's pace (slowing into a town), still for events, else the plan's.
    let speed = m.speed as number;
    if (travel) speed = (beat.speed ?? m.speed) * (beat.arrive ? 1 - ramp(t, 0.6, 1) : 1);
    else if (scene) speed = 0;
    if (this.reduced) speed = 0;
    this.scroll += (dt / 1000) * scrollPerSec(speed) * v.s;
    this.phase += (dt / 1000) * stepsPerSec(speed);
    const frame = speed > 0 ? this.phase : 0;

    const terrain = travel ? (beat.terrain ?? m.terrain) : m.terrain;
    const outcome = beat?.kind === "event" ? (beat.outcome ?? null) : null;
    const hurt = outcome?.healthChanges.find((h) => h.to < h.from);
    const seat = hurt ? lay.seat.get(hurt.playerId) : undefined;
    const hurtX = !hurt ? undefined : seat !== undefined ? lay.camelX[seat] : lay.footX.get(hurt.playerId);
    const hand: Stagehand = {
      c,
      v,
      t,
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
    drawBackdrop(c, this.art, v, terrain, this.reduced ? 0 : this.scroll, { fork: m.fork && !travel, night: !!pose.night });
    if (travel && beat.arrive) drawTown(c, v, isTown(m.terrain) ? m.terrain : "town", (1 - ease(t)) * v.w * 0.7);
    else if (!travel && isTown(m.terrain)) drawTown(c, v, m.terrain, 0);
    if (m.camp && scene !== SCENES.thief) {
      const x = Math.min(v.w - 26 * v.s, lay.x1 + 52 * v.s);
      drawTent(c, x, v.ground - 7 * v.s, v.s);
      drawFire(c, lay.x1 + 26 * v.s, v.ground - 1 * v.s, v.s * 0.9, this.reduced ? 0 : Math.floor(now / 333) / 4);
    }
    scene?.back?.(hand);
    const moveFrame = this.reduced ? 0 : ((t * EVENT_MS) / 1000) * 1.5;
    drawCaravan(c, v, walkers, lay, pose, frame, m.overloaded ? "high" : "normal", moveFrame);
    if (pose.night) {
      c.fillStyle = NIGHT;
      c.fillRect(0, 0, v.w, v.h);
    }
    scene?.front?.(hand);
  }
}
