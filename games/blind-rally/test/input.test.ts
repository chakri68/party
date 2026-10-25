import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_GAP_MS, NEUTRAL, Sender, TICK_MS } from "../client/driver/input.ts";
import type { ControlInput } from "../shared/types.ts";

// The Driver's sender, on a fake clock: 25 Hz while held, edges at once (but
// spaced), neutral repeated briefly and then silence, nothing while parked.

describe("driver sender", () => {
  let sent: ControlInput[];
  let sender: Sender;
  const GAS = { steer: 0, throttle: 1, brake: 0 };

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    sender = new Sender((d) => sent.push(d), () => Date.now());
  });
  afterEach(() => {
    sender.destroy();
    vi.useRealTimers();
  });

  it("sends nothing until live, then the held state at once", () => {
    sender.update(GAS);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([]);
    sender.setLive(true);
    expect(sent).toEqual([{ t: "in", seq: 1, ...GAS }]);
  });

  it("repeats at ~25 Hz while held", () => {
    sender.setLive(true);
    sender.update(GAS);
    sent = [];
    vi.advanceTimersByTime(1_000);
    expect(sent.length).toBeGreaterThanOrEqual(22);
    expect(sent.length).toBeLessThanOrEqual(26);
  });

  it("sends an edge immediately, and spaces bursts of them", () => {
    sender.setLive(true);
    sent = [];
    vi.advanceTimersByTime(TICK_MS * 3);
    sender.update(GAS);
    expect(sent.at(-1)).toMatchObject(GAS);
    sender.update(NEUTRAL);
    sender.update(GAS);
    // Too soon after the last: one deferred send, with the latest state.
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(MIN_GAP_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject(GAS);
  });

  it("stays under the server's 40/s whatever the thumbs do", () => {
    sender.setLive(true);
    for (let i = 0; i < 200; i++) {
      sender.update(i % 2 ? GAS : NEUTRAL);
      vi.advanceTimersByTime(5);
    }
    // 200 × 5 ms = 1 s of mashing.
    expect(sent.length).toBeLessThanOrEqual(37);
  });

  it("goes neutral on release, repeats it briefly, then falls quiet", () => {
    sender.setLive(true);
    sender.update(GAS);
    vi.advanceTimersByTime(200);
    sender.update(NEUTRAL);
    vi.advanceTimersByTime(MIN_GAP_MS);
    expect(sent.at(-1)).toMatchObject(NEUTRAL);
    const n = sent.length;
    vi.advanceTimersByTime(2_000);
    expect(sent.length - n).toBeLessThanOrEqual(8);
    expect(sent.slice(n).every((s) => s.throttle === 0 && s.steer === 0)).toBe(true);
  });

  it("numbers strictly upward, carrying on from the server's count after a reload", () => {
    sender.catchUp(41);
    sender.setLive(true);
    sender.update(GAS);
    vi.advanceTimersByTime(200);
    const seqs = sent.map((s) => s.seq);
    expect(seqs[0]).toBe(42);
    expect(seqs.every((q, i) => i === 0 || q > seqs[i - 1]!)).toBe(true);
  });
});
