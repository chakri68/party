import type { THAction, TreasureLayout } from "../../shared/types.ts";
import { DOT_RANGE } from "../../shared/world.ts";

// The map's maths, with no DOM so the tests can run it. A view is a window on
// the world: a centre, how many metres fit across the short side, and the
// canvas size in CSS px. North (−Z) is up, so world z grows down the screen
// just like canvas y.

export interface MapView {
  cx: number;
  cz: number;
  /** Metres across the shorter of w and h. */
  metresAcross: number;
  /** CSS px. */
  w: number;
  h: number;
}

export interface MapPoint {
  px: number;
  py: number;
}

export interface WorldXZ {
  x: number;
  z: number;
}

/** What draw() puts over the base map. */
export type Overlay =
  | { kind: "dot"; x: number; z: number; color: string; mate: boolean }
  | { kind: "me"; x: number; z: number; yaw: number }
  | { kind: "pin"; x: number; z: number; color: string; mine: boolean };

/** A click within this many px of my own pin takes it away. */
export const PIN_PICK_PX = 12;

/** CSS px per metre. */
const scale = (v: MapView) => Math.min(v.w, v.h) / v.metresAcross;

export function worldToMap(p: WorldXZ, v: MapView): MapPoint {
  const s = scale(v);
  return { px: v.w / 2 + (p.x - v.cx) * s, py: v.h / 2 + (p.z - v.cz) * s };
}

export function mapToWorld(p: MapPoint, v: MapView): WorldXZ {
  const s = scale(v);
  return { x: v.cx + (p.px - v.w / 2) / s, z: v.cz + (p.py - v.h / 2) / s };
}

/** The whole macro grid in a size×size square: the full map. */
export function islandView(l: TreasureLayout, size: number): MapView {
  const { origin, cell, size: n } = l.macro;
  const across = cell * (n - 1);
  return { cx: origin + across / 2, cz: origin + across / 2, metresAcross: across, w: size, h: size };
}

export interface Dot extends WorldXZ {
  id: string;
  team: number;
  mate: boolean;
}

/**
 * Who goes on the map. Teammates always; other teams only within DOT_RANGE
 * of me in XZ, and not at all before I have a position. Nobody's hidden for
 * being in a buggy or spectating: their last snapshot is where they are.
 * Anyone with no team (they left) and `meId` are skipped.
 */
export function visibleDots(
  me: WorldXZ | null,
  others: ReadonlyMap<string, WorldXZ>,
  teamOf: (id: string) => number | null,
  myTeam: number | null,
  meId?: string,
): Dot[] {
  const dots: Dot[] = [];
  for (const [id, p] of others) {
    if (id === meId) continue;
    const team = teamOf(id);
    if (team === null) continue;
    const mate = myTeam !== null && team === myTeam;
    if (!mate && (!me || Math.hypot(p.x - me.x, p.z - me.z) > DOT_RANGE)) continue;
    dots.push({ id, x: p.x, z: p.z, team, mate });
  }
  return dots;
}

/** The id of my nearest pin within PIN_PICK_PX of the click, or null. */
export function pickPin(click: MapPoint, myPins: readonly ({ id: string } & WorldXZ)[], v: MapView): string | null {
  let best: string | null = null;
  let bestD = PIN_PICK_PX;
  for (const pin of myPins) {
    const at = worldToMap(pin, v);
    const d = Math.hypot(at.px - click.px, at.py - click.py);
    if (d <= bestD) {
      best = pin.id;
      bestD = d;
    }
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10 + 0;

/** A click on the full map: on my own pin it goes, anywhere else a pin goes down. */
export function clickAction(click: MapPoint, myPins: readonly ({ id: string } & WorldXZ)[], v: MapView): THAction {
  const hit = pickPin(click, myPins, v);
  if (hit !== null) return { type: "unpin", pinId: hit };
  const w = mapToWorld(click, v);
  return { type: "pin", x: round1(w.x), z: round1(w.z) };
}
