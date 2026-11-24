import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUCK_ATTACK_S, DUCK_GAIN, DUCK_RELEASE_S, Feedback } from "../src/index.ts";

class Node {
  connect(to: unknown): unknown {
    return to;
  }
}

class Gain extends Node {
  gain = {
    value: 1,
    setTargetAtTime: vi.fn((v: number, _t: number, _k: number) => {
      // Tests read the target as the value it heads to.
      this.target = v;
    }),
    cancelScheduledValues: vi.fn(),
  };
  target: number | null = null;
}

let made: FakeContext[] = [];

class FakeContext {
  state = "running";
  currentTime = 2;
  sampleRate = 48000;
  readonly destination = new Node();
  readonly gains: Gain[] = [];
  constructor() {
    made.push(this);
  }
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.reject(new Error("no"));
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  addEventListener(): void {}
}

beforeEach(() => {
  made = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function unlocked(volume = 0.7) {
  const fb = new Feedback();
  fb.settings = { ...fb.settings, volume };
  fb.unlock();
  const ctx = made[0]!;
  return { fb, ctx, master: ctx.gains[0]! };
}

describe("ducking", () => {
  it("exports the duck constants", () => {
    expect(DUCK_GAIN).toBe(0.35);
    expect(DUCK_ATTACK_S).toBe(0.05);
    expect(DUCK_RELEASE_S).toBe(0.25);
  });

  it("duck ramps master to volume x 0.9 x level with the attack constant", () => {
    const { fb, ctx, master } = unlocked(0.7);
    expect(master.gain.value).toBeCloseTo(0.7 * 0.9);
    fb.duck(DUCK_GAIN);
    expect(master.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    const [v, t, k] = master.gain.setTargetAtTime.mock.calls[0]!;
    expect(v).toBeCloseTo(0.7 * 0.9 * 0.35);
    expect(t).toBe(ctx.currentTime);
    expect(k).toBe(DUCK_ATTACK_S);
  });

  it("duck back to 1 uses the release constant", () => {
    const { fb, master } = unlocked(0.7);
    fb.duck(DUCK_GAIN);
    fb.duck(1);
    expect(master.gain.setTargetAtTime).toHaveBeenCalledTimes(2);
    const [v, , k] = master.gain.setTargetAtTime.mock.calls[1]!;
    expect(v).toBeCloseTo(0.7 * 0.9);
    expect(k).toBe(DUCK_RELEASE_S);
  });

  it("volume change while ducked keeps the duck, duck(1) restores it", () => {
    const { fb, master } = unlocked(0.7);
    fb.duck(DUCK_GAIN);
    master.gain.cancelScheduledValues.mockClear();
    fb.update({ volume: 0.4 });
    expect(master.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(master.gain.value).toBeCloseTo(0.4 * 0.9 * 0.35);
    fb.duck(1);
    expect(master.target).toBeCloseTo(0.4 * 0.9);
  });

  it("an old gain without setTargetAtTime gets the value", () => {
    const fb = new Feedback();
    fb.settings = { ...fb.settings, volume: 0.5 };
    fb.unlock();
    const master = made[0]!.gains[0]! as unknown as { gain: { value: number } };
    master.gain = { value: master.gain.value };
    fb.duck(DUCK_GAIN);
    expect(master.gain.value).toBeCloseTo(0.5 * 0.9 * 0.35);
    fb.update({ volume: 0.6 });
    expect(master.gain.value).toBeCloseTo(0.6 * 0.9 * 0.35);
  });

  it("duck before unlock applies once the context is made", () => {
    const fb = new Feedback();
    fb.settings = { ...fb.settings, volume: 0.8 };
    fb.duck(DUCK_GAIN);
    expect(made).toHaveLength(0);
    fb.unlock();
    expect(made[0]!.gains[0]!.gain.value).toBeCloseTo(0.8 * 0.9 * 0.35);
  });

  it("gameVolume and onGameVolume follow duck and update", () => {
    const fb = new Feedback();
    fb.settings = { ...fb.settings, volume: 0.6 };
    const seen: number[] = [];
    const off = fb.onGameVolume(() => seen.push(fb.gameVolume()));
    expect(fb.gameVolume()).toBeCloseTo(0.6);
    fb.duck(DUCK_GAIN);
    expect(fb.gameVolume()).toBeCloseTo(0.6 * 0.35);
    fb.update({ volume: 0.4 });
    expect(fb.gameVolume()).toBeCloseTo(0.4 * 0.35);
    fb.duck(1);
    expect(seen.map((n) => +n.toFixed(4))).toEqual([0.21, 0.14, 0.4]);
    off();
    fb.duck(DUCK_GAIN);
    expect(seen).toHaveLength(3);
  });

  it("a listener that throws does not stop the others", () => {
    const fb = new Feedback();
    const calls: string[] = [];
    fb.onGameVolume(() => {
      throw new Error("x");
    });
    fb.onGameVolume(() => calls.push("ok"));
    fb.duck(DUCK_GAIN);
    expect(calls).toEqual(["ok"]);
  });

  it("the same level twice does nothing", () => {
    const { fb, master } = unlocked(0.7);
    const seen: number[] = [];
    fb.onGameVolume(() => seen.push(1));
    fb.duck(1);
    expect(master.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
    fb.duck(DUCK_GAIN);
    fb.duck(DUCK_GAIN);
    expect(master.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });
});
