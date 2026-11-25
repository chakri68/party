// The recap as a picture, for the group chat. Same words and order as the
// recap screen. The drawing is thin; the layout rules are the pure helpers.

import type { Recap } from "@games/game-core";
import { joinNames, recapMeta } from "./recap.ts";

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;

/** Split text into lines that each fit maxWidth. A word wider than a line is cut. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Keep at most maxLines lines; the last kept line ends with "…" when text was cut. */
export function limitLines(lines: string[], maxLines: number, maxWidth: number, measure: (s: string) => number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last.length > 0 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

export interface AwardText {
  title: string;
  who: string;
  line: string;
}

export interface AwardBlock {
  title: string[];
  who: string[];
  line: string[];
}

/** Text sizes at scale 1, and the smallest scale we shrink to. */
export const AWARD_SIZES = { title: 28, who: 46, line: 30, gap: 40, inner: 6 } as const;
export const MIN_SCALE = 0.5;
/** Names get 3 lines: three 20-letter names need that much at full size. */
export const WHO_LINES = 3;

/**
 * Fit every award in maxHeight. Shrinks the text step by step; names wrap to
 * at most 3 lines and the line to 2, and end in "…" when cut. It shrinks
 * further rather than cut a name, while that still fits. A title is never
 * drawn without its names. measure(text, size, weight) gives the width in px.
 */
export function layoutAwards(
  awards: AwardText[],
  maxWidth: number,
  maxHeight: number,
  measure: (s: string, size: number, weight: number) => number,
): { scale: number; blocks: AwardBlock[] } {
  const build = (scale: number, lineMax: number) => {
    const size = (n: number) => Math.round(n * scale);
    let namesCut = false;
    const fit = (text: string, base: number, weight: number, max: number) => {
      const m = (t: string) => measure(t, size(base), weight);
      const all = wrapLines(text, maxWidth, m);
      return { cut: all.length > max, lines: limitLines(all, max, maxWidth, m) };
    };
    const blocks = awards.map((a) => {
      const who = fit(a.who, AWARD_SIZES.who, 700, WHO_LINES);
      if (who.cut) namesCut = true;
      return {
        title: fit(a.title, AWARD_SIZES.title, 700, 1).lines,
        who: who.lines,
        line: fit(a.line, AWARD_SIZES.line, 400, lineMax).lines,
      };
    });
    const lh = (n: number) => Math.round(size(n) * 1.25);
    const height = blocks.reduce(
      (sum, b) =>
        sum +
        b.title.length * lh(AWARD_SIZES.title) +
        b.who.length * lh(AWARD_SIZES.who) +
        b.line.length * lh(AWARD_SIZES.line) +
        AWARD_SIZES.inner * 2 * scale +
        AWARD_SIZES.gap * scale,
      0,
    );
    return { blocks, height, namesCut };
  };
  // First the biggest scale where every name fits whole; else the biggest that fits at all.
  let firstFit: { scale: number; blocks: AwardBlock[] } | null = null;
  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= 0.05) {
    const r = build(scale, 2);
    if (r.height > maxHeight) continue;
    if (!r.namesCut) return { scale, blocks: r.blocks };
    firstFit ??= { scale, blocks: r.blocks };
  }
  if (firstFit) return firstFit;
  return { scale: MIN_SCALE, blocks: build(MIN_SCALE, 1).blocks };
}

export interface RecapImageOptions {
  appTitle: string;
  gameName: (id: string) => string;
  site: string;
}

function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

export async function recapImage(recap: Recap, opts: RecapImageOptions): Promise<Blob> {
  await document.fonts?.ready;
  const style = getComputedStyle(document.documentElement);
  const bg = token(style, "--bg", "#0e0e0c");
  const ink = token(style, "--ink", "#f3f1ea");
  const muted = token(style, "--muted", "#9c9888");
  const accent = token(style, "--accent", "#c6f432");
  const font = token(style, "--font", "system-ui, sans-serif");

  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");

  const pad = 80;
  const maxW = IMAGE_WIDTH - pad * 2;
  const bottom = IMAGE_HEIGHT - 150; // room for the site line
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  ctx.textBaseline = "top";

  let y = pad;
  /** Draw wrapped text; stops at the card's bottom edge. Returns false when it ran out of room. */
  const text = (s: string, size: number, weight: number, color: string, gap: number): boolean => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    const lh = Math.round(size * 1.25);
    for (const l of wrapLines(s, maxW, (t) => ctx.measureText(t).width)) {
      if (y + lh > bottom) return false;
      ctx.fillText(l, pad, y);
      y += lh;
    }
    y += gap;
    return true;
  };

  text(opts.appTitle, 40, 700, accent, 16);
  text("Tonight's recap", 76, 700, ink, 16);
  text(recapMeta(recap, opts.gameName), 34, 400, muted, 56);

  if (recap.awards.length) {
    const { scale, blocks } = layoutAwards(
      recap.awards.map((a) => ({ title: a.title, who: joinNames(a.who), line: a.line })),
      maxW,
      bottom - y,
      (t, size, weight) => {
        ctx.font = `${weight} ${size}px ${font}`;
        return ctx.measureText(t).width;
      },
    );
    const sz = (n: number) => Math.round(n * scale);
    const draw = (lines: string[], base: number, weight: number, color: string, gap: number) => {
      ctx.font = `${weight} ${sz(base)}px ${font}`;
      ctx.fillStyle = color;
      for (const l of lines) {
        ctx.fillText(l, pad, y);
        y += Math.round(sz(base) * 1.25);
      }
      y += gap * scale;
    };
    for (const b of blocks) {
      draw(b.title, AWARD_SIZES.title, 700, accent, AWARD_SIZES.inner);
      draw(b.who, AWARD_SIZES.who, 700, ink, AWARD_SIZES.inner);
      draw(b.line, AWARD_SIZES.line, 400, muted, AWARD_SIZES.gap);
    }
  } else {
    text(recap.quiet ?? "", 40, 400, ink, 0);
  }

  ctx.font = `400 32px ${font}`;
  ctx.fillStyle = muted;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(opts.site, pad, IMAGE_HEIGHT - pad);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}
