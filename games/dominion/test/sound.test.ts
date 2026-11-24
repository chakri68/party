import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audio, DUCK_ATTACK_S, DUCK_RELEASE_S } from "@games/audio";
import { createSound } from "../client/sound.ts";

// Voice phase 3 Task 5: Dominion's own output gain follows audio.gameVolume().

class Node {
  connect(to: unknown): unknown {
    return to;
  }
}

class Gain extends Node {
  gain = {
    value: 1,
    setTargetAtTime: vi.fn((_v: number, _t: number, _k: number) => {}),
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((v: number) => {
      this.gain.value = v;
    }),
  };
  override connect(to: unknown): unknown {
    this.to = to;
    return to;
  }
  to: unknown = null;
}

let made: FakeContext[] = [];

class FakeContext {
  state = "running";
  currentTime = 3;
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
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

let wakers: (() => void)[] = [];

beforeEach(() => {
  made = [];
  wakers = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("window", {
    addEventListener: (_type: string, fn: () => void) => wakers.push(fn),
  });
  audio.settings.volume = 0.7;
  audio.duck(1);
});

afterEach(() => {
  audio.duck(1);
  vi.unstubAllGlobals();
});

function woken() {
  const sound = createSound();
  wakers[0]!();
  const ctx = made[0]!;
  const out = ctx.gains.find((g) => g.to === ctx.destination)!;
  return { sound, ctx, out };
}

describe("Dominion sound", () => {
  it("starts at the ducked volume when made while ducked", () => {
    audio.duck(0.35);
    const { sound, out } = woken();
    expect(out.gain.value).toBeCloseTo(0.7 * 0.35 * 0.8);
    sound.destroy();
  });

  it("the output gain follows gameVolume, ducked and back", () => {
    const { sound, ctx, out } = woken();
    expect(out.gain.value).toBeCloseTo(0.7 * 0.8);

    audio.duck(0.35);
    expect(out.gain.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.7 * 0.35 * 0.8), ctx.currentTime, DUCK_ATTACK_S);

    audio.duck(1);
    expect(out.gain.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.7 * 0.8), ctx.currentTime, DUCK_RELEASE_S);

    // A later wake (each play wakes) does not snap the gain over a ramp.
    audio.duck(0.35);
    const calls = out.gain.setTargetAtTime.mock.calls.length;
    out.gain.value = 0.5;
    wakers[1]!();
    expect(out.gain.value).toBe(0.5);
    expect(out.gain.setTargetAtTime.mock.calls.length).toBe(calls);
    sound.destroy();
  });

  it("stops following once dropped", () => {
    const { sound, out } = woken();
    sound.destroy();
    const calls = out.gain.setTargetAtTime.mock.calls.length;
    audio.duck(0.35);
    expect(out.gain.setTargetAtTime.mock.calls.length).toBe(calls);
    wakers[1]?.();
    expect(made).toHaveLength(1);
  });
});
