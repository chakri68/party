import { describe, expect, it } from "vitest";
import { VoiceWakeLock, type WakeDeps, type WakeSentinel } from "../../src/voice/wake.ts";
import { flush } from "./fake-rtc.ts";

class FakeSentinel implements WakeSentinel {
  released = false;
  private fns: (() => void)[] = [];
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    for (const fn of this.fns) fn();
  }
  addEventListener(_type: "release", fn: () => void): void {
    this.fns.push(fn);
  }
}

function setup(opts: { api?: boolean; refuse?: boolean } = {}) {
  const sentinels: FakeSentinel[] = [];
  let visible = true;
  let refuse = opts.refuse ?? false;
  let listeners: (() => void)[] = [];
  let requests = 0;
  const deps: WakeDeps = {
    request:
      opts.api === false
        ? null
        : async () => {
            requests++;
            if (refuse) throw Object.assign(new Error("no"), { name: "NotAllowedError" });
            const s = new FakeSentinel();
            sentinels.push(s);
            return s;
          },
    visible: () => visible,
    onVisibility: (fn) => {
      listeners.push(fn);
      return () => (listeners = listeners.filter((f) => f !== fn));
    },
  };
  const wake = new VoiceWakeLock(deps);
  const held = () => sentinels.filter((s) => !s.released).length;
  const show = (v: boolean) => {
    visible = v;
    for (const fn of listeners) fn();
  };
  return {
    wake,
    sentinels,
    held,
    show,
    requests: () => requests,
    listeners: () => listeners.length,
    setRefuse: (r: boolean) => (refuse = r),
  };
}

describe("VoiceWakeLock", () => {
  it("held while in voice and visible", async () => {
    const s = setup();
    await flush();
    expect(s.requests()).toBe(0);
    s.wake.set(true);
    await flush();
    expect(s.held()).toBe(1);
    // Asked again while held: no second lock.
    s.wake.set(true);
    s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(1);
    expect(s.held()).toBe(1);
  });

  it("released on set(false) and on destroy", async () => {
    const s = setup();
    s.wake.set(true);
    await flush();
    s.wake.set(false);
    await flush();
    expect(s.held()).toBe(0);
    s.wake.set(true);
    await flush();
    expect(s.held()).toBe(1);
    s.wake.destroy();
    await flush();
    expect(s.held()).toBe(0);
    expect(s.listeners()).toBe(0);
    s.wake.set(true);
    await flush();
    expect(s.held()).toBe(0);
  });

  it("a lock that arrives after set(false) is let go at once", async () => {
    const s = setup();
    s.wake.set(true);
    s.wake.set(false);
    await flush();
    expect(s.requests()).toBe(1);
    expect(s.held()).toBe(0);
  });

  it("released when the page hides, asked again when it comes back", async () => {
    const s = setup();
    s.wake.set(true);
    await flush();
    s.show(false);
    await flush();
    expect(s.held()).toBe(0);
    // Not asked while hidden.
    s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(1);
    s.show(true);
    await flush();
    expect(s.held()).toBe(1);
    expect(s.requests()).toBe(2);
    // The browser drops it on its own: taken again on the next visible.
    s.sentinels[1]!.release();
    await flush();
    expect(s.held()).toBe(0);
    s.show(false);
    s.show(true);
    await flush();
    expect(s.held()).toBe(1);
    // Not wanted: coming back does not ask.
    s.wake.set(false);
    s.show(false);
    s.show(true);
    await flush();
    expect(s.held()).toBe(0);
    expect(s.requests()).toBe(3);
  });

  it("no wakeLock API: does nothing", async () => {
    const s = setup({ api: false });
    expect(() => {
      s.wake.set(true);
      s.show(false);
      s.show(true);
      s.wake.set(false);
      s.wake.destroy();
    }).not.toThrow();
    await flush();
    expect(s.requests()).toBe(0);
  });

  it("a refused request does not throw or loop", async () => {
    const s = setup({ refuse: true });
    s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(1);
    // Every voice update calls set(true) again: no new request.
    for (let i = 0; i < 5; i++) s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(1);
    // The next visible asks again.
    s.setRefuse(false);
    s.show(false);
    s.show(true);
    await flush();
    expect(s.requests()).toBe(2);
    expect(s.held()).toBe(1);
    // A fresh set(true) after set(false) asks again too.
    s.setRefuse(true);
    s.wake.set(false);
    s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(3);
    expect(s.held()).toBe(0);
    s.wake.set(false);
    s.wake.set(true);
    await flush();
    expect(s.requests()).toBe(4);
  });

  it("a request or release that throws never reaches the caller", async () => {
    const throwing: WakeDeps = {
      request: () => {
        throw new Error("sync");
      },
      visible: () => {
        throw new Error("vis");
      },
      onVisibility: () => {
        throw new Error("on");
      },
    };
    expect(() => {
      const w = new VoiceWakeLock(throwing);
      w.set(true);
      w.set(false);
      w.destroy();
    }).not.toThrow();
    const bad: WakeSentinel = {
      release: () => Promise.reject(new Error("rel")),
      addEventListener: () => {},
    };
    const w = new VoiceWakeLock({ request: async () => bad, visible: () => true, onVisibility: () => () => {} });
    w.set(true);
    await flush();
    expect(() => w.set(false)).not.toThrow();
    await flush();
  });
});
