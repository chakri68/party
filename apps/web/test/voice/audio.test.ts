import { afterEach, describe, expect, it, vi } from "vitest";
import { audio } from "@games/audio";
import { Mic, nextSpeaking, PLAYBACK, Playback, type MicPrefs } from "../../src/voice/audio.ts";
import {
  FakeAudioEnv,
  FakeContext,
  FakeElementWithSink,
  FakeTrack,
  fakeStream,
} from "./fake-audio.ts";

const stream = (id = "s") => fakeStream([new FakeTrack(id)]);

function setup(mode: "graph" | "element" = "graph", ctx: FakeContext | null = new FakeContext()) {
  const env = new FakeAudioEnv(ctx);
  const playback = new Playback(env, { mode });
  return { env, ctx, playback };
}

describe("PLAYBACK", () => {
  it("is the spec's graph path, with element-only as the documented fallback", () => {
    expect(PLAYBACK.mode).toBe("graph");
  });
});

describe("Playback, graph mode", () => {
  it("each stream gets a muted element and a gain node into the shared context", () => {
    const { env, ctx, playback } = setup();
    const s = stream();
    playback.attach("p1", s);
    expect(env.elements).toHaveLength(1);
    expect(env.elements[0]!.muted).toBe(true);
    expect(env.elements[0]!.srcObject).toBe(s);
    expect(env.elements[0]!.plays).toBe(1);
    const c = ctx!;
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.stream).toBe(s);
    // voiceOut is the first gain made; the peer's gain is the second.
    const [voiceOut, peerGain] = c.gains;
    expect(voiceOut!.connected).toContain(c.destination);
    expect(c.sources[0]!.connected).toContain(peerGain);
    expect(peerGain!.connected).toContain(voiceOut);
    expect(peerGain!.connected).toContain(c.analysers[0]);
    expect(c.analysers[0]!.fftSize).toBe(256);
  });

  it("streams attached before the context exists play once it does", () => {
    const { env, playback } = setup("graph", null);
    playback.attach("p1", stream());
    expect(env.elements[0]!.muted).toBe(true);
    expect(env.elements[0]!.plays).toBe(1);
    const ctx = env.makeContext();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.gains).toHaveLength(2);
    // Another statechange does not build the graph twice.
    env.setState("running");
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.gains).toHaveLength(2);
  });

  it("effective gain is zero unless allowed and not deafened", () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream());
    const g = ctx!.gains[1]!;
    expect(g.gain.value).toBe(0); // default: not allowed
    playback.setAllowed("p1", true);
    expect(g.gain.value).toBe(1);
    playback.setGain("p1", 1.5);
    expect(g.gain.value).toBe(1.5);
    playback.setDeafened(true);
    expect(g.gain.value).toBe(0);
    playback.setDeafened(false);
    expect(g.gain.value).toBe(1.5);
    playback.setAllowed("p1", false);
    expect(g.gain.value).toBe(0);
    playback.setAllowed("p1", true);
    playback.setGain("p1", 0);
    expect(g.gain.value).toBe(0);
  });

  it("clamps the user gain to 0..1.5", () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.setAllowed("p1", true);
    playback.setGain("p1", 9);
    expect(ctx!.gains[1]!.gain.value).toBe(1.5);
    playback.setGain("p1", -1);
    expect(ctx!.gains[1]!.gain.value).toBe(0);
  });

  it("accepts setAllowed before attach and plays once the stream arrives", () => {
    const { ctx, playback } = setup();
    playback.setAllowed("p1", true);
    playback.setGain("p1", 0.5);
    playback.attach("p1", stream());
    expect(ctx!.gains[1]!.gain.value).toBe(0.5);
  });

  it("detach disconnects the nodes and never closes the context", () => {
    const { env, ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.detach("p1");
    expect(ctx!.sources[0]!.disconnected).toBe(true);
    expect(ctx!.gains[1]!.disconnected).toBe(true);
    expect(ctx!.analysers[0]!.disconnected).toBe(true);
    expect(env.elements[0]!.srcObject).toBeNull();
    expect(ctx!.closed).toBe(false);
    expect(playback.levels().has("p1")).toBe(false);
    playback.detach("p1"); // twice is fine
    playback.destroy();
    expect(ctx!.closed).toBe(false);
  });

  it("detach keeps the user gain, so a rebuilt link is still muted for me", () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.setAllowed("p1", true);
    playback.setGain("p1", 0.3);
    playback.detach("p1");
    playback.attach("p1", stream());
    playback.setAllowed("p1", true);
    expect(ctx!.gains[ctx!.gains.length - 1]!.gain.value).toBeCloseTo(0.3);
    playback.detach("p1");
    playback.setGain("p1", 0);
    playback.attach("p1", stream());
    playback.setAllowed("p1", true);
    expect(ctx!.gains[ctx!.gains.length - 1]!.gain.value).toBe(0);
  });

  it("destroy disconnects voiceOut and survives a throwing onChange listener", async () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.destroy();
    expect(ctx!.gains[0]!.disconnected).toBe(true);
    const e2 = new FakeAudioEnv(null);
    const p2 = new Playback(e2, { mode: "graph" });
    p2.onChange(() => {
      throw new Error("listener");
    });
    expect(() => e2.makeContext()).not.toThrow();
  });

  it("attaching a new stream for the same peer replaces the old graph", () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream("a"));
    playback.attach("p1", stream("b"));
    expect(ctx!.sources[0]!.disconnected).toBe(true);
    expect(ctx!.sources).toHaveLength(2);
    expect(playback.levels().size).toBe(1);
  });

  it("destroy tears every peer down and ignores later context events", () => {
    const { env, ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.attach("p2", stream());
    playback.destroy();
    expect(ctx!.sources.every((s) => s.disconnected)).toBe(true);
    expect(env.elements.every((e) => e.srcObject === null)).toBe(true);
    env.setState("running");
    expect(ctx!.sources).toHaveLength(2);
  });

  it("levels are the RMS of the analyser, per peer", () => {
    const { ctx, playback } = setup();
    playback.attach("p1", stream());
    playback.attach("p2", stream());
    ctx!.analysers[0]!.level = 0.25;
    ctx!.analysers[1]!.level = -0.5;
    const levels = playback.levels();
    expect(levels.get("p1")).toBeCloseTo(0.25);
    expect(levels.get("p2")).toBeCloseTo(0.5);
  });

  it("needsTap is true while there is no context, or it is suspended or interrupted", () => {
    const { env, playback } = setup("graph", null);
    expect(playback.needsTap).toBe(true);
    const seen: boolean[] = [];
    playback.onChange(() => seen.push(playback.needsTap));
    env.makeContext();
    expect(playback.needsTap).toBe(false);
    env.setState("suspended");
    expect(playback.needsTap).toBe(true);
    env.setState("running");
    env.setState("interrupted");
    expect(playback.needsTap).toBe(true);
    env.setState("running");
    expect(playback.needsTap).toBe(false);
    expect(seen).toEqual([false, true, false, true, false]);
  });

  it("onChange unsubscribe stops calls", () => {
    const { env, playback } = setup();
    let n = 0;
    const off = playback.onChange(() => n++);
    env.setState("suspended");
    off();
    env.setState("running");
    expect(n).toBe(1);
  });

  it("hides output choice without setSinkId, and says so", async () => {
    const { playback } = setup();
    expect(playback.canPickOutput).toBe(false);
    expect(await playback.setOutput("d1")).toBe(false);
  });

  it("picks the output on the context when it has setSinkId", async () => {
    const { ctx, playback } = setup("graph", new FakeContext(true));
    expect(playback.canPickOutput).toBe(true);
    expect(await playback.setOutput("d1")).toBe(true);
    expect(await playback.setOutput(null)).toBe(true);
    expect(ctx!.sinkIds).toEqual(["d1", ""]);
  });

  it("setOutput resolves false when the browser refuses", async () => {
    const ctx = new FakeContext(true);
    (ctx as unknown as { setSinkId: () => Promise<void> }).setSinkId = () => Promise.reject(new Error("no"));
    const { playback } = setup("graph", ctx);
    expect(await playback.setOutput("d1")).toBe(false);
  });

  it("a rejected element play does not throw", () => {
    const env = new FakeAudioEnv(null, () => {
      const el = new FakeElementWithSink();
      el.rejectPlay = true;
      return el;
    });
    const playback = new Playback(env, { mode: "graph" });
    expect(() => playback.attach("p1", stream())).not.toThrow();
    expect(playback.needsTap).toBe(true); // still waits on the context, not the element
  });
});

describe("Playback, element mode (the fallback)", () => {
  it("uses an element, muted at zero, and element.volume for gain", () => {
    const { env, ctx, playback } = setup("element");
    playback.attach("p1", stream());
    const el = env.elements[0]!;
    expect(el.plays).toBe(1);
    expect(ctx!.sources).toHaveLength(0);
    expect(el.volume).toBe(0);
    playback.setAllowed("p1", true);
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(1);
    playback.setGain("p1", 0.4);
    expect(el.volume).toBeCloseTo(0.4);
    playback.setGain("p1", 1.5);
    expect(el.volume).toBe(1); // element volume tops out at 1
    playback.setDeafened(true);
    expect(el.volume).toBe(0);
  });

  it("mutes the element at gain zero, because iOS ignores element.volume", () => {
    const { env, playback } = setup("element");
    playback.attach("p1", stream());
    const el = env.elements[0]!;
    expect(el.muted).toBe(true); // not allowed yet
    playback.setAllowed("p1", true);
    expect(el.muted).toBe(false);
    playback.setDeafened(true);
    expect(el.muted).toBe(true);
    playback.setDeafened(false);
    playback.setGain("p1", 0);
    expect(el.muted).toBe(true);
    playback.setGain("p1", 1);
    expect(el.muted).toBe(false);
  });

  it("an element the browser pauses on unmute shows the tap prompt, and resume fixes it", async () => {
    // Chrome pauses an element that was only allowed to play because it was muted,
    // when script unmutes it without a gesture. Later play() calls need a gesture.
    class PausingElement extends FakeElementWithSink {
      gesture = false;
      constructor() {
        super();
        // The base class has a plain `muted` field; replace it with a watched one.
        let isMuted = false;
        Object.defineProperty(this, "muted", {
          get: () => isMuted,
          set: (v: boolean) => {
            if (isMuted && !v && !this.gesture) this.rejectPlay = true;
            isMuted = v;
          },
        });
      }
    }
    const env = new FakeAudioEnv(null, () => new PausingElement());
    env.unlock = () => {
      (env.elements[0] as PausingElement).gesture = true;
      (env.elements[0] as PausingElement).rejectPlay = false;
    };
    const p = new Playback(env, { mode: "element" });
    p.attach("p1", stream());
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(false);
    p.setAllowed("p1", true); // the mesh unmutes it at once
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(true);
    p.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(false);
  });

  it("resume retries a refused play after the context is already running, and unlocks", async () => {
    let unlocked = 0;
    const env = new FakeAudioEnv(null, () => {
      const el = new FakeElementWithSink();
      el.rejectPlay = true;
      return el;
    });
    env.unlock = () => void unlocked++;
    const p = new Playback(env, { mode: "element" });
    p.attach("p1", stream());
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(true);
    env.makeContext(); // first tap: still refused
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(true);
    (env.elements[0] as FakeElementWithSink).rejectPlay = false;
    p.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlocked).toBe(1);
    expect(p.needsTap).toBe(false);
  });

  it("accepts setAllowed before attach", () => {
    const { env, playback } = setup("element");
    playback.setAllowed("p1", true);
    playback.attach("p1", stream());
    expect(env.elements[0]!.volume).toBe(1);
  });

  it("detach drops the element and works without any context", () => {
    const { env, playback } = setup("element", null);
    playback.attach("p1", stream());
    playback.detach("p1");
    expect(env.elements[0]!.srcObject).toBeNull();
    expect(playback.levels().size).toBe(0);
  });

  it("needsTap is true only while a play was refused, and a context event retries it", async () => {
    expect(setup("element", null).playback.needsTap).toBe(false);
    const refusing = new FakeAudioEnv(null, () => {
      const el = new FakeElementWithSink();
      el.rejectPlay = true;
      return el;
    });
    const p = new Playback(refusing, { mode: "element" });
    let changes = 0;
    p.onChange(() => changes++);
    p.attach("p1", stream());
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(true);
    expect(changes).toBe(1);
    (refusing.elements[0] as FakeElementWithSink).rejectPlay = false;
    refusing.makeContext(); // a tap made the context
    await Promise.resolve();
    await Promise.resolve();
    expect(p.needsTap).toBe(false);
    expect(refusing.elements[0]!.plays).toBe(2);
  });

  it("picks the output on each element that has setSinkId", async () => {
    const env = new FakeAudioEnv(null, () => new FakeElementWithSink());
    const p = new Playback(env, { mode: "element" });
    expect(p.canPickOutput).toBe(true);
    p.attach("p1", stream());
    p.attach("p2", stream());
    expect(await p.setOutput("d9")).toBe(true);
    const els = env.elements.filter((e) => e instanceof FakeElementWithSink) as FakeElementWithSink[];
    expect(els.some((e) => e.sinkIds.includes("d9"))).toBe(true);
    // A stream attached later gets the chosen output too.
    p.attach("p3", stream());
    const last = env.elements[env.elements.length - 1] as FakeElementWithSink;
    expect(last.sinkIds).toEqual(["d9"]);
  });

  it("hides output choice when elements lack setSinkId", () => {
    const { playback } = setup("element");
    expect(playback.canPickOutput).toBe(false);
  });
});

const prefs: MicPrefs = { deviceId: "d1", echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function micStream(track: FakeTrack) {
  return fakeStream([track]);
}

describe("Mic", () => {
  it("asks with the three processing settings and the device", async () => {
    const track = new FakeTrack("m1");
    const calls: MediaStreamConstraints[] = [];
    const mic = new Mic(async (c) => (calls.push(c), micStream(track)), false);
    const res = await mic.start(prefs);
    expect(res).toEqual({ ok: true, track });
    expect(calls[0]!.audio).toEqual({
      deviceId: { exact: "d1" },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(calls[0]!.video).toBeFalsy();
    expect(mic.track).toBe(track);
  });

  it("leaves out the device when none is chosen", async () => {
    const calls: MediaStreamConstraints[] = [];
    const mic = new Mic(async (c) => (calls.push(c), micStream(new FakeTrack())), false);
    await mic.start({ ...prefs, deviceId: null, echoCancellation: false });
    expect(calls[0]!.audio).toEqual({ echoCancellation: false, noiseSuppression: true, autoGainControl: true });
  });

  it("denied gives reason denied; no getUserMedia gives unavailable", async () => {
    const denied = new Mic(() => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })), false);
    expect(await denied.start(prefs)).toEqual({ ok: false, reason: "denied" });
    const missing = new Mic(() => Promise.reject(Object.assign(new Error("x"), { name: "NotFoundError" })), false);
    expect(await missing.start(prefs)).toEqual({ ok: false, reason: "unavailable" });
    const none = new Mic(null, false);
    expect(await none.start(prefs)).toEqual({ ok: false, reason: "unavailable" });
    const throws = new Mic(() => {
      throw new Error("sync");
    }, false);
    expect(await throws.start(prefs)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a saved mic that is gone: asks once more for any mic, and says the saved one is gone", async () => {
    for (const name of ["OverconstrainedError", "NotFoundError"]) {
      const calls: MediaStreamConstraints[] = [];
      const track = new FakeTrack();
      const mic = new Mic(async (c) => {
        calls.push(c);
        const audio = c.audio as MediaTrackConstraints;
        if (audio.deviceId) throw Object.assign(new Error("x"), { name });
        return micStream(track);
      }, false);
      expect(await mic.start(prefs)).toEqual({ ok: true, track, deviceGone: true });
      expect(calls).toHaveLength(2);
      expect(calls[1]!.audio).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      expect(mic.track).toBe(track);
    }
    // No saved mic, or a refusal: no second ask.
    let n = 0;
    const missing = new Mic(() => (n++, Promise.reject(Object.assign(new Error("x"), { name: "NotFoundError" }))), false);
    expect(await missing.start({ ...prefs, deviceId: null })).toEqual({ ok: false, reason: "unavailable" });
    expect(n).toBe(1);
    n = 0;
    const denied = new Mic(() => (n++, Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))), false);
    expect(await denied.start(prefs)).toEqual({ ok: false, reason: "denied" });
    expect(n).toBe(1);
    // The second ask fails too: its reason counts.
    n = 0;
    const both = new Mic((c) => {
      n++;
      const name = (c.audio as MediaTrackConstraints).deviceId ? "OverconstrainedError" : "NotAllowedError";
      return Promise.reject(Object.assign(new Error("x"), { name }));
    }, false);
    expect(await both.start(prefs)).toEqual({ ok: false, reason: "denied" });
    expect(n).toBe(2);
  });

  it("a stop() during the second ask still cancels", async () => {
    let resolve!: (s: MediaStream) => void;
    const track = new FakeTrack();
    const mic = new Mic((c) => {
      if ((c.audio as MediaTrackConstraints).deviceId) return Promise.reject(Object.assign(new Error("x"), { name: "NotFoundError" }));
      return new Promise<MediaStream>((r) => (resolve = r));
    }, false);
    const pending = mic.start(prefs);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    mic.stop();
    resolve(micStream(track));
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(track.stops).toBe(1);
    expect(mic.track).toBeNull();
  });

  it("a request that fails after stop() is cancelled, not denied", async () => {
    let reject!: (e: unknown) => void;
    const mic = new Mic(() => new Promise<MediaStream>((_, r) => (reject = r)), false);
    const pending = mic.start(prefs);
    mic.stop();
    reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
  });

  it("a stream with no audio track is unavailable", async () => {
    const mic = new Mic(async () => fakeStream([]), false);
    expect(await mic.start(prefs)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("restart on iOS stops the old track before asking again", async () => {
    const order: string[] = [];
    const t1 = new FakeTrack("t1");
    const t2 = new FakeTrack("t2");
    const tracks = [t1, t2];
    const mic = new Mic(async () => {
      order.push(`ask:t1stops=${t1.stops}`);
      return micStream(tracks.shift()!);
    }, true);
    await mic.start(prefs);
    const res = await mic.restart(prefs);
    expect(order).toEqual(["ask:t1stops=0", "ask:t1stops=1"]);
    expect(res).toEqual({ ok: true, track: t2 });
    expect(mic.track).toBe(t2);
  });

  it("restart elsewhere keeps the old track until the new one is in hand", async () => {
    const t1 = new FakeTrack("t1");
    const t2 = new FakeTrack("t2");
    const tracks = [t1, t2];
    let stopsWhenAsked = -1;
    const mic = new Mic(async () => {
      stopsWhenAsked = t1.stops;
      return micStream(tracks.shift()!);
    }, false);
    await mic.start(prefs);
    await mic.restart(prefs);
    expect(stopsWhenAsked).toBe(0);
    expect(t1.stops).toBe(1);
    expect(mic.track).toBe(t2);
  });

  it("a failed restart off iOS keeps the old track", async () => {
    const t1 = new FakeTrack("t1");
    let n = 0;
    const mic = new Mic(async () => {
      if (n++ === 0) return micStream(t1);
      throw Object.assign(new Error("x"), { name: "NotAllowedError" });
    }, false);
    await mic.start(prefs);
    expect(await mic.restart(prefs)).toEqual({ ok: false, reason: "denied" });
    expect(mic.track).toBe(t1);
    expect(t1.stops).toBe(0);
  });

  it("an ended or muted track fires onLost", async () => {
    for (const kind of ["ended", "mute"] as const) {
      const track = new FakeTrack();
      const mic = new Mic(async () => micStream(track), false);
      let lost = 0;
      mic.onLost(() => lost++);
      await mic.start(prefs);
      track.dispatch(kind);
      expect(lost).toBe(1);
    }
  });

  it("stopping or replacing a track does not report it lost", async () => {
    const t1 = new FakeTrack();
    const t2 = new FakeTrack();
    const tracks = [t1, t2];
    const mic = new Mic(async () => micStream(tracks.shift()!), false);
    let lost = 0;
    mic.onLost(() => lost++);
    await mic.start(prefs);
    await mic.restart(prefs);
    t1.dispatch("ended");
    expect(lost).toBe(0);
    mic.stop();
    t2.dispatch("ended");
    expect(lost).toBe(0);
  });

  it("stop before a pending start resolves leaves no live mic", async () => {
    const track = new FakeTrack();
    let resolve!: (s: MediaStream) => void;
    const mic = new Mic(() => new Promise<MediaStream>((r) => (resolve = r)), false);
    const pending = mic.start(prefs);
    mic.stop();
    resolve(micStream(track));
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(track.stops).toBe(1);
    expect(mic.track).toBeNull();
  });

  it("an older restart cannot overwrite a newer one", async () => {
    const t1 = new FakeTrack("t1");
    const t2 = new FakeTrack("t2");
    const resolvers: ((s: MediaStream) => void)[] = [];
    const mic = new Mic(() => new Promise<MediaStream>((r) => resolvers.push(r)), false);
    const first = mic.restart(prefs);
    const second = mic.restart(prefs);
    resolvers[1]!(micStream(t2));
    expect((await second).ok).toBe(true);
    resolvers[0]!(micStream(t1));
    expect(await first).toEqual({ ok: false, reason: "cancelled" });
    expect(t1.stops).toBe(1);
    expect(mic.track).toBe(t2);
    expect(t2.stops).toBe(0);
  });

  it("stop stops the track", async () => {
    const track = new FakeTrack();
    const mic = new Mic(async () => micStream(track), false);
    await mic.start(prefs);
    mic.stop();
    expect(track.stops).toBe(1);
    expect(mic.track).toBeNull();
    mic.stop(); // twice is fine
    expect(track.stops).toBe(1);
  });

  it("level reads the own mic through an analyser on the shared context, and is 0 without one", async () => {
    const env = new FakeAudioEnv(null);
    const track = new FakeTrack();
    const mic = new Mic(async () => micStream(track), false, env);
    expect(mic.level()).toBe(0);
    await mic.start(prefs);
    expect(mic.level()).toBe(0); // no context yet
    const ctx = env.makeContext();
    expect(mic.level()).toBe(0); // built now, silent
    ctx.analysers[0]!.level = 0.3;
    expect(mic.level()).toBeCloseTo(0.3);
    // The mic must never reach the speakers.
    expect(ctx.analysers[0]!.connected).toHaveLength(0);
    expect(ctx.sources[0]!.connected).toEqual([ctx.analysers[0]]);
  });
});

describe("nextSpeaking", () => {
  it("turns on at once and off after three quiet ticks", () => {
    let s = { speaking: false, quietTicks: 0 };
    s = nextSpeaking(s, 0.06);
    expect(s.speaking).toBe(true);
    s = nextSpeaking(s, 0.04);
    expect(s.speaking).toBe(true); // between thresholds: stays
    s = nextSpeaking(s, 0.01);
    s = nextSpeaking(s, 0.01);
    expect(s.speaking).toBe(true);
    s = nextSpeaking(s, 0.01);
    expect(s.speaking).toBe(false);
  });

  it("a loud tick resets the quiet count, and silence stays off", () => {
    let s = { speaking: true, quietTicks: 0 };
    s = nextSpeaking(s, 0.01);
    s = nextSpeaking(s, 0.01);
    s = nextSpeaking(s, 0.05);
    s = nextSpeaking(s, 0.01);
    s = nextSpeaking(s, 0.01);
    expect(s.speaking).toBe(true);
    const off = nextSpeaking({ speaking: false, quietTicks: 0 }, 0.04);
    expect(off).toEqual({ speaking: false, quietTicks: 0 });
  });
});

describe("@games/audio shared context", () => {
  const original = (globalThis as { AudioContext?: unknown }).AudioContext;
  afterEach(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = original;
  });

  it("exposes the context after unlock and tells listeners on make and on statechange", () => {
    let made: FakeContext | null = null;
    const listeners = new Map<string, () => void>();
    class Ctx extends FakeContext {
      constructor() {
        super();
        made = this;
        this.state = "suspended";
      }
      createGain() {
        const g = super.createGain();
        (g as unknown as { connect: () => void }).connect = () => {};
        return g;
      }
      resume = vi.fn(() => Promise.reject(new Error("refused")));
      addEventListener(type: string, fn: () => void) {
        listeners.set(type, fn);
      }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = Ctx;
    // Samples fetch must not hit the network.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(audio.context).toBeNull();
    const seen: string[] = [];
    const off = audio.onContext((c) => seen.push((c as unknown as FakeContext).state));
    audio.unlock();
    expect(audio.context).toBe(made);
    expect(seen).toEqual(["suspended"]);
    (made as unknown as FakeContext).state = "running";
    listeners.get("statechange")!();
    expect(seen).toEqual(["suspended", "running"]);
    off();
    listeners.get("statechange")!();
    expect(seen).toHaveLength(2);
    // iOS "interrupted" clears on a tap too, and a refused resume is not an error.
    const ctx = made as unknown as FakeContext & { resume: ReturnType<typeof vi.fn> };
    ctx.resume.mockClear();
    ctx.state = "interrupted";
    expect(() => audio.unlock()).not.toThrow();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = "running";
    audio.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
