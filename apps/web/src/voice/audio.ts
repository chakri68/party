// Voice in and out of the phone: remote streams into the speakers, my mic, and
// the speaking levels. Browser objects come in through `AudioEnv` and the
// `Mic` constructor, so all of it runs under test with fakes.

import type { PlaybackSink } from "./mesh.ts";

/**
 * How remote voice is played. The phone test can flip this with one line.
 *
 * - "graph": each stream runs through the shared AudioContext: source ->
 *   per-player GainNode -> analyser (levels) and -> one voiceOut gain ->
 *   destination. A muted <audio> element also holds the stream, because Chrome
 *   gives Web Audio no sound from a remote stream otherwise. The output device
 *   comes from AudioContext.setSinkId when there is one.
 * - "element": the fallback. No graph. Each stream plays through an unmuted
 *   <audio> element, `element.volume` is the gain (so 1 is the top: no boost
 *   above 100%), the output device comes from the element's own setSinkId, and
 *   `levels()` is empty (no speaking dots for other players).
 */
export const PLAYBACK: PlaybackConfig = { mode: "graph" };

export interface PlaybackConfig {
  mode: "graph" | "element";
}

export interface AudioEnv {
  context(): AudioContext | null;
  onContext(fn: (ctx: AudioContext) => void): () => void;
  /** A detached, muted <audio> element. Chrome gives Web Audio no sound from a remote stream without one. */
  createElement(): VoiceElement;
  /** A user tap: make or resume the context (`audio.unlock()`). */
  unlock?(): void;
}

export interface VoiceElement {
  srcObject: MediaStream | null;
  muted: boolean;
  play(): Promise<void>;
  /** Used by the element fallback only. */
  volume?: number;
  setSinkId?(id: string): Promise<void>;
}

export const MAX_GAIN = 1.5;
const FFT_SIZE = 256;

/** Root mean square of the analyser's newest samples, 0..1. */
function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.min(1, Math.sqrt(sum / buf.length));
}

interface GraphNodes {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
}

interface Entry {
  gain: number;
  allowed: boolean;
  stream: MediaStream | null;
  element: VoiceElement | null;
  nodes: GraphNodes | null;
}

export class Playback implements PlaybackSink {
  private readonly env: AudioEnv;
  private readonly mode: PlaybackConfig["mode"];
  private readonly entries = new Map<string, Entry>();
  private readonly voiceOut = new Map<AudioContext, GainNode>();
  private readonly listeners = new Set<() => void>();
  private readonly refused = new Set<string>();
  private readonly offContext: () => void;
  private deafened = false;
  private outputId: string | null = null;
  private probe: VoiceElement | null = null;
  private destroyed = false;
  private lastNeedsTap: boolean;

  constructor(env: AudioEnv, config: PlaybackConfig = PLAYBACK) {
    this.env = env;
    this.mode = config.mode;
    this.lastNeedsTap = this.needsTap;
    this.offContext = env.onContext(() => this.onContext());
  }

  attach(peerId: string, stream: MediaStream): void {
    if (this.destroyed) return;
    const entry = this.entry(peerId);
    this.dropMedia(peerId, entry);
    entry.stream = stream;
    try {
      const el = this.env.createElement();
      el.muted = this.mode === "graph";
      el.srcObject = stream;
      if (this.mode === "element" && this.outputId !== null) void el.setSinkId?.(this.outputId)?.catch(() => {});
      entry.element = el;
      this.applyGain(peerId, entry);
      this.play(peerId, el);
    } catch {
      // No element: the graph below can still carry the sound.
    }
    this.buildGraph(peerId, entry);
    this.changed();
  }

  detach(peerId: string): void {
    const entry = this.entries.get(peerId);
    if (!entry) return;
    this.dropMedia(peerId, entry);
    // The entry stays: a rebuilt link attaches again and keeps the user's volume
    // ("Mute for me"). The rule starts over, because the mesh sends it again.
    entry.allowed = false;
    this.changed();
  }

  /** User volume, 0..1.5, default 1. */
  setGain(peerId: string, gain: number): void {
    const entry = this.entry(peerId);
    entry.gain = Math.min(MAX_GAIN, Math.max(0, Number.isFinite(gain) ? gain : 1));
    this.applyGain(peerId, entry);
  }

  /** The rule. Default false. May come before `attach`. */
  setAllowed(peerId: string, allowed: boolean): void {
    const entry = this.entry(peerId);
    entry.allowed = allowed;
    this.applyGain(peerId, entry);
  }

  /** Effective gain = allowed && !deafened ? gain : 0. "Mute for me" is gain 0, set by the controller. */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const [id, entry] of this.entries) this.applyGain(id, entry);
  }

  /** Level 0..1 per peer, after its gain, for the speaking dots. Empty in element mode. */
  levels(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, entry] of this.entries) {
      if (entry.nodes) out.set(id, rms(entry.nodes.analyser, entry.nodes.buf));
    }
    return out;
  }

  /** True when sound is blocked until a tap: no context, or "suspended" or "interrupted" (graph); a refused play (element). */
  get needsTap(): boolean {
    if (this.mode === "element") return this.refused.size > 0;
    const ctx = this.env.context();
    return !ctx || ctx.state !== "running";
  }

  get canPickOutput(): boolean {
    if (this.mode === "graph") {
      const ctx = this.env.context();
      return !!ctx && "setSinkId" in ctx;
    }
    this.probe ??= this.env.createElement();
    return typeof this.probe.setSinkId === "function";
  }

  /** Null is the default device. Resolves false when the browser cannot or will not. */
  async setOutput(deviceId: string | null): Promise<boolean> {
    try {
      if (this.mode === "graph") {
        const ctx = this.env.context() as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null;
        if (!ctx?.setSinkId) return false;
        await ctx.setSinkId(deviceId ?? "");
        return true;
      }
      const elements = [...this.entries.values()].flatMap((e) => (e.element ? [e.element] : []));
      if (this.probe) elements.push(this.probe);
      const withSink = elements.filter((el) => typeof el.setSinkId === "function");
      if (!withSink.length) return false;
      await Promise.all(withSink.map((el) => el.setSinkId!(deviceId ?? "")));
      this.outputId = deviceId ?? "";
      return true;
    } catch {
      return false;
    }
  }

  /** The "Tap to turn on sound" tap: unlock the context and retry refused plays. */
  resume(): void {
    if (this.destroyed) return;
    try {
      this.env.unlock?.();
    } catch {
      // Nothing to unlock; the retry below still runs.
    }
    this.retryRefused();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Disconnects nodes and drops elements. Never closes the context (game sound shares it). */
  destroy(): void {
    this.destroyed = true;
    this.offContext();
    for (const [id, entry] of this.entries) this.dropMedia(id, entry);
    for (const out of this.voiceOut.values()) {
      try {
        out.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.voiceOut.clear();
    this.entries.clear();
    this.refused.clear();
    this.listeners.clear();
  }

  private entry(peerId: string): Entry {
    let entry = this.entries.get(peerId);
    if (!entry) this.entries.set(peerId, (entry = { gain: 1, allowed: false, stream: null, element: null, nodes: null }));
    return entry;
  }

  private effective(entry: Entry): number {
    return entry.allowed && !this.deafened ? entry.gain : 0;
  }

  private applyGain(peerId: string, entry: Entry): void {
    const g = this.effective(entry);
    if (entry.nodes) entry.nodes.gain.gain.value = g;
    if (this.mode === "element" && entry.element) {
      entry.element.volume = Math.min(1, g);
      // iOS ignores element.volume, so silence has to be a mute.
      const wasMuted = entry.element.muted;
      entry.element.muted = g === 0;
      // A browser pauses an element that script unmutes without a tap. play()
      // resolves if it still plays, and is refused (so the tap prompt shows) if not.
      if (wasMuted && g > 0) this.play(peerId, entry.element);
    }
  }

  private play(peerId: string, el: VoiceElement): void {
    let p: Promise<void>;
    try {
      p = el.play();
    } catch {
      return;
    }
    p.then(
      () => {
        if (this.refused.delete(peerId)) this.changed();
      },
      () => {
        // Only the element fallback needs the play to work: in the graph the
        // element is muted, and that always starts.
        if (this.mode === "element" && !this.destroyed && this.entries.get(peerId)?.element === el) {
          this.refused.add(peerId);
          this.changed();
        }
      },
    );
  }

  private buildGraph(peerId: string, entry: Entry): void {
    if (this.mode !== "graph" || !entry.stream || entry.nodes) return;
    const ctx = this.env.context();
    if (!ctx) return;
    try {
      let out = this.voiceOut.get(ctx);
      if (!out) {
        out = ctx.createGain();
        out.connect(ctx.destination);
        this.voiceOut.set(ctx, out);
      }
      const source = ctx.createMediaStreamSource(entry.stream);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(gain);
      gain.connect(analyser);
      gain.connect(out);
      entry.nodes = { ctx, source, gain, analyser, buf: new Float32Array(new ArrayBuffer(FFT_SIZE * 4)) };
      this.applyGain(peerId, entry);
    } catch {
      // A browser that refuses the graph: the entry stays silent, the game goes on.
    }
  }

  private dropMedia(peerId: string, entry: Entry): void {
    const nodes = entry.nodes;
    if (nodes) {
      for (const node of [nodes.source, nodes.gain, nodes.analyser]) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      entry.nodes = null;
    }
    if (entry.element) {
      entry.element.srcObject = null;
      entry.element = null;
    }
    entry.stream = null;
    this.refused.delete(peerId);
  }

  /** The context appeared or changed state. */
  private onContext(): void {
    if (this.destroyed) return;
    if (this.mode === "graph") {
      for (const [id, entry] of this.entries) this.buildGraph(id, entry);
    } else {
      this.retryRefused();
    }
    this.changed();
  }

  private retryRefused(): void {
    for (const id of [...this.refused]) {
      const el = this.entries.get(id)?.element;
      if (el) this.play(id, el);
    }
  }

  private changed(): void {
    const now = this.needsTap;
    if (now === this.lastNeedsTap) return;
    this.lastNeedsTap = now;
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        // A listener's failure must not reach the audio path or a promise callback.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mic
// ---------------------------------------------------------------------------

export interface MicPrefs {
  deviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export type MicResult = { ok: true; track: MediaStreamTrack } | { ok: false; reason: "denied" | "unavailable" | "cancelled" };

type GetUserMedia = (c: MediaStreamConstraints) => Promise<MediaStream>;

export class Mic {
  private stream: MediaStream | null = null;
  private current: MediaStreamTrack | null = null;
  /** Bumped by stop() and by each open(): an older request that lands late is dropped. */
  private generation = 0;
  private readonly lostListeners = new Set<() => void>();
  private meter: { ctx: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;
  private readonly onTrackLost = () => {
    for (const fn of [...this.lostListeners]) fn();
  };

  private readonly getUserMedia: GetUserMedia | null;
  private readonly isIOS: boolean;
  private readonly env: Pick<AudioEnv, "context"> | undefined;

  /** `env` is only for `level()`; the mic never plays into the speakers. */
  constructor(getUserMedia: GetUserMedia | null, isIOS: boolean, env?: Pick<AudioEnv, "context">) {
    this.getUserMedia = getUserMedia;
    this.isIOS = isIOS;
    this.env = env;
  }

  get track(): MediaStreamTrack | null {
    return this.current;
  }

  async start(prefs: MicPrefs): Promise<MicResult> {
    return this.open(prefs);
  }

  /**
   * New device or new processing: a new track. On iOS the old one stops first
   * (a second capture can fail while the first runs). Elsewhere the old one
   * stays until the new one is in hand. The caller passes it to setPublishing.
   */
  async restart(prefs: MicPrefs): Promise<MicResult> {
    if (this.isIOS) this.release();
    return this.open(prefs);
  }

  /** The track ended or went muted (iOS in the background, device pulled). */
  onLost(fn: () => void): () => void {
    this.lostListeners.add(fn);
    return () => this.lostListeners.delete(fn);
  }

  /** Own mic level 0..1, for my own dot. 0 until there is a context. */
  level(): number {
    const ctx = this.env?.context();
    if (!ctx || !this.stream || !this.current) return 0;
    if (this.meter?.ctx !== ctx || this.meter.stream !== this.stream) {
      this.dropMeter();
      try {
        const source = ctx.createMediaStreamSource(this.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        source.connect(analyser); // never on to the destination: no echo of myself
        this.meter = { ctx, stream: this.stream, source, analyser, buf: new Float32Array(new ArrayBuffer(FFT_SIZE * 4)) };
      } catch {
        return 0;
      }
    }
    return rms(this.meter.analyser, this.meter.buf);
  }

  /** Stops the track, so the browser's mic light goes off. */
  stop(): void {
    this.generation++;
    this.release();
  }

  private async open(prefs: MicPrefs): Promise<MicResult> {
    if (!this.getUserMedia) return { ok: false, reason: "unavailable" };
    const generation = ++this.generation;
    const audio: MediaTrackConstraints = {
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    };
    if (prefs.deviceId) audio.deviceId = { exact: prefs.deviceId };
    let stream: MediaStream;
    try {
      stream = await this.getUserMedia({ audio });
    } catch (err) {
      if (generation !== this.generation) return { ok: false, reason: "cancelled" };
      const name = (err as { name?: string } | null)?.name;
      const denied = name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError";
      return { ok: false, reason: denied ? "denied" : "unavailable" };
    }
    if (generation !== this.generation) {
      // stop() or a newer request came first: this mic must not stay on.
      for (const t of stream.getTracks?.() ?? []) t.stop();
      return { ok: false, reason: "cancelled" };
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks?.() ?? []) t.stop();
      return { ok: false, reason: "unavailable" };
    }
    this.release();
    this.stream = stream;
    this.current = track;
    track.addEventListener("ended", this.onTrackLost);
    track.addEventListener("mute", this.onTrackLost);
    return { ok: true, track };
  }

  private release(): void {
    this.dropMeter();
    const track = this.current;
    if (track) {
      track.removeEventListener("ended", this.onTrackLost);
      track.removeEventListener("mute", this.onTrackLost);
      track.stop();
    }
    this.current = null;
    this.stream = null;
  }

  private dropMeter(): void {
    if (!this.meter) return;
    for (const node of [this.meter.source, this.meter.analyser]) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.meter = null;
  }
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

export interface SpeakState {
  speaking: boolean;
  quietTicks: number;
}

export const SPEAK_ON = 0.05;
export const SPEAK_OFF = 0.03;
export const SPEAK_HOLD_TICKS = 3;
export const METER_HZ = 8;

/** Hysteresis: on at >= SPEAK_ON; off only after SPEAK_HOLD_TICKS ticks in a row below SPEAK_OFF. */
export function nextSpeaking(prev: SpeakState, level: number): SpeakState {
  if (level >= SPEAK_ON) return { speaking: true, quietTicks: 0 };
  if (!prev.speaking) return { speaking: false, quietTicks: 0 };
  if (level >= SPEAK_OFF) return { speaking: true, quietTicks: 0 };
  const quietTicks = prev.quietTicks + 1;
  return quietTicks >= SPEAK_HOLD_TICKS ? { speaking: false, quietTicks: 0 } : { speaking: true, quietTicks };
}
