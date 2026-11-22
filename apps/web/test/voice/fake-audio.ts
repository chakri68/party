// Fakes for the playback and mic tests: an AudioContext that records its
// graph, a detached <audio> element, and a media track you can fire events on.

import type { AudioEnv } from "../../src/voice/audio.ts";

export class FakeNode {
  readonly connected: unknown[] = [];
  readonly disconnects: unknown[] = [];
  disconnected = false;
  connect(to: unknown): unknown {
    this.connected.push(to);
    return to;
  }
  disconnect(to?: unknown): void {
    this.disconnected = true;
    this.disconnects.push(to);
  }
}

export class FakeGain extends FakeNode {
  gain = { value: 1 };
}

export class FakeSource extends FakeNode {
  readonly stream: unknown;
  constructor(stream: unknown) {
    super();
    this.stream = stream;
  }
}

export class FakeAnalyser extends FakeNode {
  fftSize = 0;
  /** What the next getFloatTimeDomainData fills the buffer with. */
  level = 0;
  getFloatTimeDomainData(buf: Float32Array): void {
    buf.fill(this.level);
  }
}

export class FakeContext {
  state: string = "running";
  closed = false;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly analysers: FakeAnalyser[] = [];
  sinkIds: string[] = [];
  constructor(withSinkId = false) {
    if (withSinkId) {
      (this as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId = (id) => {
        this.sinkIds.push(id);
        return Promise.resolve();
      };
    }
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createMediaStreamSource(stream: unknown): FakeSource {
    const s = new FakeSource(stream);
    this.sources.push(s);
    return s;
  }
  createAnalyser(): FakeAnalyser {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

export class FakeElement {
  srcObject: MediaStream | null = null;
  muted = false;
  volume = 1;
  plays = 0;
  /** Set to make play() reject, like a browser that wants a tap first. */
  rejectPlay = false;
  play(): Promise<void> {
    this.plays++;
    return this.rejectPlay ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
  }
}

export class FakeElementWithSink extends FakeElement {
  sinkIds: string[] = [];
  setSinkId(id: string): Promise<void> {
    this.sinkIds.push(id);
    return Promise.resolve();
  }
}

export class FakeAudioEnv implements AudioEnv {
  ctx: FakeContext | null;
  unlock?: () => void;
  readonly elements: FakeElement[] = [];
  private readonly listeners = new Set<(ctx: AudioContext) => void>();
  private readonly elementFactory: () => FakeElement;
  constructor(ctx: FakeContext | null = new FakeContext(), elementFactory: () => FakeElement = () => new FakeElement()) {
    this.ctx = ctx;
    this.elementFactory = elementFactory;
  }
  context(): AudioContext | null {
    return this.ctx ? this.ctx.asContext() : null;
  }
  onContext(fn: (ctx: AudioContext) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  createElement() {
    const el = this.elementFactory();
    this.elements.push(el);
    return el;
  }
  /** The context appears (a tap made it). */
  makeContext(ctx = new FakeContext()): FakeContext {
    this.ctx = ctx;
    this.fire();
    return ctx;
  }
  /** The context changed state. */
  setState(state: string): void {
    if (this.ctx) this.ctx.state = state;
    this.fire();
  }
  private fire(): void {
    if (this.ctx) for (const fn of [...this.listeners]) fn(this.ctx.asContext());
  }
}

export class FakeTrack {
  readyState: "live" | "ended" = "live";
  stops = 0;
  private readonly handlers = new Map<string, Set<() => void>>();
  readonly id: string;
  constructor(id = "t") {
    this.id = id;
  }
  stop(): void {
    this.stops++;
    this.readyState = "ended";
  }
  addEventListener(type: string, fn: () => void): void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.handlers.get(type)?.delete(fn);
  }
  dispatch(type: "ended" | "mute"): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn();
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

export const fakeStream = (tracks: FakeTrack[] = []): MediaStream =>
  ({ getAudioTracks: () => tracks.map((t) => t.asTrack()), getTracks: () => tracks.map((t) => t.asTrack()) }) as unknown as MediaStream;
