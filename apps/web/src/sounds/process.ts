// Phone-side work on a sound the host picks for "My sounds": checks, mono,
// the cut, and even loudness. Pure: no DOM and no encoder here (see encode.ts).

/** Every clip is decoded at this rate, so it is also the rate we encode at. */
export const SAMPLE_RATE = 48000;
/** The longest cut we keep. The encoder adds about 50 ms and the server's cap is 3000 ms. */
export const HOST_CUT_S = 2.9;
/** Refused before decoding: a long song decodes to hundreds of MB. */
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const TARGET_RMS_DB = -16;
export const PEAK_DB = -1.5;
export const MAX_GAIN_DB = 24;
/** Below this RMS a clip counts as silent and is left as it is. */
export const SILENT_RMS = 1e-4;

export const TOO_LONG = "This sound is too long. We will keep 3 seconds.";
export const NOT_A_SOUND = "This file is not a sound we can use.";
export const TOO_BIG = "This file is too big. Pick a file under 4 MB.";

const NAME_MAX = 24;

export function checkInput(file: { size: number }): string | null {
  if (file.size > MAX_INPUT_BYTES) return TOO_BIG;
  if (file.size <= 0) return NOT_A_SOUND;
  return null;
}

/** The mean of the channels, sample by sample, as long as the shortest one. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return new Float32Array(channels[0]!);
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) out[i]! += c[i]!;
  const n = channels.length;
  for (let i = 0; i < length; i++) out[i]! /= n;
  return out;
}

export function clipWindow(lengthS: number, startS: number): { start: number; duration: number; cut: boolean } {
  const latest = Math.max(0, lengthS - HOST_CUT_S);
  const clamped = Math.min(Math.max(Number.isFinite(startS) ? startS : 0, 0), latest);
  // Round to 0.1 s, but never past the latest start (rounding up could).
  let start = Math.round(clamped * 10) / 10;
  if (start > latest) start = Math.floor(latest * 10) / 10;
  return { start, duration: Math.min(lengthS, HOST_CUT_S), cut: lengthS > HOST_CUT_S };
}

/** A new array with the RMS moved toward TARGET_RMS_DB, capped by the peak limit and MAX_GAIN_DB. */
export function evenLoudness(samples: Float32Array): Float32Array {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  if (!(rms >= SILENT_RMS) || !(peak > 0)) return new Float32Array(samples);
  const rmsDb = 20 * Math.log10(rms);
  const gain = Math.min(10 ** ((TARGET_RMS_DB - rmsDb) / 20), 10 ** (PEAK_DB / 20) / peak, 10 ** (MAX_GAIN_DB / 20));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * gain;
  return out;
}

export interface PreparedClip {
  samples: Float32Array;
  sampleRate: number;
  ms: number;
  cut: boolean;
}

/** Mono, then the cut from `startS`, then even loudness. */
export function prepareClip(input: { channels: readonly Float32Array[]; sampleRate: number }, startS: number): PreparedClip {
  const { sampleRate } = input;
  const mono = toMono(input.channels);
  const win = clipWindow(mono.length / sampleRate, startS);
  const from = Math.min(mono.length, Math.round(win.start * sampleRate));
  const to = Math.min(mono.length, from + Math.round(win.duration * sampleRate));
  const samples = evenLoudness(mono.subarray(from, to));
  return { samples, sampleRate, ms: Math.round((samples.length / sampleRate) * 1000), cut: win.cut };
}

/** A name from the file name: no extension, `_` and `-` as spaces, at most 24 characters. */
export function defaultName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
  let name = base.replace(/[_-]+/g, " ").trim().slice(0, NAME_MAX);
  // Never end on half of a surrogate pair (an emoji cut in two).
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) name = name.slice(0, -1);
  return name.trim();
}
