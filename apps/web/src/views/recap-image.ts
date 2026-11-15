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
    for (const a of recap.awards) {
      if (!text(a.title, 28, 700, accent, 6)) break;
      if (!text(joinNames(a.who), 46, 700, ink, 6)) break;
      if (!text(a.line, 30, 400, muted, 40)) break;
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
