// The web side: the list plus the URL of each clip. The clips are bundled by Vite.
export * from "./list.ts";

const urls = import.meta.glob<string>("../free/*.mp3", { eager: true, query: "?url", import: "default" });

/** The URL of a listed file, or null. */
export function freeSoundUrl(file: string): string | null {
  return urls[`../free/${file}`] ?? null;
}
