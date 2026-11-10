import { h } from "@games/ui";
import { teamColor } from "../shared/teams.ts";
import type { THPublic, THReplay, TreasureLayout } from "../shared/types.ts";
import { MapCanvas } from "./map/map-canvas.ts";
import { islandView, worldToMap } from "./map/overlays.ts";

// The replay (§9): the whole island from above, each team's routes up to the
// slider's time, a ring and tick at every find so far. A plain canvas, so it
// works on a phone too.

type Find = THReplay["finds"][number];

/** Replay seconds per real second: a 30-minute round in 30 s. */
export const REPLAY_SPEED = 60;
const ROUTE_PX = 3;
const ROUTE_ALPHA = 0.9;
const RING_PX = 7;

/** The teams in the legend: only those with a track. A team of spectators never hunted. */
export function legendTeams(teams: THPublic["teams"], replay: THReplay): THPublic["teams"] {
  const played = new Set(replay.tracks.map((t) => t.teamId));
  return teams.filter((t) => played.has(t.id));
}

/**
 * A route's [x, z] points up to time `t`: every point with s ≤ t, then one
 * more, interpolated along the next segment, so the line grows smoothly.
 */
export function routeUpTo(points: readonly [number, number, number][], t: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const [s, x, z] = points[i]!;
    if (s <= t) {
      out.push([x, z]);
      continue;
    }
    const prev = points[i - 1];
    if (prev && t > prev[0]) {
      const f = (t - prev[0]) / (s - prev[0]);
      out.push([prev[1] + (x - prev[1]) * f, prev[2] + (z - prev[2]) * f]);
    }
    break;
  }
  return out;
}

/** The finds at or before `t`. */
export function findsUpTo<T extends { t: number }>(finds: readonly T[], t: number): T[] {
  return finds.filter((f) => f.t <= t);
}

/** Seconds as m:ss. */
export function formatClock(s: number): string {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export class ReplayView {
  readonly el: HTMLElement;
  private canvas = h("canvas", { class: "th-replay-canvas", "aria-label": "Map of the round" });
  private legend = h("ul", { class: "th-replay-legend" });
  private slider = h("input", { type: "range", class: "th-replay-slider", min: "0", max: "0", step: "1", value: "0", "aria-label": "Replay time" }) as HTMLInputElement;
  private play = h("button", { type: "button", class: "th-replay-play" }, "Play");
  private clock = h("span", { class: "th-replay-clock" });
  private body = h("div", { class: "th-replay-body" }, h("h2", { class: "th-replay-title" }, "Replay"), this.canvas, this.legend, h("div", { class: "th-replay-controls" }, this.play, this.slider, this.clock));
  private none = h("p", { class: "th-replay-none" }, "No replay for this round.");
  private game: THPublic | null = null;
  private replay: THReplay | null = null;
  private layout: TreasureLayout | null = null;
  private base: MapCanvas | null = null;
  private t = 0;
  private raf = 0;
  private last = 0;
  private forSeed: number | null = null;

  constructor() {
    this.el = h("section", { class: "th-replay", "aria-label": "Replay", hidden: true }, this.body, this.none);
    this.slider.addEventListener("input", () => {
      this.pause();
      this.t = Number(this.slider.value);
      this.paint();
    });
    this.play.addEventListener("click", () => (this.raf ? this.pause() : this.start()));
  }

  /** True when there is a round to show: finished, with a replay. */
  static shows(game: THPublic | null): boolean {
    return !!game && game.phase === "finished" && game.replay !== null;
  }

  update(game: THPublic, layout: TreasureLayout) {
    const show = ReplayView.shows(game);
    this.el.hidden = !show;
    if (!show) {
      this.pause();
      this.replay = null;
      this.forSeed = null;
      return;
    }
    const replay = game.replay!;
    const fresh = this.replay !== replay && JSON.stringify(this.replay) !== JSON.stringify(replay);
    this.game = game;
    this.replay = replay;
    this.layout = layout;
    const has = replay.durationS > 0;
    this.body.hidden = !has;
    this.none.hidden = has;
    if (!has) return;
    if (this.base?.seed !== layout.seed) this.base = new MapCanvas(layout);
    this.slider.max = String(replay.durationS);
    if (fresh || this.forSeed !== game.seed) {
      this.forSeed = game.seed;
      this.pause();
      this.t = replay.durationS;
      this.slider.value = String(this.t);
    }
    this.legend.replaceChildren(
      ...legendTeams(game.teams, replay).map((tm) => {
        const c = teamColor(tm.color);
        return h("li", { class: "th-replay-key" }, h("span", { class: "th-replay-swatch", style: `background:${c.hex}` }), c.name);
      }),
    );
    this.paint();
  }

  destroy() {
    this.pause();
  }

  private start() {
    const end = this.replay?.durationS ?? 0;
    if (this.t >= end) this.t = 0;
    this.play.textContent = "Pause";
    this.last = performance.now();
    const step = (now: number) => {
      this.t = Math.min(end, this.t + ((now - this.last) / 1000) * REPLAY_SPEED);
      this.last = now;
      this.slider.value = String(Math.floor(this.t));
      this.paint();
      if (this.t >= end) this.pause();
      else this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private pause() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.play.textContent = "Play";
  }

  private paint() {
    const { game, replay, layout, base } = this;
    if (!game || !replay || !layout || !base) return;
    this.clock.textContent = `${formatClock(this.t)} / ${formatClock(replay.durationS)}`;
    const css = this.canvas.clientWidth;
    if (css <= 0) return;
    const dpr = devicePixelRatio || 1;
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px) this.canvas.width = this.canvas.height = px;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(px / css, 0, 0, px / css, 0, 0);
    const view = islandView(layout, css);
    base.draw(ctx, view, []);
    const hex = (teamId: number) => {
      const tm = game.teams.find((q) => q.id === teamId);
      return tm ? teamColor(tm.color).hex : "#ffffff";
    };
    ctx.lineWidth = ROUTE_PX;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.globalAlpha = ROUTE_ALPHA;
    for (const tr of replay.tracks) {
      const route = routeUpTo(tr.points, this.t);
      if (route.length < 2) continue;
      ctx.strokeStyle = hex(tr.teamId);
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        const p = worldToMap({ x, z }, view);
        if (i === 0) ctx.moveTo(p.px, p.py);
        else ctx.lineTo(p.px, p.py);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const f of findsUpTo<Find>(replay.finds, this.t)) {
      const p = worldToMap(f, view);
      ctx.fillStyle = "rgb(14 14 12 / 0.55)";
      ctx.strokeStyle = hex(f.teamId);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.px, p.py, RING_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hex(f.teamId);
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓", p.px, p.py + 0.5);
    }
  }
}
