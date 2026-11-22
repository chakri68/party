export declare const SOUND_ID_RE: RegExp;
export declare const SOUND_ID_MAX: number;
export declare const MAX_SOUND_MS: number;
export declare const SOUND_NAME_MAX: number;
export declare function soundId(name: string): string;
export declare function checkEntries(
  entries: unknown[],
  opts: { pack: "free" | "memes"; fileExists?: (file: string) => boolean },
): string[];
