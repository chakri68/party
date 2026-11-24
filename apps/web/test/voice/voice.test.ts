import { describe, expect, it, vi } from "vitest";
import type { ClientMessage, IceServer, RoomPublicState, VoiceMember } from "@games/protocol";
import type { VoiceConnectOptions, VoicePeerStats, VoiceRule, VoiceTransport } from "@games/webrtc";
import { METER_HZ, Mic, Playback, SPEAK_HOLD_TICKS } from "../../src/voice/audio.ts";
import type { MeshDeps } from "../../src/voice/mesh.ts";
import { voicePrefs, type KeyValue } from "../../src/voice/prefs.ts";
import { ICE_REFRESH_WAIT_MS, shouldPublish, SIGNAL_QUEUE_MAX, VOLUME_SAVE_MS, VoiceController } from "../../src/voice/voice.ts";
import { FakeAudioEnv, FakeTrack, fakeStream } from "./fake-audio.ts";
import { FakeClock, flush } from "./fake-rtc.ts";
import { memoryStore } from "./fake-store.ts";

type TransportDeps = Omit<MeshDeps, "createPeer" | "clock">;

class FakeTransport implements VoiceTransport {
  readonly calls: { op: string; args: unknown[] }[] = [];
  readonly deps: TransportDeps;
  constructor(deps: TransportDeps) {
    this.deps = deps;
  }
  private rec(op: string, ...args: unknown[]) {
    this.calls.push({ op, args });
  }
  connect(opts: VoiceConnectOptions) {
    this.rec("connect", opts);
  }
  setPeers(ids: string[]) {
    this.rec("setPeers", ids);
  }
  handleSignal(from: string, session: string, data: unknown) {
    this.rec("handleSignal", from, session, data);
  }
  setIceServers(servers: RTCIceServer[], expiresAt: number) {
    this.rec("setIceServers", servers, expiresAt);
  }
  /** Set to make the next setPublishing reject, like a replaceTrack that failed. */
  rejectNext = false;
  setPublishing(track: MediaStreamTrack | null) {
    this.rec("setPublishing", track);
    if (this.rejectNext) {
      this.rejectNext = false;
      return Promise.reject(new Error("replaceTrack failed"));
    }
    return Promise.resolve();
  }
  applyPolicy(rule: VoiceRule) {
    this.rec("applyPolicy", rule);
  }
  setRemoteGain(peerId: string, gain: number) {
    this.rec("setRemoteGain", peerId, gain);
  }
  getStats(): Promise<VoicePeerStats[]> {
    return Promise.resolve([]);
  }
  disconnect() {
    this.rec("disconnect");
  }
  ops(op: string) {
    return this.calls.filter((c) => c.op === op);
  }
  lastPublished(): unknown {
    const p = this.ops("setPublishing");
    return p.length ? p[p.length - 1]!.args[0] : "never";
  }
}

const STUN: IceServer[] = [{ urls: "stun:stun.example:3478" }];
const TURN: IceServer[] = [{ urls: ["stun:stun.example:3478", "turns:turn.example:443"], username: "u", credential: "c" }];

const member = (id: string, extra: Partial<VoiceMember> = {}): VoiceMember => ({ id, selfMuted: false, hostMuted: false, ...extra });
const roster = (...ids: string[]) => ids.map((id) => member(id));

function room(extra: Partial<RoomPublicState> = {}): RoomPublicState {
  return { code: "ABCD", phase: "lobby", gameId: "bluff", roundNumber: 0, voice: { mode: "global" }, ...extra } as RoomPublicState;
}

interface Opts {
  rtc?: boolean;
  /** "gone": refuses any exact deviceId (the saved mic was unplugged), like Chrome. */
  gum?: "ok" | "denied" | "unavailable" | "hang" | "gone";
  /** "throw": the permission query fails. */
  perm?: "granted" | "denied" | "prompt" | "unknown" | "throw";
  store?: KeyValue;
  /** A transport whose every method throws. */
  badTransport?: boolean;
}

const boom = () => {
  throw new Error("boom");
};

function setup(opts: Opts = {}) {
  const sent: ClientMessage[] = [];
  const toasts: string[] = [];
  const transports: FakeTransport[] = [];
  const env = new FakeAudioEnv();
  const playback = new Playback(env);
  const tracks: FakeTrack[] = [];
  let hang: (() => void) | null = null;
  const gum = vi.fn(async (c: MediaStreamConstraints) => {
    if (opts.gum === "gone" && (c.audio as MediaTrackConstraints).deviceId) throw Object.assign(new Error("no"), { name: "OverconstrainedError" });
    if (opts.gum === "hang") await new Promise<void>((r) => (hang = r));
    if (opts.gum === "denied") throw Object.assign(new Error("no"), { name: "NotAllowedError" });
    if (opts.gum === "unavailable") throw Object.assign(new Error("no"), { name: "NotFoundError" });
    const t = new FakeTrack(`t${tracks.length}`);
    tracks.push(t);
    return fakeStream([t]);
  });
  const mic = new Mic(gum, false, env);
  const clock = new FakeClock();
  const store = opts.store ?? memoryStore();
  const prefs = voicePrefs(store);
  let sessions = 0;
  const voice = new VoiceController({
    code: "ABCD",
    send: (m) => sent.push(m),
    selfId: () => "me",
    rtcSupported: opts.rtc ?? true,
    createTransport: (deps) => {
      if (opts.badTransport) return new Proxy({}, { get: () => boom }) as VoiceTransport;
      const t = new FakeTransport(deps);
      transports.push(t);
      return t;
    },
    mic,
    playback,
    prefs,
    micPermission: async () => {
      if (opts.perm === "throw") throw new Error("no permissions API");
      return opts.perm ?? "prompt";
    },
    newSession: () => `s${++sessions}`,
    clock,
    toast: (text) => toasts.push(text),
  });
  const types = () => sent.map((m) => m.type);
  const t = (i = 0) => {
    const x = transports[i];
    if (!x) throw new Error(`no transport ${i}`);
    return x;
  };
  return { sent, toasts, types, transports, t, env, playback, tracks, gum, mic, clock, store, prefs, voice, release: () => hang?.() };
}

/** Joined, in the roster with b, and connected. */
async function joined(opts: Opts = {}, withMic = true, others: string[] = ["b"]) {
  const s = setup(opts);
  await s.voice.join(withMic);
  s.voice.onVoiceState(roster("me", ...others));
  s.voice.onIce(STUN, 1e12);
  await flush();
  return s;
}

describe("shouldPublish", () => {
  it("shouldPublish needs every condition", () => {
    const all = { joined: true, selfMuted: false, hostMuted: false, canTalk: true, up: true, mode: "open" as const, pttHeld: false, micLive: true };
    expect(shouldPublish(all)).toBe(true);
    expect(shouldPublish({ ...all, mode: "ptt", pttHeld: true })).toBe(true);
    const off: Partial<typeof all>[] = [
      { joined: false },
      { selfMuted: true },
      { hostMuted: true },
      { canTalk: false },
      { up: false },
      { micLive: false },
      { mode: "ptt" as never, pttHeld: false },
    ];
    for (const change of off) expect(shouldPublish({ ...all, ...change }), JSON.stringify(change)).toBe(false);
  });
});

describe("VoiceController", () => {
  it("no RTCPeerConnection: status unsupported, sends nothing", async () => {
    const store = memoryStore();
    voicePrefs(store).setRoom("ABCD", { on: true });
    const s = setup({ rtc: false, store, perm: "granted" });
    expect(s.voice.view().status).toBe("unsupported");
    s.voice.onWelcome();
    await s.voice.join(true);
    s.voice.onVoiceState(roster("me", "b"));
    s.voice.onSignal("b", "x", { kind: "ice" });
    s.voice.onIce(STUN, 1e12);
    s.voice.setMuted(true);
    s.voice.turnOffMic();
    await s.voice.turnOnMic();
    s.voice.setDeafened(true);
    s.voice.leave();
    s.voice.onError("voice-full");
    await flush();
    expect(s.sent).toEqual([]);
    expect(s.transports).toEqual([]);
    expect(s.gum).not.toHaveBeenCalled();
    expect(s.voice.view().status).toBe("unsupported");
  });

  it("join with mic sends voice-join muted false", async () => {
    const s = setup();
    const p = s.voice.join(true);
    expect(s.voice.view().status).toBe("joining");
    await p;
    expect(s.sent).toEqual([{ type: "voice-join", muted: false }]);
    expect(s.prefs.room("ABCD").on).toBe(true);
    expect(s.voice.view().mic).toBe("on");
    s.voice.onVoiceState(roster("me", "b"));
    expect(s.voice.view().status).toBe("on");
    expect(s.t().ops("setPeers").at(-1)?.args[0]).toEqual(["b"]);
    expect(s.t().ops("applyPolicy").at(-1)?.args[0]).toEqual({ canTalk: true, hear: ["b"], sendTo: ["b"], label: "" });
    expect(s.voice.view().members.map((m) => m.id)).toEqual(["me", "b"]);
    expect(s.voice.view().members.map((m) => m.self)).toEqual([true, false]);
  });

  it("mic denied joins listen only with mic denied", async () => {
    for (const gum of ["denied", "unavailable"] as const) {
      const s = setup({ gum });
      await s.voice.join(true);
      expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
      expect(s.voice.view().mic).toBe("denied");
      expect(s.voice.view().status).toBe("joining");
    }
    const s = setup();
    await s.voice.join(false);
    expect(s.gum).not.toHaveBeenCalled();
    expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(s.voice.view().mic).toBe("off");
  });

  it("leaving while the mic prompt is open sends no join and shows no error", async () => {
    const s = setup({ gum: "hang" });
    const p = s.voice.join(true);
    await flush();
    s.voice.leave();
    s.release();
    await p;
    expect(s.types()).toEqual(["voice-leave"]);
    expect(s.voice.view().mic).toBe("off");
    expect(s.voice.view().status).toBe("off");
    expect(s.transports).toEqual([]);
  });

  it("queues signals until the first voice-ice, then connects and replays them", async () => {
    const s = setup();
    s.voice.onSignal("b", "x", { n: -1 }); // before joining: dropped
    await s.voice.join(true);
    s.voice.onVoiceState(roster("me", "b"));
    for (let i = 0; i < SIGNAL_QUEUE_MAX + 5; i++) s.voice.onSignal("b", "bs", { n: i });
    expect(s.t().ops("handleSignal")).toEqual([]);
    s.voice.onIce(STUN, 1234);
    const ops = s.t().calls.map((c) => c.op);
    expect(ops.indexOf("connect")).toBeLessThan(ops.indexOf("handleSignal"));
    expect(s.t().ops("connect")[0]!.args[0]).toEqual({ selfId: "me", session: "s1", iceServers: STUN, iceExpiresAt: 1234, relayOnly: false });
    const replayed = s.t().ops("handleSignal").map((c) => (c.args[2] as { n: number }).n);
    expect(replayed).toHaveLength(SIGNAL_QUEUE_MAX);
    expect(replayed[0]).toBe(5);
    expect(replayed.at(-1)).toBe(SIGNAL_QUEUE_MAX + 4);
    s.voice.onSignal("b", "bs", { n: 999 });
    expect(s.t().ops("handleSignal").at(-1)?.args).toEqual(["b", "bs", { n: 999 }]);
    s.voice.onIce(TURN, 5678);
    expect(s.t().ops("connect")).toHaveLength(1);
    expect(s.t().ops("setIceServers")[0]!.args).toEqual([TURN, 5678]);
  });

  it("voice-full stops the mic and shows full", async () => {
    const s = setup();
    await s.voice.join(true);
    s.voice.onError("voice-full");
    expect(s.voice.view().status).toBe("full");
    expect(s.tracks[0]!.stops).toBe(1);
    expect(s.t().ops("disconnect")).toHaveLength(1);
    expect(s.prefs.room("ABCD").on).toBe(false);
    s.voice.onError("not-host");
    expect(s.voice.view().status).toBe("full");
  });

  it("leave sends voice-leave, stops the mic, closes links", async () => {
    const s = await joined();
    s.voice.leave();
    expect(s.sent.at(-1)).toEqual({ type: "voice-leave" });
    expect(s.tracks[0]!.stops).toBe(1);
    expect(s.t().ops("disconnect")).toHaveLength(1);
    expect(s.prefs.room("ABCD").on).toBe(false);
    expect(s.voice.view().status).toBe("off");
    expect(s.clock.pending()).toBe(0);
    // A late signal or roster for the old join does nothing.
    s.voice.onSignal("b", "bs", {});
    s.voice.onVoiceState(roster("me", "b"));
    expect(s.voice.view().status).toBe("off");
  });

  it("stop closes everything and sends nothing", async () => {
    const s = await joined();
    const before = s.sent.length;
    s.voice.stop();
    expect(s.sent.length).toBe(before);
    expect(s.tracks[0]!.stops).toBe(1);
    expect(s.t().ops("disconnect")).toHaveLength(1);
    expect(s.prefs.room("ABCD").on).toBe(true);
    expect(s.voice.view().status).toBe("off");
    expect(s.clock.pending()).toBe(0);
  });

  it("turn off mic stops the track and sends self-mute", async () => {
    const s = await joined();
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    s.voice.turnOffMic();
    expect(s.tracks[0]!.stops).toBe(1);
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: true });
    expect(s.voice.view().mic).toBe("off");
    expect(s.t().lastPublished()).toBeNull();
    await s.voice.turnOnMic();
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: false });
    expect(s.voice.view().mic).toBe("on");
    expect(s.t().lastPublished()).toBe(s.tracks[1]!.asTrack());
  });

  it("mute keeps the track and sends self-mute; host-muted refuses unmute", async () => {
    const s = await joined();
    s.voice.setMuted(true);
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: true });
    expect(s.voice.view().mic).toBe("muted");
    expect(s.tracks[0]!.stops).toBe(0);
    expect(s.t().lastPublished()).toBeNull();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    const before = s.sent.length;
    s.voice.setMuted(false);
    expect(s.sent.length).toBe(before);
    expect(s.t().lastPublished()).toBeNull();
  });

  it("push-to-talk publishes only while held", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ mode: "ptt" });
    const s = await joined({ store });
    expect(s.voice.view().mode).toBe("ptt");
    expect(s.t().ops("setPublishing")).toEqual([]);
    s.voice.setPtt(true);
    expect(s.voice.view().pttHeld).toBe(true);
    expect(s.voice.view().talking).toBe(true);
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    s.voice.setPtt(true);
    expect(s.t().ops("setPublishing")).toHaveLength(1);
    s.voice.setPtt(false);
    expect(s.t().lastPublished()).toBeNull();
    await s.voice.updatePrefs({ mode: "open" });
    expect(s.voice.view().mode).toBe("open");
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
  });

  it("deafen with deafenAlsoMutes mutes, and undeafen puts back the old state", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ deafenAlsoMutes: true });
    const s = await joined({ store });
    const deafen = vi.spyOn(s.playback, "setDeafened");
    s.voice.setDeafened(true);
    expect(deafen).toHaveBeenLastCalledWith(true);
    expect(s.voice.view().deafened).toBe(true);
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: true });
    expect(s.voice.view().mic).toBe("muted");
    s.voice.setDeafened(false);
    expect(deafen).toHaveBeenLastCalledWith(false);
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: false });
    expect(s.voice.view().mic).toBe("on");
    // Muted before: stays muted after.
    s.voice.setMuted(true);
    const before = s.sent.length;
    s.voice.setDeafened(true);
    s.voice.setDeafened(false);
    expect(s.sent.length).toBe(before);
    expect(s.voice.view().mic).toBe("muted");
    // Without the setting, deafen does not touch the mic.
    const plain = await joined();
    plain.voice.setDeafened(true);
    expect(plain.voice.view().mic).toBe("on");
    expect(plain.types()).toEqual(["voice-join"]);
  });

  it("deafened with deafenAlsoMutes, a join starts muted; unmuting hears everyone again", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ deafenAlsoMutes: true });
    const s = setup({ store });
    s.voice.setDeafened(true);
    await s.voice.join(true);
    expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(s.voice.view().mic).toBe("muted");
    s.voice.onVoiceState(roster("me", "b"));
    s.voice.onIce(STUN, 1e12);
    expect(s.t().lastPublished()).toBe("never");
    s.voice.setDeafened(false);
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: false });
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    // Unmuting while deafened also ends the deafen, so the rule holds.
    const deafen = vi.spyOn(s.playback, "setDeafened");
    s.voice.setDeafened(true);
    s.voice.setMuted(false);
    expect(s.voice.view().deafened).toBe(false);
    expect(deafen).toHaveBeenLastCalledWith(false);
    expect(s.voice.view().mic).toBe("on");
  });

  it("a failed setPublishing is tried again on the next change", async () => {
    const s = await joined({}, true);
    // The first send (after the ICE servers came) failed.
    const t = s.t();
    t.calls.length = 0;
    t.rejectNext = true;
    s.voice.setMuted(true);
    await flush();
    expect(t.ops("setPublishing").map((c) => c.args[0])).toEqual([null]);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    expect(t.ops("setPublishing").map((c) => c.args[0])).toEqual([null, null]);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    expect(t.ops("setPublishing")).toHaveLength(2);
  });

  it("host-muted with no mic: unmute does not ask for the mic", async () => {
    const s = setup();
    await s.voice.join(false);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true })]);
    const before = s.sent.length;
    s.voice.setMuted(false);
    await flush();
    expect(s.gum).not.toHaveBeenCalled();
    expect(s.sent.length).toBe(before);
  });

  it("host mute stops sending at once, even mid push-to-talk", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ mode: "ptt" });
    const s = await joined({ store });
    s.voice.setPtt(true);
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    const before = s.sent.length;
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    expect(s.t().lastPublished()).toBeNull();
    expect(s.voice.view().mic).toBe("muted");
    expect(s.voice.view().talking).toBe(false);
    // The server already set it: nothing sent.
    expect(s.sent.length).toBe(before);
    expect(s.prefs.room("ABCD").mic).toBe("muted");
  });

  it("host mute lifted: stays muted until Unmute", async () => {
    const s = await joined();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    expect(s.t().lastPublished()).toBeNull();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: false }), member("b")]);
    expect(s.t().lastPublished()).toBeNull();
    expect(s.voice.view().mic).toBe("muted");
    s.voice.setMuted(false);
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    expect(s.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: false });
    expect(s.voice.view().mic).toBe("on");
  });

  it("host mute lifted while deafened: undeafen keeps the mute", async () => {
    const s = await joined();
    s.voice.setDeafened(true);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: false }), member("b")]);
    s.voice.setDeafened(false);
    expect(s.t().lastPublished()).toBeNull();
    expect(s.voice.view().mic).toBe("muted");
  });

  it("host-muted on reload: stays muted after the lift", async () => {
    // The mic was saved "on": the host mute landed while this page was away.
    const store = memoryStore();
    voicePrefs(store).setRoom("ABCD", { on: true, mic: "on" });
    const s = setup({ store, perm: "granted" });
    s.voice.onWelcome();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    await flush();
    expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
    s.voice.onIce(STUN, 1e12);
    expect(s.t().ops("setPublishing").every((c) => c.args[0] === null)).toBe(true);
    expect(s.voice.view().talking).toBe(false);
    expect(s.voice.view().mic).toBe("muted");
    expect(s.prefs.room("ABCD").mic).toBe("muted");
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: false }), member("b")]);
    expect(s.t().ops("setPublishing").every((c) => c.args[0] === null)).toBe(true);
    expect(s.voice.view().talking).toBe(false);
    expect(s.voice.view().mic).toBe("muted");
    s.voice.stop();

    // Reload after the lift: still muted.
    const again = setup({ store, perm: "granted" });
    again.voice.onWelcome();
    again.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    await flush();
    expect(again.sent).toEqual([{ type: "voice-join", muted: true }]);
    again.voice.onIce(STUN, 1e12);
    expect(again.t().ops("setPublishing").every((c) => c.args[0] === null)).toBe(true);
    expect(again.voice.view().talking).toBe(false);
    expect(again.voice.view().mic).toBe("muted");
  });

  it("host-muted with the mic off keeps the mic saved off", async () => {
    const s = setup();
    await s.voice.join(false);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    expect(s.prefs.room("ABCD").mic).toBe("off");
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    expect(s.prefs.room("ABCD").mic).toBe("off");
    expect(s.voice.view().mic).toBe("off");
  });

  it("turn on mic while host-muted toasts and saves nothing; reload after the lift joins muted", async () => {
    const store = memoryStore();
    const s = setup({ store, perm: "granted" });
    await s.voice.join(false);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    s.voice.onIce(STUN, 1e12);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    s.toasts.length = 0;
    const before = s.sent.length;
    await s.voice.turnOnMic();
    expect(s.toasts).toEqual(["The host muted you."]);
    expect(s.gum).not.toHaveBeenCalled();
    expect(s.sent.length).toBe(before);
    expect(s.prefs.room("ABCD").mic).toBe("off");
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    s.voice.stop();

    const again = setup({ store, perm: "granted" });
    again.voice.onWelcome();
    again.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    await flush();
    expect(again.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(again.gum).not.toHaveBeenCalled();
    expect(again.voice.view().talking).toBe(false);
  });

  it("host-muted with the mic denied keeps the saved on, so the reload asks again", async () => {
    const store = memoryStore();
    voicePrefs(store).setRoom("ABCD", { on: true, mic: "on" });
    const s = setup({ store, perm: "prompt" });
    s.voice.onWelcome();
    await flush();
    expect(s.voice.view().needsMicTap).toBe(true);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    expect(s.sent[0]).toEqual({ type: "voice-join", muted: true });
    expect(s.prefs.room("ABCD").mic).toBe("on");
    s.voice.stop();

    const again = setup({ store, perm: "prompt" });
    again.voice.onWelcome();
    again.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    await flush();
    expect(again.voice.view().needsMicTap).toBe(true);
    expect(again.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(again.prefs.room("ABCD").mic).toBe("on");
  });

  it("unmute while host-muted toasts The host muted you. and sends nothing", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ mode: "ptt" });
    const s = await joined({ store });
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    s.toasts.length = 0;
    const before = s.sent.length;
    const published = s.t().ops("setPublishing").length;
    s.voice.setMuted(false);
    expect(s.toasts).toEqual(["The host muted you."]);
    s.voice.setPtt(true);
    expect(s.toasts).toEqual(["The host muted you.", "The host muted you."]);
    expect(s.voice.view().pttHeld).toBe(false);
    expect(s.sent.length).toBe(before);
    expect(s.t().ops("setPublishing")).toHaveLength(published);
    expect(s.t().lastPublished()).not.toBe(s.tracks[0]!.asTrack());
  });

  it("toasts once on host mute and once on the lift, not for other members", async () => {
    const s = await joined();
    expect(s.toasts).toEqual([]);
    s.voice.onVoiceState([member("me"), member("b", { selfMuted: true, hostMuted: true })]);
    expect(s.toasts).toEqual([]);
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b", { selfMuted: true, hostMuted: true })]);
    expect(s.toasts).toEqual(["The host muted you."]);
    // Another change while still host-muted: no new toast.
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b", { selfMuted: true })]);
    expect(s.toasts).toEqual(["The host muted you."]);
    // A reconnect with nothing changed for me: no toast.
    s.voice.onWelcome();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b", { selfMuted: true })]);
    expect(s.toasts).toEqual(["The host muted you."]);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b", { selfMuted: true })]);
    expect(s.toasts).toEqual(["The host muted you.", "You can talk again. Tap the mic to talk."]);
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    expect(s.toasts).toHaveLength(2);
  });

  it("a fresh page host-muted from the start shows no toast", async () => {
    const store = memoryStore();
    voicePrefs(store).setRoom("ABCD", { on: true, mic: "on" });
    const s = setup({ store, perm: "granted" });
    s.voice.onWelcome();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    await flush();
    s.voice.onVoiceState([member("me", { selfMuted: true, hostMuted: true }), member("b")]);
    expect(s.toasts).toEqual([]);
  });

  it("Mute for me and volume are saved for this room", async () => {
    const store = memoryStore();
    const s = await joined({ store }, true, ["b", "c"]);
    const gain = vi.spyOn(s.playback, "setGain");
    s.voice.setVolume("b", 0.5);
    expect(gain).toHaveBeenLastCalledWith("b", 0.5);
    s.voice.setVolume("c", 9);
    expect(gain).toHaveBeenLastCalledWith("c", 1.5);
    s.voice.setBlocked("b", true);
    expect(gain).toHaveBeenLastCalledWith("b", 0);
    await s.clock.advance(VOLUME_SAVE_MS);
    expect(voicePrefs(store).room("ABCD")).toMatchObject({ volumes: { b: 0.5, c: 1.5 }, blocked: ["b"] });
    const b = s.voice.view().members.find((m) => m.id === "b")!;
    expect([b.volume, b.blocked]).toEqual([0.5, true]);
    s.voice.setBlocked("b", false);
    expect(gain).toHaveBeenLastCalledWith("b", 0.5);
    s.voice.setBlocked("b", true);
    s.voice.stop();

    // A new page in the same room puts them back.
    const again = setup({ store });
    const gain2 = vi.spyOn(again.playback, "setGain");
    await again.voice.join(false);
    again.voice.onVoiceState(roster("me", "b", "c"));
    expect(gain2).toHaveBeenCalledWith("b", 0);
    expect(gain2).toHaveBeenCalledWith("c", 1.5);
  });

  it("a volume slider saves once, after it stops moving; leaving saves at once", async () => {
    const store = memoryStore();
    const writes: string[] = [];
    const counted: KeyValue = { read: store.read, write: (k, v) => (writes.push(k), store.write(k, v)) };
    const s = await joined({ store: counted });
    const gain = vi.spyOn(s.playback, "setGain");
    writes.length = 0;
    for (let i = 1; i <= 20; i++) s.voice.setVolume("b", i / 20);
    expect(gain).toHaveBeenLastCalledWith("b", 1);
    expect(s.voice.view().members.find((m) => m.id === "b")!.volume).toBe(1);
    expect(writes).toEqual([]);
    await s.clock.advance(VOLUME_SAVE_MS);
    expect(writes.filter((k) => k === "voice-room:ABCD")).toHaveLength(1);
    expect(voicePrefs(store).room("ABCD").volumes.b).toBe(1);
    // stop() sends nothing and writes "on" nowhere, but a pending volume is not lost.
    s.voice.setVolume("b", 0.25);
    s.voice.stop();
    expect(voicePrefs(store).room("ABCD").volumes.b).toBe(0.25);
    expect(s.clock.pending()).toBe(0);
  });

  it("a game switch or restart touches nothing", async () => {
    const s = await joined();
    s.voice.onRoom(room({ phase: "lobby" }));
    const calls = s.t().calls.length;
    const sent = s.sent.length;
    for (const r of [
      room({ phase: "playing", gameId: "bluff", roundNumber: 1 }),
      room({ phase: "results", gameId: "bluff", roundNumber: 1 }),
      room({ phase: "lobby", gameId: "cheat", roundNumber: 0 }),
      room({ phase: "playing", gameId: "cheat", roundNumber: 2 }),
    ]) {
      s.voice.onRoom(r);
    }
    expect(s.t().calls.length).toBe(calls);
    expect(s.sent.length).toBe(sent);
    expect(s.voice.view().status).toBe("on");
    expect(s.tracks[0]!.stops).toBe(0);
  });

  it("the ended phase stops voice", async () => {
    const s = await joined();
    const sent = s.sent.length;
    s.voice.onRoom(room({ phase: "ended", voice: { mode: "off" } }));
    expect(s.voice.view().status).toBe("off");
    expect(s.t().ops("disconnect")).toHaveLength(1);
    expect(s.tracks[0]!.stops).toBe(1);
    expect(s.sent.length).toBe(sent);
  });

  it("rejoin after welcome without me in the roster starts a new session", async () => {
    const s = await joined();
    // Someone else's change that does not list me yet: nothing.
    s.voice.onVoiceState(roster("b"));
    expect(s.transports).toHaveLength(1);
    // A reconnect after my seat was dropped from voice.
    s.voice.onWelcome();
    s.voice.onVoiceState(roster("b"));
    expect(s.t(0).ops("disconnect")).toHaveLength(1);
    expect(s.transports).toHaveLength(2);
    expect(s.types().filter((x) => x === "voice-join")).toHaveLength(2);
    expect(s.sent.at(-1)).toEqual({ type: "voice-join", muted: false });
    expect(s.tracks[0]!.stops).toBe(0);
    expect(s.voice.view().status).toBe("joining");
    s.voice.onVoiceState(roster("b", "me"));
    s.voice.onIce(STUN, 1e12);
    expect(s.t(1).ops("connect")[0]!.args[0]).toMatchObject({ session: "s2" });
    expect(s.t(1).lastPublished()).toBe(s.tracks[0]!.asTrack());
    expect(s.voice.view().status).toBe("on");
  });

  it("a welcome with me still in the roster keeps the links", async () => {
    const s = await joined();
    s.voice.onWelcome();
    s.voice.onVoiceState(roster("me", "b"));
    expect(s.transports).toHaveLength(1);
    expect(s.t().ops("disconnect")).toEqual([]);
    expect(s.types()).toEqual(["voice-join"]);
  });

  it("after a takeover, Use here rejoins on the next welcome and sends no voice-leave", async () => {
    const s = await joined({ perm: "granted" });
    // Another tab took the seat: fatal, voice stops, nothing sent.
    s.voice.stop();
    s.sent.length = 0;
    s.voice.resumeAfterTakeover();
    s.voice.onWelcome();
    s.voice.onVoiceState(roster("me", "b"));
    await flush();
    expect(s.types()).not.toContain("voice-leave");
    expect(s.types()).toContain("voice-join");
    // A new transport, so a new session.
    expect(s.transports).toHaveLength(2);
    expect(s.voice.view().mic).toBe("on");
  });

  it("after a takeover with voice saved off, the next welcome does not join", async () => {
    const s = await joined();
    s.voice.leave();
    s.voice.resumeAfterTakeover();
    s.voice.onWelcome();
    await flush();
    expect(s.voice.view().status).toBe("off");
  });

  it("a fresh page listed but not joining leaves", async () => {
    const s = setup();
    s.voice.onWelcome();
    s.voice.onVoiceState(roster("me", "b"));
    await flush();
    expect(s.sent).toEqual([{ type: "voice-leave" }]);
    // Later roster changes from others are left alone.
    s.voice.onVoiceState(roster("me", "b", "c"));
    expect(s.sent).toHaveLength(1);
  });

  it("reload rejoins: with the mic if allowed, otherwise listen only and Tap to talk again", async () => {
    const store = memoryStore();
    voicePrefs(store).setRoom("ABCD", { on: true });
    const granted = setup({ store, perm: "granted" });
    granted.voice.onWelcome();
    // The roster still lists me from the page before the reload.
    granted.voice.onVoiceState(roster("me", "b"));
    await flush();
    expect(granted.sent).toEqual([{ type: "voice-join", muted: false }]);
    expect(granted.voice.view().needsMicTap).toBe(false);
    // The server sends no new roster when it did not change: the old one counts.
    expect(granted.voice.view().status).toBe("on");
    expect(granted.t().ops("setPeers").at(-1)?.args[0]).toEqual(["b"]);
    granted.voice.onWelcome();
    await flush();
    expect(granted.types()).toEqual(["voice-join"]);

    const prompt = setup({ store, perm: "prompt" });
    prompt.voice.onWelcome();
    await flush();
    expect(prompt.gum).not.toHaveBeenCalled();
    expect(prompt.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(prompt.voice.view().needsMicTap).toBe(true);
    await prompt.voice.turnOnMic();
    expect(prompt.voice.view().needsMicTap).toBe(false);
    expect(prompt.sent.at(-1)).toEqual({ type: "voice-self-mute", muted: false });
    expect(prompt.voice.view().mic).toBe("on");

    const off = setup();
    off.voice.onWelcome();
    await flush();
    expect(off.sent).toEqual([]);
  });

  it("reload after Mute: joins muted, with the mic on but sending nothing", async () => {
    const store = memoryStore();
    const before = await joined({ store, perm: "granted" });
    before.voice.setMuted(true);
    expect(before.prefs.room("ABCD").mic).toBe("muted");
    before.voice.stop();

    const s = setup({ store, perm: "granted" });
    s.voice.onWelcome();
    s.voice.onVoiceState([member("me", { selfMuted: true }), member("b")]);
    await flush();
    expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(s.gum).toHaveBeenCalledTimes(1);
    expect(s.voice.view().mic).toBe("muted");
    expect(s.voice.view().needsMicTap).toBe(false);
    s.voice.onIce(STUN, 1e12);
    expect(s.t().lastPublished()).not.toBe(s.tracks[0]!.asTrack());
    // Unmute: sends, and the next reload talks again.
    s.voice.setMuted(false);
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    expect(s.prefs.room("ABCD").mic).toBe("on");

    // Muted, and the browser would ask: no prompt, no "Tap to talk again."
    voicePrefs(store).setRoom("ABCD", { mic: "muted" });
    const prompt = setup({ store, perm: "prompt" });
    prompt.voice.onWelcome();
    await flush();
    expect(prompt.gum).not.toHaveBeenCalled();
    expect(prompt.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(prompt.voice.view().needsMicTap).toBe(false);
    expect(prompt.prefs.room("ABCD").mic).toBe("muted");
  });

  it("reload after Turn off mic: joins with the mic off and no prompt", async () => {
    const store = memoryStore();
    const before = await joined({ store, perm: "granted" });
    before.voice.turnOffMic();
    expect(before.prefs.room("ABCD").mic).toBe("off");
    before.voice.stop();

    const s = setup({ store, perm: "granted" });
    s.voice.onWelcome();
    await flush();
    expect(s.gum).not.toHaveBeenCalled();
    expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
    expect(s.voice.view().mic).toBe("off");
    expect(s.voice.view().needsMicTap).toBe(false);
    expect(s.prefs.room("ABCD").mic).toBe("off");
    // Turn on mic again: the next reload talks.
    await s.voice.turnOnMic();
    expect(s.voice.view().mic).toBe("on");
    expect(s.prefs.room("ABCD").mic).toBe("on");
    s.voice.stop();
    const again = setup({ store, perm: "granted" });
    again.voice.onWelcome();
    await flush();
    expect(again.sent).toEqual([{ type: "voice-join", muted: false }]);
  });

  it("reload after Listen only: stays listen only, with no Tap to talk again.", async () => {
    const store = memoryStore();
    const before = setup({ store });
    await before.voice.join(false);
    expect(before.prefs.room("ABCD")).toMatchObject({ on: true, mic: "off" });
    before.voice.stop();

    for (const perm of ["granted", "prompt"] as const) {
      const s = setup({ store, perm });
      s.voice.onWelcome();
      await flush();
      expect(s.gum).not.toHaveBeenCalled();
      expect(s.sent).toEqual([{ type: "voice-join", muted: true }]);
      expect(s.voice.view().needsMicTap).toBe(false);
      expect(s.voice.view().mic).toBe("off");
    }
    // Join voice with the mic saves "on" again.
    const talk = setup({ store });
    await talk.voice.join(true);
    expect(talk.prefs.room("ABCD").mic).toBe("on");
  });

  it("a saved mic that is gone: voice uses any mic and forgets the saved one", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ micDeviceId: "usb" });
    const s = setup({ store, gum: "gone" });
    await s.voice.join(true);
    expect(s.sent).toEqual([{ type: "voice-join", muted: false }]);
    expect(s.voice.view().mic).toBe("on");
    expect(s.voice.settings().micDeviceId).toBeNull();
    expect(voicePrefs(store).get().micDeviceId).toBeNull();
    // Turn on mic after Turn off mic asks with no device now.
    s.voice.turnOffMic();
    await s.voice.turnOnMic();
    expect(s.gum).toHaveBeenCalledTimes(3);
    expect(s.voice.view().mic).toBe("on");

    // The same from Turn on mic.
    const store2 = memoryStore();
    const later = setup({ store: store2, gum: "gone" });
    await later.voice.join(false);
    await later.voice.updatePrefs({ micDeviceId: "usb" });
    await later.voice.turnOnMic();
    expect(later.voice.view().mic).toBe("on");
    expect(later.voice.settings().micDeviceId).toBeNull();

    // And from a settings change while the mic is on.
    const store3 = memoryStore();
    const live = await joined({ store: store3, gum: "gone" });
    await live.voice.updatePrefs({ micDeviceId: "usb" });
    expect(live.voice.view().mic).toBe("on");
    expect(live.voice.settings().micDeviceId).toBeNull();
    expect(live.t().lastPublished()).toBe(live.tracks[1]!.asTrack());
  });

  it("Turn on mic while deafened with Hear no one also mutes my mic: hears everyone again", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ deafenAlsoMutes: true });
    const s = await joined({ store });
    s.voice.turnOffMic();
    const deafen = vi.spyOn(s.playback, "setDeafened");
    s.voice.setDeafened(true);
    await s.voice.turnOnMic();
    expect(s.voice.view().deafened).toBe(false);
    expect(deafen).toHaveBeenLastCalledWith(false);
    expect(s.voice.view().mic).toBe("on");
    // Undeafen later does not put back a mute from before.
    s.voice.setDeafened(true);
    expect(s.voice.view().mic).toBe("muted");
    s.voice.setDeafened(false);
    expect(s.voice.view().mic).toBe("on");
  });

  it("after the party ends, nothing turns the mic on", async () => {
    const store = memoryStore();
    const s = await joined({ store, perm: "granted" });
    s.voice.onRoom(room({ phase: "ended", voice: { mode: "off" } }));
    const sent = s.sent.length;
    const asked = s.gum.mock.calls.length;
    await s.voice.join(true);
    await s.voice.turnOnMic();
    s.voice.setMuted(false);
    // A reconnect, or Use here after a takeover, into the ended room.
    s.voice.onWelcome();
    s.voice.resumeAfterTakeover();
    s.voice.onWelcome();
    s.voice.onRoom(room({ phase: "ended", voice: { mode: "off" } }));
    await flush();
    expect(s.sent.length).toBe(sent);
    expect(s.gum.mock.calls.length).toBe(asked);
    expect(s.voice.view().status).toBe("off");
    expect(s.transports).toHaveLength(1);
    // The saved "in voice" stays, but this page never acts on it.
    expect(s.prefs.room("ABCD").on).toBe(true);
  });

  it("a lost mic track asks for a tap and stops sending", async () => {
    const s = await joined();
    expect(s.t().lastPublished()).toBe(s.tracks[0]!.asTrack());
    s.tracks[0]!.dispatch("ended");
    expect(s.voice.view().mic).toBe("lost");
    expect(s.voice.view().needsMicTap).toBe(true);
    expect(s.t().lastPublished()).toBeNull();
    await s.voice.turnOnMic();
    expect(s.voice.view().mic).toBe("on");
    expect(s.voice.view().needsMicTap).toBe(false);
    expect(s.t().lastPublished()).toBe(s.tracks[1]!.asTrack());
  });

  it("relay only is used only when the servers include TURN", async () => {
    const store = memoryStore();
    voicePrefs(store).set({ relayOnly: true });
    const stun = setup({ store });
    await stun.voice.join(false);
    stun.voice.onIce(STUN, 1);
    expect(stun.t().ops("connect")[0]!.args[0]).toMatchObject({ relayOnly: false });
    expect(stun.voice.view().hasTurn).toBe(false);

    const turn = setup({ store });
    await turn.voice.join(false);
    turn.voice.onIce(TURN, 1);
    expect(turn.t().ops("connect")[0]!.args[0]).toMatchObject({ relayOnly: true });
    expect(turn.voice.view().hasTurn).toBe(true);

    // Changing it while in voice builds the links again.
    const s = await joined({}, true);
    await s.voice.updatePrefs({ relayOnly: true });
    expect(s.t(0).ops("disconnect")).toHaveLength(1);
    expect(s.transports).toHaveLength(2);
    s.voice.onIce(TURN, 1);
    expect(s.t(1).ops("connect")[0]!.args[0]).toMatchObject({ relayOnly: true, session: "s2" });
    expect(s.tracks[0]!.stops).toBe(0);
  });

  it("a mic or processing change restarts the mic and sends the new track", async () => {
    const s = await joined();
    const output = vi.spyOn(s.playback, "setOutput");
    await s.voice.updatePrefs({ noiseSuppression: false });
    expect(s.gum).toHaveBeenCalledTimes(2);
    expect(s.t().lastPublished()).toBe(s.tracks[1]!.asTrack());
    await s.voice.updatePrefs({ outputDeviceId: "spk" });
    expect(output).toHaveBeenCalledWith("spk");
    expect(s.gum).toHaveBeenCalledTimes(2);
    expect(s.prefs.get()).toMatchObject({ noiseSuppression: false, outputDeviceId: "spk" });
    // The saved speaker is used on the next join, too.
    const again = setup({ store: s.store });
    const output2 = vi.spyOn(again.playback, "setOutput");
    await again.voice.join(false);
    expect(output2).toHaveBeenCalledWith("spk");
  });

  it("speaking dots follow levels at 8 Hz", async () => {
    const s = await joined();
    s.playback.attach("b", fakeStream([new FakeTrack("rb")]));
    const peerAnalyser = s.env.ctx!.analysers.at(-1)!;
    let changes = 0;
    s.voice.subscribe(() => changes++);
    const tick = 1000 / METER_HZ;
    await s.clock.advance(tick);
    expect(changes).toBe(0);
    peerAnalyser.level = 0.2;
    await s.clock.advance(tick);
    expect(s.voice.view().members.find((m) => m.id === "b")!.speaking).toBe(true);
    expect(changes).toBe(1);
    // My own dot reads the mic meter, made on the first tick.
    const micAnalyser = s.env.ctx!.analysers.find((a) => a !== peerAnalyser)!;
    micAnalyser.level = 0.2;
    await s.clock.advance(tick);
    expect(s.voice.view().members.find((m) => m.id === "me")!.speaking).toBe(true);
    expect(changes).toBe(2);
    peerAnalyser.level = 0;
    await s.clock.advance(tick * (SPEAK_HOLD_TICKS - 1));
    expect(s.voice.view().members.find((m) => m.id === "b")!.speaking).toBe(true);
    await s.clock.advance(tick);
    expect(s.voice.view().members.find((m) => m.id === "b")!.speaking).toBe(false);
    expect(changes).toBe(3);
    s.voice.stop();
    expect(s.clock.pending()).toBe(0);
  });

  it("ICE refresh asks at most 3 times a minute and waits at most 3 s", async () => {
    const s = await joined();
    const refresh = () => s.t().deps.refreshIce();
    let done = false;
    const first = refresh().then(() => (done = true));
    expect(s.types().filter((x) => x === "voice-ice-request")).toHaveLength(1);
    // One at a time: a second call while waiting shares the request.
    void refresh();
    expect(s.types().filter((x) => x === "voice-ice-request")).toHaveLength(1);
    s.voice.onIce(TURN, 2e12);
    await first;
    expect(done).toBe(true);
    // No answer: gives up after the wait.
    let timedOut = false;
    void refresh().then(() => (timedOut = true));
    await s.clock.advance(ICE_REFRESH_WAIT_MS);
    expect(timedOut).toBe(true);
    const third = refresh();
    await s.clock.advance(ICE_REFRESH_WAIT_MS);
    await third;
    // The fourth in a minute: not sent, and it resolves at once.
    await refresh();
    expect(s.types().filter((x) => x === "voice-ice-request")).toHaveLength(3);
    await s.clock.advance(60_000);
    void refresh();
    expect(s.types().filter((x) => x === "voice-ice-request")).toHaveLength(4);
  });

  it("settings() gives a copy of the saved settings; micPermission() never throws", async () => {
    const s = setup({ perm: "granted" });
    await s.voice.updatePrefs({ mode: "ptt" });
    const got = s.voice.settings();
    expect(got.mode).toBe("ptt");
    got.mode = "open";
    expect(s.voice.settings().mode).toBe("ptt");
    await expect(s.voice.micPermission()).resolves.toBe("granted");
    await expect(setup({ perm: "throw" }).voice.micPermission()).resolves.toBe("unknown");
  });

  it("resumeSound() unlocks the shared context through Playback", async () => {
    const s = await joined();
    const resume = vi.spyOn(s.playback, "resume");
    s.voice.resumeSound();
    expect(resume).toHaveBeenCalledTimes(1);
    resume.mockImplementation(boom);
    expect(() => s.voice.resumeSound()).not.toThrow();
  });

  it("link states show on members, and a transport that throws never reaches the caller", async () => {
    const s = await joined();
    s.t().deps.onLinkState("b", "connected");
    expect(s.voice.view().members.find((m) => m.id === "b")!.link).toBe("connected");
    s.t().deps.sendSignal("b", "s1.0", { kind: "ice", toSession: null, candidates: [] });
    expect(s.sent.at(-1)).toEqual({ type: "voice-signal", to: "b", session: "s1.0", data: { kind: "ice", toSession: null, candidates: [] } });

    const bad = setup({ badTransport: true });
    await expect(bad.voice.join(true)).resolves.toBeUndefined();
    expect(() => bad.voice.onVoiceState(roster("me", "b"))).not.toThrow();
    expect(() => bad.voice.onIce(STUN, 1)).not.toThrow();
    expect(() => bad.voice.onSignal("b", "x", {})).not.toThrow();
    expect(() => bad.voice.setPtt(true)).not.toThrow();
    expect(() => bad.voice.leave()).not.toThrow();
    expect(() => bad.voice.stop()).not.toThrow();
  });
});
