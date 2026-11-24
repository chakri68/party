import { describe, expect, it } from "vitest";
import { readMp3 } from "../mp3.mjs";
import { fakeMp3 } from "./mp3-fixture.ts";

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("readMp3", () => {
  it("reads mono 48 kHz frames", () => {
    expect(readMp3(fakeMp3())).toEqual({ ms: 2400, mono: true, sampleRate: 48000, frames: 100 });
  });
  it("sees stereo", () => {
    expect(readMp3(fakeMp3({ mono: false }))?.mono).toBe(false);
  });
  it("skips an ID3v2 tag", () => {
    expect(readMp3(fakeMp3({ id3: true }))?.frames).toBe(100);
  });
  it("MPEG2 frames are 576 samples", () => {
    expect(readMp3(fakeMp3({ mpeg2: true, frames: 50 }))?.ms).toBe(1200);
  });
  it("stops at ID3v1 and at junk", () => {
    const tag = new Uint8Array(128);
    tag.set([0x54, 0x41, 0x47]);
    expect(readMp3(join(fakeMp3(), tag))?.frames).toBe(100);
    const junk = Uint8Array.from({ length: 50 }, (_, i) => (i * 7) % 200);
    expect(readMp3(join(fakeMp3(), junk))?.frames).toBe(100);
  });
  it("counts a frame cut off by the end", () => {
    const b = fakeMp3({ frames: 3 });
    expect(readMp3(b.subarray(0, b.length - 50))?.frames).toBe(3);
  });
  it("is null for bytes that are not mp3", () => {
    expect(readMp3(new Uint8Array())).toBeNull();
    expect(readMp3(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(readMp3(new Uint8Array(1000))).toBeNull();
    expect(readMp3(Uint8Array.from([0xff, 0xfd, 0x54, 0xc4, ...new Array(200).fill(0)]))).toBeNull();
  });
  it("a 3.1 s file reads over the limit", () => {
    expect(readMp3(fakeMp3({ frames: 130 }))?.ms).toBe(3120);
  });
});
