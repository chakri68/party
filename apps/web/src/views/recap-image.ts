// The recap as a picture, for the group chat. Same words and order as the
// recap screen. The drawing is thin; the layout rules are the pure helpers.

import type { Recap } from "@games/game-core";
import { joinNames, momentText, recapMeta } from "./recap.ts";

export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
/** The margin on every side. */
export const IMAGE_PAD = 80;
/** Kept free at the bottom for the site line. */
export const IMAGE_SITE_ROOM = 150;

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

/** The "Around the table" heading and the loudest moment line, at scale 1. */
export const BODY_SIZES = { heading: 34, moment: 32 } as const;
/** The moment line wraps to at most 2 lines. */
const MOMENT_LINES = 2;

export interface BodyText {
  awards: AwardText[];
  table: AwardText[];
  moment: string | null;
}

export interface BodyLayout {
  scale: number;
  awards: AwardBlock[];
  table: AwardBlock[];
  /** Empty when there is no moment, or it was dropped to make room. */
  moment: string[];
  height: number;
}

/** Line height for text of base size n at this scale. */
const lineHeight = (n: number, scale: number) => Math.round(Math.round(n * scale) * 1.25);

/**
 * Fit the awards, the table awards (under their heading) and the moment line
 * in maxHeight. Shrinks the text step by step; names wrap to at most 3 lines
 * and the line to 2, and end in "…" when cut. It shrinks further rather than
 * cut a name, and drops the moment line before it cuts a name. When nothing
 * else fits, it drops the moment line before it cuts a line to 1. A title is
 * never drawn without its names. measure(text, size, weight) gives the width
 * in px.
 */
export function layoutBody(
  body: BodyText,
  maxWidth: number,
  maxHeight: number,
  measure: (s: string, size: number, weight: number) => number,
): BodyLayout {
  const build = (scale: number, lineMax: number, withMoment: boolean) => {
    const size = (n: number) => Math.round(n * scale);
    const lh = (n: number) => lineHeight(n, scale);
    let namesCut = false;
    const fit = (text: string, base: number, weight: number, max: number) => {
      const m = (t: string) => measure(t, size(base), weight);
      const all = wrapLines(text, maxWidth, m);
      return { cut: all.length > max, lines: limitLines(all, max, maxWidth, m) };
    };
    const blocks = (list: AwardText[]) =>
      list.map((a) => {
        const who = fit(a.who, AWARD_SIZES.who, 700, WHO_LINES);
        if (who.cut) namesCut = true;
        return {
          title: fit(a.title, AWARD_SIZES.title, 700, 1).lines,
          who: who.lines,
          line: fit(a.line, AWARD_SIZES.line, 400, lineMax).lines,
        };
      });
    const awards = blocks(body.awards);
    const table = blocks(body.table);
    const moment = withMoment && body.moment ? fit(body.moment, BODY_SIZES.moment, 400, MOMENT_LINES).lines : [];
    const blockHeight = (b: AwardBlock) =>
      b.title.length * lh(AWARD_SIZES.title) +
      b.who.length * lh(AWARD_SIZES.who) +
      b.line.length * lh(AWARD_SIZES.line) +
      AWARD_SIZES.inner * 2 * scale +
      AWARD_SIZES.gap * scale;
    const height =
      [...awards, ...table].reduce((sum, b) => sum + blockHeight(b), 0) +
      (table.length ? lh(BODY_SIZES.heading) + AWARD_SIZES.inner * 2 * scale : 0) +
      moment.length * lh(BODY_SIZES.moment);
    return { layout: { scale, awards, table, moment, height }, namesCut };
  };
  // Best first: everything with names whole, then without the moment, then
  // with names cut. Within each, the biggest scale that fits.
  const tries: [boolean, boolean][] = [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ];
  for (const [withMoment, wholeNames] of tries) {
    if (withMoment && !body.moment) continue;
    for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= 0.05) {
      const r = build(scale, 2, withMoment);
      if (r.layout.height <= maxHeight && (!wholeNames || !r.namesCut)) return r.layout;
    }
  }
  return build(MIN_SCALE, 1, false).layout;
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

  const pad = IMAGE_PAD;
  const maxW = IMAGE_WIDTH - pad * 2;
  const bottom = IMAGE_HEIGHT - IMAGE_SITE_ROOM;
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

  const measure = (t: string, size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${font}`;
    return ctx.measureText(t).width;
  };
  const toText = (a: Recap["awards"][number]): AwardText => ({ title: a.title, who: joinNames(a.who), line: a.line });
  const moment = recap.moment ? momentText(recap.moment, opts.gameName) : null;
  if (recap.quiet) text(recap.quiet, 40, 400, ink, 40);
  const body = layoutBody({ awards: recap.awards.map(toText), table: recap.table.map(toText), moment }, maxW, bottom - y, measure);
  const { scale } = body;
  const draw = (lines: string[], base: number, weight: number, color: string, gap: number) => {
    ctx.font = `${weight} ${Math.round(base * scale)}px ${font}`;
    ctx.fillStyle = color;
    for (const l of lines) {
      ctx.fillText(l, pad, y);
      y += lineHeight(base, scale);
    }
    y += gap * scale;
  };
  const drawBlock = (b: AwardBlock) => {
    draw(b.title, AWARD_SIZES.title, 700, accent, AWARD_SIZES.inner);
    draw(b.who, AWARD_SIZES.who, 700, ink, AWARD_SIZES.inner);
    draw(b.line, AWARD_SIZES.line, 400, muted, AWARD_SIZES.gap);
  };
  body.awards.forEach(drawBlock);
  if (body.table.length) {
    draw(["Around the table"], BODY_SIZES.heading, 700, ink, AWARD_SIZES.inner * 2);
    body.table.forEach(drawBlock);
  }
  draw(body.moment, BODY_SIZES.moment, 400, ink, 0);

  ctx.font = `400 32px ${font}`;
  ctx.fillStyle = muted;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(opts.site, pad, IMAGE_HEIGHT - pad);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}
