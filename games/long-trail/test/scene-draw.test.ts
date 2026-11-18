import { describe, expect, it } from "vitest";
import type { Art } from "../client/scene/art.ts";
import { drawBackdrop, type View } from "../client/scene/backdrop.ts";
import { SCENES, type Stagehand } from "../client/scene/events/index.ts";
import { ticks, walkFrame } from "../client/scene/events/fx.ts";
import type { Terrain } from "../client/scene/model.ts";
import {
  drawCamel,
  drawFire,
  drawGate,
  drawHouse,
  drawRider,
  drawStall,
  drawTent,
  drawTraveller,
} from "../client/scene/sprites.ts";
import type { EventOutcome } from "../shared/events.ts";
import { SCENE_IDS, type SceneId } from "../shared/pack.ts";
import type { Health } from "../shared/types.ts";
import { fakeCtx } from "./scene-fake-ctx.ts";

const art: Art = { far: {}, clouds: [] };
const view: View = { w: 400, h: 100, ground: 78, s: 100 / 150 };
const TERRAINS: Terrain[] = ["desert", "mountain", "river", "plain", "town", "market", "gate"];
const FRAMES = [0, 0.5, 0.99];

describe("scene drawing", () => {
  it("every terrain draws", () => {
    for (const terrain of TERRAINS)
      for (const fork of [true, false])
        for (const night of [true, false])
          for (const scroll of [0, 10_000]) {
            const f = fakeCtx();
            expect(() => drawBackdrop(f.ctx, art, view, terrain, scroll, { fork, night })).not.toThrow();
            expect(f.count("fill"), `${terrain} fork=${fork} scroll=${scroll}`).toBeGreaterThan(0);
          }
  });

  it("every sprite draws", () => {
    const f = fakeCtx();
    const c = f.ctx;
    for (const frame of FRAMES) {
      for (const load of ["normal", "high", "none"] as const) drawCamel(c, 50, 80, 1, frame, load);
      for (const health of [1, 2, 3] as Health[])
        for (const riding of [true, false])
          for (const down of [false, true])
            drawTraveller(c, 50, 80, 1, frame, { color: "#c0392b", health, riding, alpha: 0.5, down });
      drawTent(c, 50, 80, 1);
      drawFire(c, 50, 80, 1, frame);
      drawStall(c, 50, 80, 1, 30);
      drawHouse(c, 50, 80, 1);
      drawGate(c, 50, 80, 1);
      drawRider(c, 50, 80, 1, frame, 1);
      drawRider(c, 50, 80, 1, frame, -1);
    }
    expect(f.count("fill")).toBeGreaterThan(0);
  });

  it("save and restore stay paired", () => {
    const f = fakeCtx();
    drawBackdrop(f.ctx, art, view, "river", 123, { fork: true, night: false });
    drawTraveller(f.ctx, 50, 80, 1, 0.3, { color: "#123456", health: 1, riding: false, alpha: 1 });
    drawCamel(f.ctx, 50, 80, 1, 0.3, "high");
    drawRider(f.ctx, 50, 80, 1, 0.3, -1);
    expect(f.count("save")).toBe(f.count("restore"));
  });
});

const HARSH: EventOutcome = {
  healthChanges: [{ playerId: "p2", from: 3, to: 2 }],
  stock: { animals: -1, coins: -10, food: -5 },
  km: 0,
  scoutSaved: false,
  cargo: -2,
  lucky: false,
};
const TS = [0, 0.25, 0.5, 0.75, 1];

function hand(c: CanvasRenderingContext2D, t: number, loop: boolean, outcome: EventOutcome | null, terrain?: Terrain, ms = 4000): Stagehand {
  return {
    c,
    v: view,
    t,
    ms: loop ? Infinity : ms,
    loop,
    outcome,
    caravan: { x0: 30, x1: 200 },
    target: outcome?.healthChanges.length ? { id: "p2", x: 150 } : null,
    terrain,
    camels: 2,
    camelX: [80, 30],
    walkers: [110, 130, 150, 170].map((x, i) => ({ id: `p${i}`, x })),
  };
}

function drawAll(id: SceneId, h: Stagehand) {
  const sc = SCENES[id];
  return { pose: sc.pose?.(h) ?? {}, back: sc.back?.(h), front: sc.front?.(h) };
}

describe("event scenes", () => {
  it("every scene draws through its beat", () => {
    for (const id of SCENE_IDS) {
      const sc = SCENES[id];
      expect(sc, id).toBeDefined();
      expect(sc.still).toBeGreaterThanOrEqual(0);
      expect(sc.still).toBeLessThanOrEqual(1);
      for (const t of TS)
        for (const loop of [false, true])
          for (const outcome of [null, HARSH])
            for (const terrain of [undefined, "mountain", "river"] as const) {
              const f = fakeCtx();
              expect(() => drawAll(id, hand(f.ctx, t, loop, outcome, terrain)), `${id} t=${t} loop=${loop}`).not.toThrow();
              expect(f.count("save"), `${id} save/restore`).toBe(f.count("restore"));
            }
    }
  });

  it("a situation loops cleanly", () => {
    for (const id of SCENE_IDS) {
      const pose = SCENES[id].pose;
      if (!pose) continue;
      for (const outcome of [null, HARSH]) {
        const a = pose(hand(fakeCtx().ctx, 0, true, outcome));
        const b = pose(hand(fakeCtx().ctx, 1, true, outcome));
        expect(b, id).toEqual(a);
      }
    }
  });

  it("a situation loop draws the same at t = 0 and t = 1", () => {
    for (const id of SCENE_IDS)
      for (const terrain of [undefined, "mountain", "river", "desert"] as const) {
        const a = fakeCtx();
        const b = fakeCtx();
        drawAll(id, hand(a.ctx, 0, true, null, terrain));
        drawAll(id, hand(b.ctx, 1, true, null, terrain));
        expect(b.trace, `${id} ${terrain}`).toEqual(a.trace);
      }
  });

  it("an event beat ends with the caravan in its own place", () => {
    for (const id of SCENE_IDS) {
      const p = SCENES[id].pose?.(hand(fakeCtx().ctx, 1, false, null)) ?? {};
      expect(p.dx ?? 0, id).toBe(0);
      expect(p.crouch ?? false, id).toBe(false);
      expect(p.facing ?? 1, id).toBe(1);
    }
  });

  it("the outcome decides the ending", () => {
    const end = (id: SceneId, outcome: EventOutcome | null, t = 1) => SCENES[id].pose?.(hand(fakeCtx().ctx, t, false, outcome)) ?? {};
    expect(end("camel-trouble", HARSH).hideCamel).toBe(0);
    expect(end("camel-trouble", null).hideCamel).toBeUndefined();
    expect(end("thief", null).night).toBe(true);
    // Robbers ride off with a pack only when something was lost.
    const fills = (outcome: EventOutcome | null) => {
      const f = fakeCtx();
      drawAll("robbers", hand(f.ctx, 0.8, false, outcome));
      return f.count("fill");
    };
    expect(fills(HARSH)).toBeGreaterThan(fills(null));
    const mild: EventOutcome = { ...HARSH, stock: {}, cargo: 0 };
    expect(fills(mild)).toBe(fills(null));
  });

  it("a situation loop never shows the loss", () => {
    for (const id of SCENE_IDS)
      for (const t of [0.2, 0.5, 0.8]) {
        const run = (outcome: EventOutcome | null) => {
          const x = fakeCtx();
          const r = drawAll(id, hand(x.ctx, t, true, outcome));
          return { pose: r.pose, trace: x.trace };
        };
        expect(run(HARSH), `${id} t=${t}`).toEqual(run(null));
      }
    expect(SCENES["camel-trouble"].pose?.(hand(fakeCtx().ctx, 0.5, true, null)).hideCamel).toBe(0);
  });

  it("camel trouble with no camels hides none and draws no camel", () => {
    for (const t of TS)
      for (const loop of [false, true])
        for (const outcome of [null, HARSH]) {
          const f = fakeCtx();
          const h = { ...hand(f.ctx, t, loop, outcome), camels: 0, camelX: [] };
          const { pose } = drawAll("camel-trouble", h);
          expect(pose.hideCamel).toBeUndefined();
          expect(f.count("save")).toBe(f.count("restore"));
          expect(f.count("save"), `t=${t}`).toBe(0); // drawCamel saves; nothing else here does
        }
  });

  it("the hurt traveller lies down", () => {
    const pose = (id: SceneId, t: number, outcome: EventOutcome | null) => SCENES[id].pose?.(hand(fakeCtx().ctx, t, false, outcome)) ?? {};
    expect(pose("sick", 0.6, HARSH).down).toBe("p2");
    expect(pose("sick", 0.6, null)).toEqual({});
    expect(pose("sick", 0.95, HARSH).down).toBeUndefined(); // up again before the beat ends
    expect(pose("water", 0.5, HARSH).down).toBe("p2");
    expect(pose("water", 0.9, HARSH).down).toBeUndefined();
    expect(pose("water", 0.5, null).down).toBeUndefined();
  });

  it("leak: the traveller nearest the bag walks back, ties it, and returns", () => {
    const pose = (t: number) => SCENES.leak.pose?.(hand(fakeCtx().ctx, t, false, null)) ?? {};
    expect(pose(0.1)).toEqual({});
    expect(pose(0.5).move).toMatchObject({ id: "p0", facing: -1, crouch: true });
    expect(pose(0.5).move!.x).toBeLessThan(110);
    expect(pose(0.9)).toEqual({});
    expect(pose(0.5).crouch).toBeUndefined(); // the others keep walking
  });

  it("camel trouble: the camel walks out from its place and back with no jump", () => {
    const at = (t: number) => {
      const f = fakeCtx();
      SCENES["camel-trouble"].back!(hand(f.ctx, t, false, null));
      return f.trace.find((x) => x.startsWith("translate("));
    };
    expect(at(0)).toBe("translate(80,78)"); // the lead camel's own place
    expect(at(0.999)).toMatch(/^translate\(80(\.\d+)?,78\)$/);
    expect(SCENES["camel-trouble"].pose!(hand(fakeCtx().ctx, 1, false, null)).hideCamel).toBeUndefined();
  });

  it("flicker changes at most 3 times a second, timed to the real beat", () => {
    // An event beat, a choice's result, and a situation loop.
    for (const [loop, ms] of [[false, 4000], [false, 5000], [true, 2400]] as const) {
      let changes = 0;
      let last = ticks(hand(fakeCtx().ctx, 0, loop, null, undefined, ms));
      for (let i = 1; i <= 1000; i++) {
        const k = ticks(hand(fakeCtx().ctx, i / 1000, loop, null, undefined, ms));
        if (k !== last) changes++;
        last = k;
      }
      expect(changes, `ms=${ms} loop=${loop}`).toBeLessThanOrEqual((3 * ms) / 1000);
      expect(changes, `ms=${ms} loop=${loop}`).toBeGreaterThanOrEqual((3 * ms) / 1000 - 1);
    }
  });

  it("walk frames follow the real beat length", () => {
    const a = walkFrame(hand(fakeCtx().ctx, 1, false, null, undefined, 4000));
    const b = walkFrame(hand(fakeCtx().ctx, 1, false, null, undefined, 5000));
    expect(b / a).toBeCloseTo(5 / 4);
  });
});
