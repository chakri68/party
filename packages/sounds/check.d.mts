export declare const SOUND_ID_RE: RegExp;
export declare const SOUND_ID_MAX: number;
export declare const MAX_SOUND_MS: number;
export declare const SOUND_NAME_MAX: number;
export declare function soundId(name: string): string;
export declare function checkEntries(
  entries: unknown[],
  opts: { pack: "free" | "memes"; fileExists?: (file: string) => boolean },
): string[];
export declare const HOST_PACK: "host";
export declare const HOST_SLOTS: 6;
export declare const HOST_SOUND_MAX_BYTES: 65536;
export declare function isHostSlot(v: unknown): v is string;
export declare function cleanSoundName(v: unknown): string | null;
