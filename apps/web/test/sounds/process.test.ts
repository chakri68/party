import { HOST_SOUND_MAX_BYTES, MAX_SOUND_MS } from "@games/sounds/check";
import { readMp3 } from "@games/sounds/mp3";
import { describe, expect, it } from "vitest";
import { encodeMp3 } from "../../src/sounds/encode.ts";
import {
  HOST_CUT_S,
  MAX_GAIN_DB,
  MAX_INPUT_BYTES,
  NOT_A_SOUND,
  PEAK_DB,
  SAMPLE_RATE,
  TARGET_RMS_DB,
  TOO_BIG,
  checkInput,
  clipWindow,
  defaultName,
  evenLoudness,
  prepareClip,
  toMono,
} from "../../src/sounds/process.ts";

const RATE = 48000;

function sine(seconds: number, amp: number, hz = 440, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/** Noise from a small fixed LCG, so the test is the same every run. */
function noise(seconds: number, amp: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let s = 12345;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = amp * ((s / 2 ** 32) * 2 - 1);
  }
  return out;
}

function rmsDb(x: Float32Array): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  return 20 * Math.log10(Math.sqrt(sum / x.length));
}

function peak(x: Float32Array): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

/** Scales a buffer so its RMS is exactly `db` dBFS. */
function atRms(x: Float32Array, db: number): Float32Array {
  const k = 10 ** ((db - rmsDb(x)) / 20);
  return x.map((v) => v * k);
}

describe("phone-side sound processing", () => {
  it("checkInput refuses a file over 4 MB", () => {
    expect(MAX_INPUT_BYTES).toBe(4 * 1024 * 1024);
    expect(checkInput({ size: 0 })).toBe(NOT_A_SOUND);
    expect(checkInput({ size: 4 * 1024 * 1024 + 1 })).toBe(TOO_BIG);
    expect(checkInput({ size: 4 * 1024 * 1024 })).toBeNull();
    expect(checkInput({ size: 1000 })).toBeNull();
  });

  it("toMono averages the channels", () => {
    expect(Array.from(toMono([new Float32Array([1, 1]), new Float32Array([0, -1])]))).toEqual([0.5, 0]);
    expect(Array.from(toMono([new Float32Array([1, 1, 1]), new Float32Array([1, 0])]))).toEqual([1, 0.5]);
  });

  it("clipWindow", () => {
    expect(clipWindow(10, 4)).toEqual({ start: 4, duration: 2.9, cut: true });
    expect(clipWindow(10, 9.5).start).toBe(7.1);
    expect(clipWindow(2, 1)).toEqual({ start: 0, duration: 2, cut: false });
    expect(clipWindow(10, -3).start).toBe(0);
    expect(clipWindow(10, 1.234).start).toBe(1.2);
  });

  it("prepareClip keeps at most 2.9 s from the start picked", () => {
    const left = sine(10, 0.3, 440);
    const right = sine(10, 0.2, 660);
    const clip = prepareClip({ channels: [left, right], sampleRate: RATE }, 4);
    expect(clip.samples.length).toBe(Math.round(HOST_CUT_S * RATE));
    expect(clip.sampleRate).toBe(SAMPLE_RATE);
    expect(clip.ms).toBe(2900);
    expect(clip.cut).toBe(true);
    // The gain is the same for every sample: find it from a sample that is clearly non-zero.
    const at = 4 * RATE;
    const mono = (i: number) => (left[at + i]! + right[at + i]!) / 2;
    let probe = 1;
    while (Math.abs(mono(probe)) < 0.05) probe++;
    const gain = clip.samples[probe]! / mono(probe);
    expect(gain).toBeGreaterThan(0);
    expect(clip.samples[0]).toBeCloseTo(gain * mono(0), 6);
    expect(clip.samples[10]).toBeCloseTo(gain * mono(10), 6);
  });

  it("prepareClip of a long input still gives at most 2.9 s", () => {
    const clip = prepareClip({ channels: [sine(30, 0.5)], sampleRate: RATE }, 0);
    expect(clip.ms).toBeLessThanOrEqual(2900);
    expect(clip.samples.length).toBeLessThanOrEqual(Math.round(HOST_CUT_S * RATE));
    expect(clip.cut).toBe(true);
  });

  it("prepareClip of a long stereo input cuts the right part, from the shortest channel", () => {
    // 60 s on the left, a bit less on the right: the window follows the shorter one.
    const left = noise(60, 0.2);
    const right = sine(59.5, 0.1, 330);
    const keepL = left.slice(), keepR = right.slice();
    const clip = prepareClip({ channels: [left, right], sampleRate: RATE }, 100);
    const n = Math.round(HOST_CUT_S * RATE);
    expect(clip.samples.length).toBe(n);
    // The latest start in 0.1 s steps: 59.5 - 2.9 = 56.6 s.
    const from = Math.round(56.6 * RATE);
    const mono = (i: number) => (left[from + i]! + right[from + i]!) / 2;
    const gain = clip.samples[0]! / mono(0);
    expect(gain).toBeGreaterThan(0);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(clip.samples[i]! - gain * mono(i)));
    expect(worst).toBeLessThan(1e-5);
    // The input is left as it was.
    const same = (x: Float32Array, y: Float32Array) => Buffer.from(x.buffer).equals(Buffer.from(y.buffer));
    expect(same(left, keepL) && same(right, keepR)).toBe(true);
  });

  it("prepareClip of a short input keeps it whole", () => {
    const clip = prepareClip({ channels: [sine(1, 0.5)], sampleRate: RATE }, 0.5);
    expect(clip.samples.length).toBe(RATE);
    expect(clip.ms).toBe(1000);
    expect(clip.cut).toBe(false);
  });

  it("evenLoudness lifts a quiet clip to the target", () => {
    const quiet = atRms(sine(1, 0.5), -40);
    const out = evenLoudness(quiet);
    expect(out).not.toBe(quiet);
    const want = Math.min(TARGET_RMS_DB, -40 + MAX_GAIN_DB);
    expect(Math.abs(rmsDb(out) - want)).toBeLessThan(0.5);
    expect(rmsDb(quiet)).toBeCloseTo(-40, 3);
  });

  it("evenLoudness turns down a loud clip", () => {
    const loud = atRms(noise(1, 1), -6).map((v) => Math.max(-0.5, Math.min(0.5, v)));
    const out = evenLoudness(loud);
    expect(rmsDb(out)).toBeLessThanOrEqual(TARGET_RMS_DB + 0.5);
  });

  it("never goes over the peak limit", () => {
    const square = new Float32Array(RATE).map((_, i) => (Math.floor(i / 50) % 2 === 0 ? 0.99 : -0.99));
    const out = evenLoudness(square);
    expect(peak(out)).toBeLessThanOrEqual(10 ** (PEAK_DB / 20) + 1e-6);
  });

  it("gain is at most +24 dB", () => {
    const faint = atRms(noise(1, 1), -60);
    const out = evenLoudness(faint);
    expect(Math.abs(rmsDb(out) - -36)).toBeLessThan(0.5);
  });

  it("a silent clip stays silent", () => {
    const out = evenLoudness(new Float32Array(1000));
    expect(out.every((v) => v === 0)).toBe(true);
    expect(out.some((v) => Number.isNaN(v))).toBe(false);
    const empty = evenLoudness(new Float32Array(0));
    expect(empty.length).toBe(0);
  });

  it("defaultName", () => {
    expect(defaultName("air_horn-2.mp3")).toBe("air horn 2");
    expect(defaultName("a".repeat(40) + ".wav")).toHaveLength(24);
    expect(defaultName(".mp3")).toBe("");
    expect(defaultName("my.song.final.m4a")).toBe("my.song.final");
    expect(defaultName("  __boom--  ")).toBe("boom");
    // A character outside the BMP across the 24th place is dropped whole, not cut in half.
    const wide = String.fromCodePoint(0x1f600);
    const cutAtWide = defaultName("a".repeat(23) + wide + "b.mp3");
    expect(cutAtWide).toBe("a".repeat(23));
    expect(defaultName("a".repeat(22) + wide + "b.mp3")).toBe("a".repeat(22) + wide);
  });

  it("the real encoder makes a mono mp3 under the caps", async () => {
    const bytes = await encodeMp3(prepareClip({ channels: [sine(10, 0.5)], sampleRate: RATE }, 0));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThanOrEqual(HOST_SOUND_MAX_BYTES);
    const info = readMp3(bytes);
    expect(info).not.toBeNull();
    expect(info!.mono).toBe(true);
    expect(info!.sampleRate).toBe(48000);
    expect(info!.ms).toBeLessThanOrEqual(MAX_SOUND_MS);
    expect(info!.ms).toBeGreaterThan(2800);
    expect(info!.trailing).toBeLessThanOrEqual(128);
  });
});
