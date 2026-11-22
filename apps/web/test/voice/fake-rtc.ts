// Fakes for the voice mesh tests: a peer connection that negotiates in memory,
// a network that carries signals between meshes, a clock and a playback sink.

import type { LinkState, SignalData, VoiceConnectOptions } from "@games/webrtc";
import { MeshTransport, type MeshDeps, type PeerLike, type PlaybackSink } from "../../src/voice/mesh.ts";

/** One shared, ordered record of the calls that matter for policy order. */
export type LogEntry =
  | { op: "replaceTrack"; owner: string; pc: FakePeer; track: string | null }
  | { op: "setAllowed"; owner: string; peer: string; allowed: boolean };

export class FakeTrack {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

export class FakeStream {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

class FakeSender {
  track: FakeTrack | null = null;
  private readonly pc: FakePeer;
  private readonly log: LogEntry[];
  constructor(pc: FakePeer, log: LogEntry[]) {
    this.pc = pc;
    this.log = log;
  }
  replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    this.track = track as unknown as FakeTrack | null;
    this.log.push({ op: "replaceTrack", owner: this.pc.owner, pc: this.pc, track: this.track?.id ?? null });
    return Promise.resolve();
  }
}

/**
 * One transceiver. Like a browser (JSEP): one made with addTransceiver gets a
 * mid only from its own offer; a remote offer's m-line with no transceiver
 * bound to it gets a new "recvonly" one, never an unbound local one.
 */
export class FakeTransceiver {
  mid: string | null = null;
  /** The direction last put in a local description. */
  negotiated: RTCRtpTransceiverDirection | null = null;
  /** ontrack has fired for this one. */
  tracked = false;
  readonly sender: FakeSender;
  readonly origin: "local" | "remote";
  private dir: RTCRtpTransceiverDirection;
  private readonly pc: FakePeer;

  constructor(pc: FakePeer, origin: "local" | "remote", direction: RTCRtpTransceiverDirection, log: LogEntry[]) {
    this.pc = pc;
    this.origin = origin;
    this.dir = direction;
    this.sender = new FakeSender(pc, log);
  }
  get direction(): RTCRtpTransceiverDirection {
    return this.dir;
  }
  set direction(d: RTCRtpTransceiverDirection) {
    if (d === this.dir) return;
    this.dir = d;
    this.pc.needNegotiation();
  }
}

type Desc = { type: RTCSdpType; sdp: string };
type MLine = { mid: string; dir: RTCRtpTransceiverDirection };

const sends = (d: string) => d === "sendrecv" || d === "sendonly";
const receives = (d: string) => d === "sendrecv" || d === "recvonly";

/** The fake's sdp: "<type>:<peer#>:<n>", then "|<mid>=<direction>,..." for its m-lines. */
export function fakeSdp(type: "offer" | "answer", num: number, n: number, mlines: string[] = ["0=sendrecv"]): string {
  return `${type}:${num}:${n}${mlines.length ? `|${mlines.join(",")}` : ""}`;
}

export function mlinesOf(sdp: string | undefined): MLine[] {
  const part = (sdp ?? "").split("|")[1];
  if (!part) return [];
  return part.split(",").map((s) => {
    const [mid = "", dir = "inactive"] = s.split("=");
    return { mid, dir: dir as RTCRtpTransceiverDirection };
  });
}

export class FakePeer {
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onnegotiationneeded: PeerLike["onnegotiationneeded"] = null;
  onicecandidate: PeerLike["onicecandidate"] = null;
  ontrack: PeerLike["ontrack"] = null;
  onconnectionstatechange: PeerLike["onconnectionstatechange"] = null;

  /** Offers this peer has made. */
  offers = 0;
  /** Answers this peer has made. */
  answers = 0;
  restarts = 0;
  rollbacks = 0;
  closed = false;
  /** Candidates handed to addIceCandidate, in order. */
  added: RTCIceCandidateInit[] = [];
  /** Remote descriptions set, in order. */
  remoteSet: Desc[] = [];
  configs: RTCConfiguration[] = [];
  transceivers: FakeTransceiver[] = [];
  /** The mesh id of the other end, known once connected. */
  remoteOwner: string | null = null;
  stats: Map<string, Record<string, unknown>> = new Map();
  /** Makes the next setRemoteDescription reject. */
  failNextRemote = false;
  /** Makes addIceCandidate reject for these candidate strings. */
  badCandidates = new Set<string>();

  private n = 0;
  private stableLocal: RTCSessionDescription | null = null;
  private negotiationPending = false;
  private restartPending = false;
  /** Mids given out by the local offer not yet answered; a rollback takes them back. */
  private pendingMids: FakeTransceiver[] = [];

  readonly num: number;
  readonly owner: string;
  readonly config: RTCConfiguration;
  private readonly net: FakeNet;

  constructor(num: number, owner: string, config: RTCConfiguration, net: FakeNet) {
    this.num = num;
    this.owner = owner;
    this.config = config;
    this.net = net;
  }

  addTransceiver(_kind: string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver {
    const t = new FakeTransceiver(this, "local", init?.direction ?? "sendrecv", this.net.log);
    this.transceivers.push(t);
    this.needNegotiation();
    return t as unknown as RTCRtpTransceiver;
  }

  getTransceivers(): RTCRtpTransceiver[] {
    return this.transceivers as unknown as RTCRtpTransceiver[];
  }

  async setLocalDescription(): Promise<void> {
    if (this.closed) throw new Error("closed");
    if (this.net.failLocal?.(this)) throw new Error("no local description");
    if (this.signalingState === "have-remote-offer") {
      const mlines = mlinesOf(this.remoteDescription?.sdp).map(({ mid, dir }) => {
        const t = this.byMid(mid);
        if (!t) return `${mid}=inactive`;
        t.negotiated = t.direction;
        const s = sends(t.direction) && receives(dir);
        const r = receives(t.direction) && sends(dir);
        return `${mid}=${s && r ? "sendrecv" : s ? "sendonly" : r ? "recvonly" : "inactive"}`;
      });
      this.localDescription = { type: "answer", sdp: fakeSdp("answer", this.num, ++this.n, mlines) } as RTCSessionDescription;
      this.answers++;
      this.becomeStable();
      return;
    }
    let next = Math.max(-1, ...this.transceivers.map((t) => (t.mid === null ? -1 : Number(t.mid)))) + 1;
    for (const t of this.transceivers) {
      if (t.mid !== null) continue;
      t.mid = String(next++);
      this.pendingMids.push(t);
    }
    const bound = this.transceivers.filter((t) => t.mid !== null).sort((x, y) => Number(x.mid) - Number(y.mid));
    for (const t of bound) t.negotiated = t.direction;
    const mlines = bound.map((t) => `${t.mid}=${t.direction}`);
    this.localDescription = { type: "offer", sdp: fakeSdp("offer", this.num, ++this.n, mlines) } as RTCSessionDescription;
    this.offers++;
    this.restartPending = false;
    this.signalingState = "have-local-offer";
  }

  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) throw new Error("closed");
    if (this.failNextRemote || this.net.failRemote?.(this)) {
      this.failNextRemote = false;
      throw new Error("bad sdp");
    }
    const desc = { type: d.type, sdp: d.sdp ?? "" } as RTCSessionDescription;
    if (desc.type === "offer") {
      if (this.signalingState === "have-local-offer") {
        this.rollbacks++;
        for (const t of this.pendingMids) t.mid = null;
        this.pendingMids = [];
        this.localDescription = this.stableLocal;
        this.signalingState = "stable";
      }
      if (this.signalingState !== "stable") throw new Error(`offer in ${this.signalingState}`);
      this.remoteDescription = desc;
      this.remoteSet.push({ type: desc.type, sdp: desc.sdp });
      this.signalingState = "have-remote-offer";
      for (const { mid, dir } of mlinesOf(desc.sdp)) {
        let t = this.byMid(mid);
        if (!t) {
          t = new FakeTransceiver(this, "remote", "recvonly", this.net.log);
          t.mid = mid;
          this.transceivers.push(t);
        }
        if (sends(dir)) this.fireTrack(t, desc.sdp);
      }
    } else if (desc.type === "answer") {
      if (this.signalingState !== "have-local-offer") throw new Error(`answer in ${this.signalingState}`);
      this.remoteDescription = desc;
      this.remoteSet.push({ type: desc.type, sdp: desc.sdp });
      this.pendingMids = [];
      for (const { mid, dir } of mlinesOf(desc.sdp)) {
        const t = this.byMid(mid);
        if (t && sends(dir)) this.fireTrack(t, desc.sdp);
      }
      this.becomeStable();
    } else {
      throw new Error(`unexpected ${desc.type}`);
    }
  }

  async addIceCandidate(c?: RTCIceCandidateInit | null): Promise<void> {
    if (this.closed) throw new Error("closed");
    if (!this.remoteDescription) throw new Error("no remote description");
    if (c?.candidate && this.badCandidates.has(c.candidate)) throw new Error("bad candidate");
    this.added.push(c ?? {});
  }

  restartIce(): void {
    this.restarts++;
    this.restartPending = true;
    this.needNegotiation();
  }

  setConfiguration(c: RTCConfiguration): void {
    if (this.closed) throw new Error("closed");
    this.configs.push(c);
  }

  async getStats(): Promise<RTCStatsReport> {
    return this.stats as unknown as RTCStatsReport;
  }

  close(): void {
    this.closed = true;
    this.signalingState = "closed";
    this.connectionState = "closed";
  }

  /** Gathers one local candidate, as the browser would. */
  emitCandidate(c: RTCIceCandidateInit): void {
    const candidate = { ...c, toJSON: () => ({ ...c }) };
    this.onicecandidate?.call(this as never, { candidate } as never);
  }

  /** The track this peer sends now, by id. */
  sentTrack(): string | null {
    return this.transceivers[0]?.sender.track?.id ?? null;
  }

  /** How many m-lines the current local description has. */
  mlineCount(): number {
    return mlinesOf(this.localDescription?.sdp).length;
  }

  /** Sets connectionState and fires the change event. */
  setState(s: RTCPeerConnectionState): void {
    if (this.closed || this.connectionState === s) return;
    this.connectionState = s;
    this.onconnectionstatechange?.call(this as never, {} as never);
  }

  /** Queues a check; like a browser, it fires only in "stable", and only when there is something to negotiate. */
  needNegotiation(): void {
    queueMicrotask(() => {
      if (this.closed) return;
      if (this.signalingState !== "stable") {
        this.negotiationPending = true;
        return;
      }
      const needed =
        this.restartPending || this.transceivers.some((t) => t.mid === null || t.negotiated !== t.direction);
      if (needed) this.onnegotiationneeded?.call(this as never, {} as never);
    });
  }

  private byMid(mid: string): FakeTransceiver | undefined {
    return this.transceivers.find((t) => t.mid === mid);
  }

  private fireTrack(t: FakeTransceiver, remoteSdp: string): void {
    if (t.tracked) return;
    t.tracked = true;
    const remoteNum = remoteSdp.split(":")[1];
    const streams = this.net.streamless ? [] : [new FakeStream(`stream:${remoteNum}`)];
    this.ontrack?.call(this as never, { streams, track: new FakeTrack(`remote:${remoteNum}`), transceiver: t } as never);
  }

  private becomeStable(): void {
    this.signalingState = "stable";
    this.stableLocal = this.localDescription;
    if (this.negotiationPending) {
      this.negotiationPending = false;
      this.needNegotiation();
    }
    this.net.checkPairs();
  }

  /** Stable, both descriptions set, and they match the other end's. */
  matches(other: FakePeer): boolean {
    return (
      this !== other &&
      !this.closed &&
      !other.closed &&
      this.signalingState === "stable" &&
      other.signalingState === "stable" &&
      this.localDescription !== null &&
      this.remoteDescription !== null &&
      this.localDescription.sdp === other.remoteDescription?.sdp &&
      this.remoteDescription.sdp === other.localDescription?.sdp
    );
  }

  /** Called by the net when this peer and `other` have negotiated. */
  link(other: FakePeer): void {
    this.remoteOwner = other.owner;
    this.setState("connected");
  }
}

export class FakeClock {
  t = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  pending(): number {
    return this.timers.size;
  }
  /** Moves time forward, firing due timers in time order, letting promises settle after each. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

export type PlaybackCall =
  | { op: "attach"; peer: string; stream: FakeStream }
  | { op: "detach"; peer: string }
  | { op: "setGain"; peer: string; gain: number }
  | { op: "setAllowed"; peer: string; allowed: boolean };

export class FakePlayback implements PlaybackSink {
  calls: PlaybackCall[] = [];
  private readonly owner: string;
  private readonly log: LogEntry[];
  constructor(owner: string, log: LogEntry[]) {
    this.owner = owner;
    this.log = log;
  }
  attach(peer: string, stream: MediaStream): void {
    this.calls.push({ op: "attach", peer, stream: stream as unknown as FakeStream });
  }
  detach(peer: string): void {
    this.calls.push({ op: "detach", peer });
  }
  setGain(peer: string, gain: number): void {
    this.calls.push({ op: "setGain", peer, gain });
  }
  setAllowed(peer: string, allowed: boolean): void {
    this.calls.push({ op: "setAllowed", peer, allowed });
    this.log.push({ op: "setAllowed", owner: this.owner, peer, allowed });
  }
  count(op: PlaybackCall["op"], peer?: string): number {
    return this.calls.filter((c) => c.op === op && (peer === undefined || c.peer === peer)).length;
  }
}

export interface Message {
  from: string;
  to: string;
  session: string;
  data: SignalData;
}

export interface Node {
  id: string;
  mesh: MeshTransport;
  playback: FakePlayback;
  /** Every peer connection this mesh made, in order. */
  pcs: FakePeer[];
  /** Every onLinkState call. */
  states: { peer: string; state: LinkState }[];
  refreshes: number;
  /** Runs on each refreshIce call; the default resolves at once. */
  onRefresh: () => Promise<void>;
}

/** Links meshes. Signals arrive after a microtask, through a JSON round trip. */
export class FakeNet {
  readonly clock = new FakeClock();
  readonly log: LogEntry[] = [];
  readonly sent: Message[] = [];
  /** ontrack events carry no stream, like a transceiver added without streams. */
  streamless = false;
  /** setLocalDescription / setRemoteDescription reject on the peers this picks. */
  failLocal: ((pc: FakePeer) => boolean) | undefined;
  failRemote: ((pc: FakePeer) => boolean) | undefined;
  held: Message[] = [];
  private holding = false;
  private nodes = new Map<string, Node>();
  private all: FakePeer[] = [];

  add(id: string, opts: Partial<VoiceConnectOptions> = {}): Node {
    const playback = new FakePlayback(id, this.log);
    const node: Node = {
      id,
      playback,
      pcs: [],
      states: [],
      refreshes: 0,
      onRefresh: () => Promise.resolve(),
      mesh: undefined as unknown as MeshTransport,
    };
    const deps: MeshDeps = {
      createPeer: (config) => {
        const pc = new FakePeer(this.all.length + 1, id, config, this);
        this.all.push(pc);
        node.pcs.push(pc);
        return pc;
      },
      sendSignal: (to, session, data) => {
        const m: Message = { from: id, to, session, data };
        this.sent.push(m);
        if (this.holding) this.held.push(m);
        else this.deliver(m);
      },
      playback,
      onLinkState: (peer, state) => node.states.push({ peer, state }),
      refreshIce: () => {
        node.refreshes++;
        return node.onRefresh();
      },
      clock: this.clock,
    };
    node.mesh = new MeshTransport(deps);
    node.mesh.connect({ selfId: id, session: `s${id}`, iceServers: [], iceExpiresAt: Infinity, relayOnly: false, ...opts });
    this.nodes.set(id, node);
    return node;
  }

  hold(): void {
    this.holding = true;
  }
  /** Delivers the held messages (or the given ones, in the given order) and stops holding. */
  release(messages: Message[] = this.held): void {
    this.holding = false;
    const list = messages;
    this.held = [];
    for (const m of list) this.deliver(m);
  }

  deliver(m: Message): void {
    const copy = JSON.parse(JSON.stringify(m)) as Message;
    queueMicrotask(() => this.nodes.get(copy.to)?.mesh.handleSignal(copy.from, copy.session, copy.data));
  }

  checkPairs(): void {
    for (const a of this.all) {
      for (const b of this.all) {
        if (a.num < b.num && a.matches(b) && (a.connectionState !== "connected" || b.connectionState !== "connected")) {
          a.link(b);
          b.link(a);
        }
      }
    }
  }
}

/** Lets every queued promise and microtask run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Sets a peer's connectionState and fires onconnectionstatechange. */
export function fakeState(pc: FakePeer, s: RTCPeerConnectionState): void {
  pc.setState(s);
}

export function last<T>(list: T[]): T {
  const v = list[list.length - 1];
  if (v === undefined) throw new Error("empty");
  return v;
}
