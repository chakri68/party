export declare function readMp3(
  bytes: Uint8Array,
): { ms: number; mono: boolean; sampleRate: number; frames: number } | null;
