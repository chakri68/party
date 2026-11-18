// The Kenney images for the far layers and the clouds (CC0, see
// ../assets/LICENSES.md). The far layers come pale blue; each is tinted once,
// at load, into the colour of the land it stands for. Nothing loads at import.
import { PALETTES } from "./backdrop.ts";
import type { Terrain } from "./model.ts";

export interface Art {
  far: Partial<Record<Terrain, CanvasImageSource>>;
  clouds: CanvasImageSource[];
}

/** Which far layer each file is. A terrain with no file is drawn in code. */
const FAR: Record<string, Terrain[]> = {
  "mountains.png": ["mountain"],
  "hills.png": ["plain", "town", "market"],
  "hillsLarge.png": ["river", "gate"],
};

const urls = import.meta.glob<string>("../assets/kenney/*.png", { eager: true, query: "?url", import: "default" });

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The image in one flat colour, with a little of the pale original left as haze. */
function tint(img: HTMLImageElement, color: string): CanvasImageSource {
  try {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    if (!c) return img;
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalAlpha = 0.22;
    c.drawImage(img, 0, 0);
    return cv;
  } catch {
    return img;
  }
}

let loading: Promise<Art> | null = null;

/**
 * Never rejects. A missing or broken file is left out, and the code draws that
 * layer. Loads once: every scene shares the one promise.
 */
export function loadArt(): Promise<Art> {
  return (loading ??= build());
}

async function build(): Promise<Art> {
  const art: Art = { far: {}, clouds: [] };
  const clouds: [string, HTMLImageElement][] = [];
  // One tinted copy per file and colour: town and market share one.
  const tinted = new Map<string, CanvasImageSource>();
  try {
    await Promise.all(
      Object.entries(urls).map(async ([path, url]) => {
        const name = path.slice(path.lastIndexOf("/") + 1);
        const img = await load(url);
        if (!img) return;
        if (name.startsWith("cloud")) clouds.push([name, img]);
        for (const t of FAR[name] ?? []) {
          const key = `${name}|${PALETTES[t].far}`;
          if (!tinted.has(key)) tinted.set(key, tint(img, PALETTES[t].far));
          art.far[t] = tinted.get(key)!;
        }
      }),
    );
  } catch {
    // Keep whatever loaded.
  }
  art.clouds = clouds.sort((a, b) => a[0].localeCompare(b[0])).map(([, img]) => img);
  return art;
}
