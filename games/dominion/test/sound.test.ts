import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audio, DUCK_ATTACK_S, DUCK_RELEASE_S } from "@games/audio";
import { createSound, type Sound } from "../client/sound.ts";

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

let listeners: { type: string; fn: () => void }[] = [];
let sounds: Sound[] = [];
let saved: typeof audio.settings;

beforeEach(() => {
  made = [];
  listeners = [];
  sounds = [];
  saved = audio.settings;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: () => void) => listeners.push({ type, fn }),
    removeEventListener: (type: string, fn: () => void) => {
      listeners = listeners.filter((l) => l.type !== type || l.fn !== fn);
    },
  });
  audio.settings = { ...saved, sound: true, volume: 0.7 };
  audio.duck(1);
});

afterEach(() => {
  for (const s of sounds) s.destroy();
  audio.duck(1);
  audio.settings = saved;
  vi.unstubAllGlobals();
});

function made_(): Sound {
  const sound = createSound();
  sounds.push(sound);
  return sound;
}

function woken() {
  const sound = made_();
  listeners[0]!.fn();
  const ctx = made[0]!;
  const out = ctx.gains.find((g) => g.to === ctx.destination)!;
  return { sound, ctx, out };
}

/** The last ramp, checking the old schedule was dropped first at the same time. */
function lastRamp(out: Gain, ctx: FakeContext) {
  const g = out.gain;
  expect(g.cancelScheduledValues).toHaveBeenLastCalledWith(ctx.currentTime);
  const cancelAt = g.cancelScheduledValues.mock.invocationCallOrder.at(-1)!;
  const rampAt = g.setTargetAtTime.mock.invocationCallOrder.at(-1)!;
  expect(cancelAt).toBeLessThan(rampAt);
  return g.setTargetAtTime.mock.calls.at(-1)!;
}

describe("Dominion sound", () => {
  it("starts at the ducked volume when made while ducked", () => {
    audio.duck(0.35);
    const { out } = woken();
    expect(out.gain.value).toBeCloseTo(0.7 * 0.35 * 0.8);
  });

  it("starts silent with Sound off", () => {
    audio.settings = { ...audio.settings, sound: false };
    const { out } = woken();
    expect(out.gain.value).toBe(0);
  });

  it("the output gain follows gameVolume, ducked and back", () => {
    const { ctx, out } = woken();
    expect(out.gain.value).toBeCloseTo(0.7 * 0.8);

    audio.duck(0.35);
    const [down, downAt, downK] = lastRamp(out, ctx);
    expect(down).toBeCloseTo(0.7 * 0.35 * 0.8);
    expect([downAt, downK]).toEqual([ctx.currentTime, DUCK_ATTACK_S]);

    audio.duck(1);
    const [up, upAt, upK] = lastRamp(out, ctx);
    expect(up).toBeCloseTo(0.7 * 0.8);
    expect([upAt, upK]).toEqual([ctx.currentTime, DUCK_RELEASE_S]);

    // A later wake (each play wakes) does not snap the gain over a ramp.
    audio.duck(0.35);
    const calls = out.gain.setTargetAtTime.mock.calls.length;
    out.gain.value = 0.5;
    listeners[0]!.fn();
    expect(out.gain.value).toBe(0.5);
    expect(out.gain.setTargetAtTime.mock.calls.length).toBe(calls);
  });

  it("a new volume jumps there at once, keeping the duck", () => {
    const { ctx, out } = woken();
    audio.duck(0.35);
    const ramps = out.gain.setTargetAtTime.mock.calls.length;
    audio.update({ volume: 0.4 });
    expect(out.gain.setTargetAtTime.mock.calls.length).toBe(ramps);
    expect(out.gain.cancelScheduledValues).toHaveBeenLastCalledWith(ctx.currentTime);
    expect(out.gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.4 * 0.35 * 0.8), ctx.currentTime);
    expect(out.gain.value).toBeCloseTo(0.4 * 0.35 * 0.8);
    // The same settings again change nothing.
    const sets = out.gain.setValueAtTime.mock.calls.length;
    audio.update({ volume: 0.4 });
    expect(out.gain.setValueAtTime.mock.calls.length).toBe(sets);
  });

  it("Sound off silences it at once, and on brings it back", () => {
    const { ctx, out } = woken();
    audio.update({ sound: false });
    expect(out.gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(out.gain.value).toBe(0);
    audio.duck(0.35);
    expect(out.gain.value).toBe(0);
    audio.update({ sound: true });
    expect(out.gain.value).toBeCloseTo(0.7 * 0.35 * 0.8);
  });

  it("stops following once dropped", () => {
    const { sound, out } = woken();
    sound.destroy();
    const calls = out.gain.setTargetAtTime.mock.calls.length;
    audio.duck(0.35);
    expect(out.gain.setTargetAtTime.mock.calls.length).toBe(calls);
    expect(made).toHaveLength(1);
  });

  it("dropped before a tap: no gesture listeners are left", () => {
    const sound = made_();
    expect(listeners.map((l) => l.type).sort()).toEqual(["keydown", "pointerdown"]);
    sound.destroy();
    expect(listeners).toEqual([]);
    expect(made).toHaveLength(0);
  });
});
