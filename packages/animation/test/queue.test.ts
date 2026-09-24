import { describe, expect, it } from "vitest";
import { AnimationQueue, motion } from "../src/index.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A batch whose animation finishes when we say so. */
function controllable(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  return {
    finish,
    batch: {
      animate: async () => {
        log.push(`animate ${name}`);
        await done;
      },
      settle: () => void log.push(`settle ${name}`),
    },
  };
}

describe("AnimationQueue", () => {
  it("animates then settles, strictly in order", async () => {
    const log: string[] = [];
    const q = new AnimationQueue();
    const a = controllable(log, "a");
    const b = controllable(log, "b");
    q.push(a.batch);
    q.push(b.batch);
    await tick();
    expect(log).toEqual(["animate a"]); // b waits its turn
    a.finish();
    await tick();
    await tick();
    expect(log).toEqual(["animate a", "settle a", "animate b"]);
    b.finish();
    await tick();
    expect(log.at(-1)).toBe("settle b");
  });

  it("skips animations for batches when it falls behind, but still settles each", async () => {
    const log: string[] = [];
    const q = new AnimationQueue(2);
    const first = controllable(log, "0");
    q.push(first.batch);
    const rest = [1, 2, 3, 4].map((i) => controllable(log, String(i)));
    for (const r of rest) q.push(r.batch);
    first.finish();
    for (const r of rest) r.finish();
    for (let i = 0; i < 10; i++) await tick();
    // 1 and 2 had ≥2 queued behind them: settled without animating.
    expect(log).toEqual(["animate 0", "settle 0", "settle 1", "settle 2", "animate 3", "settle 3", "animate 4", "settle 4"]);
  });

  it("clear() drops pending batches and stops the running one from settling", async () => {
    const log: string[] = [];
    const q = new AnimationQueue();
    const a = controllable(log, "a");
    const b = controllable(log, "b");
    q.push(a.batch);
    q.push(b.batch);
    await tick();
    q.clear();
    a.finish();
    await tick();
    await tick();
    expect(log).toEqual(["animate a"]);
  });

  it("settles immediately when motion is off", async () => {
    const log: string[] = [];
    const q = new AnimationQueue();
    motion.enabled = false;
    try {
      q.push(controllable(log, "a").batch);
      await tick();
      expect(log).toEqual(["settle a"]);
    } finally {
      motion.enabled = true;
    }
  });

  it("a throwing animation still settles", async () => {
    const log: string[] = [];
    const q = new AnimationQueue();
    q.push({ animate: async () => { throw new Error("boom"); }, settle: () => void log.push("settled") });
    await tick();
    await tick();
    expect(log).toEqual(["settled"]);
  });
});
