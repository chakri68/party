import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Feedback } from "../src/index.ts";

class Node {
  readonly connected: unknown[] = [];
  connect(to: unknown): unknown {
    this.connected.push(to);
    return to;
  }
}

class Gain extends Node {
  gain = { value: 1 };
}

class Source extends Node {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  readonly starts: unknown[][] = [];
  start(...args: unknown[]): void {
    this.starts.push(args);
  }
}

let made: FakeContext[] = [];

class FakeContext {
  state = "running";
  currentTime = 2;
  sampleRate = 48000;
  readonly destination = new Node();
  readonly gains: Gain[] = [];
  readonly sources: Source[] = [];
  decodeFails = false;
  constructor() {
    made.push(this);
  }
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
    return this.decodeFails ? Promise.reject(new Error("bad file")) : Promise.resolve({ decoded: bytes.byteLength });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  addEventListener(): void {}
}

const buf = {} as AudioBuffer;

beforeEach(() => {
  made = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clip playback", () => {
  it("roomSounds is on by default", () => {
    expect(new Feedback().settings.roomSounds).toBe(true);
  });

  it("playClip plays through the game volume once unlocked", () => {
    const fb = new Feedback();
    fb.unlock();
    const ctx = made[0]!;
    expect(fb.playClip(buf)).toBe(true);
    expect(ctx.sources).toHaveLength(1);
    const src = ctx.sources[0]!;
    const master = ctx.gains.find((g) => g.gain.value === fb.settings.volume * 0.9);
    expect(master).toBeDefined();
    expect(src.connected).toEqual([master]);
    expect(src.buffer).toBe(buf);
    expect(src.playbackRate.value).toBe(1);
    expect(src.starts).toEqual([[ctx.currentTime + 0.005]]);
  });

  it("playClip is silent before unlock, with game sound off, or while suspended", () => {
    const before = new Feedback();
    expect(before.playClip(buf)).toBe(false);
    expect(made).toHaveLength(0);

    const off = new Feedback();
    off.settings = { ...off.settings, sound: false };
    off.unlock();
    expect(off.playClip(buf)).toBe(false);
    expect(made[0]!.sources).toHaveLength(0);

    const asleep = new Feedback();
    asleep.unlock();
    made[1]!.state = "suspended";
    expect(asleep.playClip(buf)).toBe(false);
    expect(made[1]!.sources).toHaveLength(0);
  });

  it("decode gives null without a context or on a bad file", async () => {
    const bytes = new ArrayBuffer(4);
    expect(await new Feedback().decode(bytes)).toBeNull();

    const fb = new Feedback();
    fb.unlock();
    expect(await fb.decode(bytes)).toEqual({ decoded: 4 });
    made[0]!.decodeFails = true;
    expect(await fb.decode(bytes)).toBeNull();
    made[0]!.decodeAudioData = () => {
      throw new Error("old browser");
    };
    expect(await fb.decode(bytes)).toBeNull();
  });
});
