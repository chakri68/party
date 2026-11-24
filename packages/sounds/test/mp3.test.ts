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
    expect(readMp3(fakeMp3())).toEqual({ ms: 2400, mono: true, sampleRate: 48000, frames: 100, trailing: 0 });
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
  it("skips an Info header frame without counting it", () => {
    for (const o of [{}, { mono: false }, { mpeg2: true }, { mpeg2: true, mono: false }]) {
      const r = readMp3(fakeMp3({ ...o, info: true, frames: 10 }));
      expect(r?.frames).toBe(10);
      expect(r?.ms).toBe(240);
    }
  });
  it("reports trailing bytes after junk", () => {
    const junk = new Uint8Array(50).fill(1);
    expect(readMp3(join(fakeMp3({ frames: 5 }), junk, fakeMp3({ frames: 5 })))).toMatchObject({
      frames: 5,
      trailing: 50 + 5 * 192,
    });
    const tag = new Uint8Array(128);
    tag.set([0x54, 0x41, 0x47]);
    expect(readMp3(join(fakeMp3({ frames: 5 }), tag))?.trailing).toBe(0);
  });
  it("reads MPEG2.5 frames", () => {
    const b = new Uint8Array(192 * 10);
    for (let i = 0; i < 10; i++) b.set([0xff, 0xe3, 0x44, 0xc4], i * 192);
    expect(readMp3(b)).toMatchObject({ ms: 480, sampleRate: 12000, frames: 10 });
  });
  it("is null for a huge ID3 size on a short buffer", () => {
    expect(readMp3(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f, 0xff, 0xfb, 0x54, 0xc4]))).toBeNull();
  });
  it("is null for bitrate index 15 and rate index 3", () => {
    expect(readMp3(Uint8Array.from([0xff, 0xfb, 0xf4, 0xc4, ...new Array(200).fill(0)]))).toBeNull();
    expect(readMp3(Uint8Array.from([0xff, 0xfb, 0x5c, 0xc4, ...new Array(200).fill(0)]))).toBeNull();
  });
});
