export type Pack = "free" | "memes";
export type SoundCommand =
  | { cmd: "add"; input: string; name: string; pack?: Pack; start?: number; end?: number; source?: string; licence?: string; local: boolean }
  | { cmd: "list"; pack?: Pack; local: boolean }
  | { cmd: "remove"; id: string; pack?: Pack; local: boolean }
  | { cmd: "help" };

export const MAX_CUT_S: number;
export const LOUDNESS: string;
export const MEMES_BUCKET: string;
export const MEMES_PREFIX: string;

export function parseSoundArgs(argv: string[]): SoundCommand;
export function cutWindow(start?: number, end?: number): { start: number; duration: number };
export function ffmpegArgs(input: string, output: string, cut: { start: number; duration: number }): string[];
export function withEntry<T extends { id: string }>(list: T[], entry: T): T[];
export function withoutEntry<T extends { id: string }>(list: T[], id: string): T[];

export interface SoundIO {
  root: string;
  run(cmd: string, args: string[], opts?: { cwd?: string }): { status: number | null; stdout: string; stderr: string };
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: string | Uint8Array): void;
  remove(path: string): void;
  exists(path: string): boolean;
  tempDir(): string;
  download(url: string, to: string): Promise<void>;
  askPack(): Promise<Pack>;
  log(line: string): void;
}

export function runSound(cmd: SoundCommand, io: SoundIO): Promise<void>;
