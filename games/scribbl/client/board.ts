import { CANVAS_H, CANVAS_W, PALETTE, SIZES, type DrawOp, type Stroke } from "../shared/types.ts";

/**
 * The drawing: a stroke list on a fixed 800×600 page, painted onto a canvas
 * at whatever size (and pixel density) the screen gives it. The drawer's own
 * lines and everyone else's relayed ones go through the same `apply`, so
 * what the drawer sees is what the room sees.
 */
export class Board {
  readonly el = document.createElement("canvas");
  turn = -1;
  strokes: Stroke[] = [];
  nextId = 0;
  /** Ink spent this turn, same count the server keeps (undo doesn't refund it). */
  spent = 0;

  private ctx = this.el.getContext("2d")!;
  private scale = 1;
  private resize = new ResizeObserver(([entry]) => {
    const { width, height } = entry!.contentRect;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (!w || !h || (w === this.el.width && h === this.el.height)) return;
    this.el.width = w;
    this.el.height = h;
    this.scale = w / CANVAS_W;
    this.redraw();
  });

  constructor() {
    this.el.className = "sb-canvas";
    this.el.width = CANVAS_W;
    this.el.height = CANVAS_H;
    this.resize.observe(this.el);
    this.redraw();
  }

  destroy() {
    this.resize.disconnect();
  }

  reset(turn: number, strokes: Stroke[] = [], nextId = 0) {
    this.turn = turn;
    this.strokes = structuredClone(strokes);
    this.nextId = nextId;
    this.spent = strokes.reduce((n, s) => n + s.points.length / 2, 0);
    this.redraw();
  }

  apply(op: DrawOp) {
    switch (op.op) {
      case "start": {
        const s = { id: op.id, color: op.color, size: op.size, points: [...op.points] };
        this.strokes.push(s);
        this.nextId = op.id + 1;
        this.spent += op.points.length / 2;
        this.paint(s);
        break;
      }
      case "add": {
        const last = this.strokes.at(-1);
        if (!last || last.id !== op.id) return;
        const from = last.points.length / 2 - 1;
        last.points.push(...op.points);
        this.spent += op.points.length / 2;
        this.paint(last, from);
        break;
      }
      case "undo":
        this.strokes.pop();
        this.redraw();
        break;
      case "clear":
        this.strokes = [];
        this.redraw();
        break;
    }
  }

  /** Screen position → page coordinates, clamped to the page. */
  toPage(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CANVAS_W;
    const y = ((e.clientY - r.top) / r.height) * CANVAS_H;
    return [Math.round(Math.min(Math.max(x, 0), CANVAS_W)), Math.round(Math.min(Math.max(y, 0), CANVAS_H))];
  }

  private redraw() {
    const c = this.ctx;
    c.fillStyle = PALETTE[0]!;
    c.fillRect(0, 0, this.el.width, this.el.height);
    for (const s of this.strokes) this.paint(s);
  }

  /** Paints a stroke from point `from` on: whole strokes, or just a new chunk's tail. */
  private paint(s: Stroke, from = 0) {
    const c = this.ctx;
    const k = this.scale;
    const p = s.points;
    const n = p.length / 2;
    c.strokeStyle = c.fillStyle = PALETTE[s.color] ?? "#000";
    c.lineWidth = SIZES[s.size]! * k;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (n === 1) {
      c.beginPath();
      c.arc(p[0]! * k, p[1]! * k, c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(p[from * 2]! * k, p[from * 2 + 1]! * k);
    for (let i = from + 1; i < n; i++) c.lineTo(p[i * 2]! * k, p[i * 2 + 1]! * k);
    c.stroke();
  }
}
