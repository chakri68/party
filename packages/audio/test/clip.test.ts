import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Feedback } from "../src/index.ts";

class Node {
  readonly connected: unknown[] = [];
  connect(to: unknown): unknown {
    this.connected.push(to);
    return to;
  }
}

class Param {
  value = 1;
  readonly calls: string[] = [];
  cancelScheduledValues(): void {
    this.calls.push("cancel");
  }
  setValueAtTime(v: number): void {
    this.calls.push("set");
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.calls.push("target");
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {}
}

class Gain extends Node {
  gain = new Param();
}

class Osc extends Node {
  type = "sine";
  frequency = new Param();
  start(): void {}
  stop(): void {}
}

class Filter extends Node {
  type = "lowpass";
  frequency = { value: 0 };
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
  createOscillator(): Osc {
    return new Osc();
  }
  createBiquadFilter(): Filter {
    return new Filter();
  }
  createBuffer(_ch: number, len: number): unknown {
    return { getChannelData: () => new Float32Array(len) };
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
    const master = ctx.gains[0]!;
    expect(master.gain.value).toBeCloseTo(fb.settings.volume * 0.9);
    expect(fb.playClip(buf)).toBe(true);
    expect(ctx.sources).toHaveLength(1);
    const src = ctx.sources[0]!;
    const clipGain = src.connected[0] as Gain;
    expect(clipGain.connected).toEqual([master]);
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

  it("a clip goes through its own gain set to boardVolume, then master", () => {
    const fb = new Feedback();
    fb.unlock();
    const ctx = made[0]!;
    const master = ctx.gains[0]!;
    fb.update({ boardVolume: 0.4 });
    expect(fb.playClip(buf)).toBe(true);
    const src = ctx.sources[0]!;
    expect(src.connected).toHaveLength(1);
    const clipGain = src.connected[0] as Gain;
    expect(clipGain).not.toBe(master);
    expect(clipGain.gain.value).toBe(0.4);
    expect(clipGain.connected).toEqual([master]);
  });

  it("boardVolume 0 plays nothing audible but still counts as played", () => {
    const fb = new Feedback();
    fb.unlock();
    fb.update({ boardVolume: 0 });
    expect(fb.playClip(buf)).toBe(true);
    expect((made[0]!.sources[0]!.connected[0] as Gain).gain.value).toBe(0);
  });

  it("game sounds do not use boardVolume", () => {
    const fb = new Feedback();
    fb.unlock();
    const ctx = made[0]!;
    fb.update({ boardVolume: 0.4 });
    fb.play("card-place");
    expect(ctx.gains.some((g) => g.gain.value === 0.4)).toBe(false);
  });

  it("a boardVolume change leaves master and the game volume alone", () => {
    const fb = new Feedback();
    fb.unlock();
    const master = made[0]!.gains[0]!;
    fb.duck(0.35);
    const before = { calls: master.gain.calls.length, value: master.gain.value, game: fb.gameVolume() };
    fb.update({ boardVolume: 0.2 });
    expect(master.gain.calls).toHaveLength(before.calls);
    expect(master.gain.value).toBe(before.value);
    expect(fb.gameVolume()).toBe(before.game);
  });

  it("old saved settings without boardVolume read as 1; bad values are clamped", () => {
    const read = (saved: unknown) => {
      vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved), setItem: () => {} });
      return new Feedback().settings.boardVolume;
    };
    expect(read({ sound: true, volume: 0.5, haptics: true, roomSounds: true })).toBe(1);
    expect(read({ boardVolume: 0.3 })).toBe(0.3);
    expect(read({ boardVolume: 3 })).toBe(1);
    expect(read({ boardVolume: -2 })).toBe(0);
    expect(read({ boardVolume: "loud" })).toBe(1);
    expect(read({ boardVolume: null })).toBe(1);
    expect(new Feedback().settings.boardVolume).toBe(1);
  });

  it("update clamps boardVolume to 0..1", () => {
    const fb = new Feedback();
    fb.update({ boardVolume: 5 });
    expect(fb.settings.boardVolume).toBe(1);
    fb.update({ boardVolume: Number.NaN });
    expect(fb.settings.boardVolume).toBe(1);
    fb.update({ boardVolume: -1 });
    expect(fb.settings.boardVolume).toBe(0);
  });
});
