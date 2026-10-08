// What a player's view looks like on the wire. Most of a map is empty fields
// (no resource, no improvement, nobody's land), so a tile leaves out whatever
// is at its default, and a visible tile leaves out `seen` (it's this round).
// That keeps the largest view, fog lifted on a full 32×32 map, well inside the
// 128 KiB budget (§17). The client fills the defaults back in on arrival.

import type { DominionPrivateState, KnownTile } from "./types.ts";

/** A tile with its default fields left out. */
export type PackedTile = Partial<Omit<KnownTile, "t">> & Pick<KnownTile, "t">;

export type WirePrivateState = Omit<DominionPrivateState, "tiles"> & {
  tiles: (PackedTile | null)[];
  /** The round, so visible tiles can drop `seen`. */
  round: number;
};

export function packTile(t: KnownTile): PackedTile {
  const p: PackedTile = { t: t.t };
  if (t.res !== null) p.res = t.res;
  if (t.imp !== null) p.imp = t.imp;
  if (t.road) p.road = true;
  if (t.feat !== null) p.feat = t.feat;
  if (t.owner !== null) p.owner = t.owner;
  if (t.vis) p.vis = true;
  else p.seen = t.seen;
  if (t.tended) p.tended = true;
  if (t.myc) p.myc = t.myc;
  return p;
}

export function unpackTile(p: PackedTile, round: number): KnownTile {
  const t: KnownTile = {
    t: p.t,
    res: p.res ?? null,
    imp: p.imp ?? null,
    road: p.road ?? false,
    feat: p.feat ?? null,
    owner: p.owner ?? null,
    vis: p.vis ?? false,
    seen: p.vis ? round : (p.seen ?? -1),
  };
  if (p.tended) t.tended = true;
  if (p.myc) t.myc = p.myc;
  return t;
}

export function packView(view: DominionPrivateState, round: number): WirePrivateState {
  return { ...view, round, tiles: view.tiles.map((t) => (t ? packTile(t) : null)) };
}

export function unpackView(wire: WirePrivateState): DominionPrivateState {
  const { round, ...rest } = wire;
  return { ...rest, tiles: wire.tiles.map((t) => (t ? unpackTile(t, round) : null)) };
}
