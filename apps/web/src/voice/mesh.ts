// Peer-to-peer voice: one RTCPeerConnection per other seat in voice.
//
// Each link has one audio m-line. Only the impolite side (the higher seat id)
// adds a transceiver, sendrecv with no track, and so makes the first offer.
// The polite side adds none: it takes the transceiver the offer makes and turns
// it to sendrecv before answering. (A browser never reuses an addTransceiver
// transceiver for a remote offer, so if both added one, glare would give two
// m-lines.) Who we send to and who we play is changed only with replaceTrack
// and playback.setAllowed, never by renegotiating. Offers use "perfect
// negotiation": the polite side gives way when both offer at once (ICE
// restarts). The polite side says hello (an empty "ice" signal) on every new
// link, so the other side learns it started over.
//
// Sessions: every signal carries the sender's link session (`<session>.<rebuilds>`)
// and, in its data, the receiver's session it is answering (`toSession`). That
// lets each side drop signals meant for a link that is gone, and notice when
// the other side started over.
//
// Nothing here throws to the caller, and nothing logs SDP or candidates.

import type {
  LinkState,
  SignalData,
  VoiceConnectOptions,
  VoicePeerStats,
  VoiceRule,
  VoiceTransport,
} from "@games/webrtc";

/** The bits of RTCPeerConnection the mesh uses. FakePeer implements the same. */
export type PeerLike = Pick<
  RTCPeerConnection,
  | "signalingState"
  | "connectionState"
  | "localDescription"
  | "remoteDescription"
  | "addTransceiver"
  | "getTransceivers"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "addIceCandidate"
  | "restartIce"
  | "setConfiguration"
  | "getStats"
  | "close"
  | "onnegotiationneeded"
  | "onicecandidate"
  | "ontrack"
  | "onconnectionstatechange"
>;

/** What the mesh plays into (Task 5's Playback has these). */
export interface PlaybackSink {
  attach(peerId: string, stream: MediaStream): void;
  detach(peerId: string): void;
  setGain(peerId: string, gain: number): void;
  setAllowed(peerId: string, allowed: boolean): void;
}

export interface MeshDeps {
  createPeer(config: RTCConfiguration): PeerLike;
  sendSignal(to: string, session: string, data: SignalData): void;
  playback: PlaybackSink;
  onLinkState(peerId: string, state: LinkState): void;
  /** Sends voice-ice-request; resolves on the next voice-ice, or after 3 s. */
  refreshIce(): Promise<void>;
  clock: { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
}

export const CANDIDATE_BATCH_MS = 100;
export const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
/** "disconnected" this long counts as failed. */
export const DISCONNECTED_GRACE_MS = 3_000;
/** Ask for new ICE servers before a restart when they expire within this. */
export const ICE_NEAR_EXPIRY_MS = 10 * 60_000;
/** A new link not connected this long after it opened, or after its last offer, is rebuilt. */
export const SETUP_TIMEOUT_MS = 15_000;

/** One peer connection to one seat. Replaced, never reused, on a rebuild. */
interface Link {
  pc: PeerLike;
  sender: RTCRtpSender | null;
  /** My session for this link, sent with every signal. */
  session: string;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Incoming candidates waiting for the remote description. */
  queued: RTCIceCandidateInit[];
  /** Outgoing candidates waiting for the next batch. */
  outgoing: RTCIceCandidateInit[];
  batchTimer: number | null;
  graceTimer: number | null;
  restartTimer: number | null;
  setupTimer: number | null;
  everConnected: boolean;
  /** ICE restarts tried since the link last connected. */
  attempt: number;
  recovering: boolean;
  connected: boolean;
  attached: boolean;
  /** The track the sender has now. undefined: unknown, after a failed replaceTrack. */
  sentTrack: MediaStreamTrack | null | undefined;
  playing: boolean;
  /** Incoming signals run one at a time, in arrival order. */
  chain: Promise<void>;
  closed: boolean;
}

/** What the mesh knows about one other seat. Outlives its links. */
interface Peer {
  id: string;
  rebuilds: number;
  /** The other side's link session, null until its first signal. */
  peerSession: string | null;
  retired: Set<string>;
  /**
   * After both sides rebuilt at once, the polite side took the other's new
   * session while that side still addressed my previous one. Its signals
   * bound to that old session of mine stay welcome.
   */
  late: { peerSession: string; mySession: string } | null;
  /** null only when the browser would not make a peer connection. */
  link: Link | null;
}

export class MeshTransport implements VoiceTransport {
  private opts: VoiceConnectOptions | null = null;
  private iceServers: RTCIceServer[] = [];
  private iceExpiresAt = 0;
  private wanted: string[] = [];
  private peers = new Map<string, Peer>();
  private rule: VoiceRule | null = null;
  private track: MediaStreamTrack | null = null;
  private refreshing: Promise<void> | null = null;
  private dead = false;

  private readonly deps: MeshDeps;

  constructor(deps: MeshDeps) {
    this.deps = deps;
  }

  connect(opts: VoiceConnectOptions): void {
    if (this.dead || this.opts) return;
    this.opts = opts;
    this.iceServers = opts.iceServers;
    this.iceExpiresAt = opts.iceExpiresAt;
    this.setPeers(this.wanted);
  }

  setPeers(peerIds: string[]): void {
    if (this.dead) return;
    this.wanted = [...peerIds];
    const opts = this.opts;
    if (!opts) return;
    const keep = new Set(peerIds.filter((id) => id !== opts.selfId));
    for (const peer of [...this.peers.values()]) {
      if (keep.has(peer.id)) continue;
      this.peers.delete(peer.id);
      if (peer.link) this.closeLink(peer, peer.link);
      this.report(peer.id, "closed");
    }
    for (const id of keep) if (!this.peers.has(id)) this.addPeer(id);
  }

  handleSignal(from: string, session: string, data: unknown): void {
    if (this.dead || !this.opts || from === this.opts.selfId || typeof session !== "string") return;
    const signal = readSignal(data);
    if (!signal) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // The roster can lag the first offer. A signal bound to one of my
      // sessions is for a link I closed, though, so it opens nothing.
      if (signal.toSession !== null) return;
      peer = this.addPeer(from, session);
    }
    if (peer.retired.has(session)) return;
    const toSession = signal.toSession;
    if (toSession !== null && toSession !== peer.link?.session) {
      const late = peer.late;
      if (late && late.peerSession === session && late.mySession === toSession) {
        // Still welcome: see Peer.late.
      } else if (session !== peer.peerSession && this.isMyOldSession(peer, toSession)) {
        // Both sides rebuilt at once: each new link addresses the other's old
        // session. The polite side takes the new session and starts over; the
        // impolite side keeps its fresh link (and its offer) and only rebinds.
        if (peer.peerSession !== null) peer.retired.add(peer.peerSession);
        peer.peerSession = session;
        if (!this.isPolite(peer)) return;
        peer.late = { peerSession: session, mySession: toSession };
        this.replaceLink(peer, "reconnecting");
      } else {
        return;
      }
    } else if (peer.peerSession === null) {
      peer.peerSession = session;
    } else if (peer.peerSession !== session) {
      // The other side started over: so do we, bound to its new session.
      peer.retired.add(peer.peerSession);
      peer.peerSession = session;
      this.replaceLink(peer, "connecting");
    }
    const link = peer.link;
    if (!link) return;
    link.chain = link.chain.then(() => this.process(peer, link, signal));
  }

  setIceServers(servers: RTCIceServer[], expiresAt: number): void {
    if (this.dead) return;
    this.iceServers = servers;
    this.iceExpiresAt = expiresAt;
    if (!this.opts) return;
    const config = this.config();
    for (const peer of this.peers.values()) {
      try {
        peer.link?.pc.setConfiguration(config);
      } catch {
        // A closing link; the next rebuild uses the new servers anyway.
      }
    }
  }

  setPublishing(track: MediaStreamTrack | null): Promise<void> {
    if (this.dead) return Promise.resolve();
    this.track = track;
    return this.runPolicy();
  }

  applyPolicy(rule: VoiceRule): void {
    if (this.dead) return;
    this.rule = { ...rule, hear: [...rule.hear], sendTo: [...rule.sendTo] };
    void this.runPolicy();
  }

  setRemoteGain(peerId: string, gain: number): void {
    if (this.dead) return;
    try {
      this.deps.playback.setGain(peerId, gain);
    } catch {
      // Playback trouble never reaches the room.
    }
  }

  async getStats(): Promise<VoicePeerStats[]> {
    if (this.dead) return [];
    const jobs: Promise<VoicePeerStats>[] = [];
    for (const peer of this.peers.values()) if (peer.link) jobs.push(statsFor(peer.id, peer.link.pc));
    return Promise.all(jobs);
  }

  disconnect(): void {
    if (this.dead) return;
    this.dead = true;
    for (const peer of this.peers.values()) {
      if (peer.link) this.closeLink(peer, peer.link);
      this.report(peer.id, "closed");
    }
    this.peers.clear();
  }

  // ---- links ----

  private addPeer(id: string, peerSession: string | null = null): Peer {
    const peer: Peer = { id, rebuilds: 0, peerSession, retired: new Set(), late: null, link: null };
    this.peers.set(id, peer);
    peer.link = this.openLink(peer, "connecting");
    return peer;
  }

  /** Starts over with a new link session of mine. */
  private rebuild(peer: Peer): void {
    peer.rebuilds++;
    peer.late = null;
    this.replaceLink(peer, "reconnecting");
  }

  private isPolite(peer: Peer): boolean {
    return this.opts!.selfId < peer.id;
  }

  /** A session of mine for this peer from before my latest rebuild. */
  private isMyOldSession(peer: Peer, s: string): boolean {
    const prefix = `${this.opts!.session}.`;
    if (!s.startsWith(prefix)) return false;
    const k = Number(s.slice(prefix.length));
    return Number.isInteger(k) && k >= 0 && k < peer.rebuilds;
  }

  private replaceLink(peer: Peer, state: LinkState): void {
    if (peer.link) this.closeLink(peer, peer.link);
    peer.link = this.openLink(peer, state);
    void this.runPolicy();
  }

  private openLink(peer: Peer, state: LinkState): Link | null {
    const opts = this.opts!;
    let pc: PeerLike;
    try {
      pc = this.deps.createPeer(this.config());
    } catch {
      this.report(peer.id, "closed");
      return null;
    }
    const link: Link = {
      pc,
      sender: null,
      session: `${opts.session}.${peer.rebuilds}`,
      polite: this.isPolite(peer),
      makingOffer: false,
      ignoreOffer: false,
      queued: [],
      outgoing: [],
      batchTimer: null,
      graceTimer: null,
      restartTimer: null,
      setupTimer: null,
      everConnected: false,
      attempt: 0,
      recovering: false,
      connected: false,
      attached: false,
      sentTrack: null,
      playing: false,
      chain: Promise.resolve(),
      closed: false,
    };
    pc.onnegotiationneeded = () => void this.negotiate(peer, link);
    pc.onicecandidate = (ev) => this.gather(peer, link, ev.candidate);
    pc.ontrack = (ev) => this.onTrack(peer, link, ev);
    pc.onconnectionstatechange = () => this.onState(peer, link);
    if (!link.polite) {
      try {
        link.sender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      } catch {
        this.shut(link);
        this.report(peer.id, "closed");
        return null;
      }
    }
    this.armSetup(peer, link);
    this.report(peer.id, state);
    if (link.polite) this.send(peer, link, { kind: "ice", toSession: peer.peerSession, candidates: [] });
    return link;
  }

  /** Closes a link and stops its stream. The caller reports the state. */
  private closeLink(peer: Peer, link: Link): void {
    this.shut(link);
    try {
      this.deps.playback.detach(peer.id);
    } catch {
      // Playback trouble never reaches the room.
    }
  }

  private shut(link: Link): void {
    link.closed = true;
    for (const t of [link.batchTimer, link.graceTimer, link.restartTimer, link.setupTimer]) {
      if (t !== null) this.deps.clock.clearTimeout(t);
    }
    link.batchTimer = link.graceTimer = link.restartTimer = link.setupTimer = null;
    const pc = link.pc;
    pc.onnegotiationneeded = pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // Already closed.
    }
  }

  private live(peer: Peer, link: Link): boolean {
    return !this.dead && !link.closed && peer.link === link && this.peers.get(peer.id) === peer;
  }

  private config(): RTCConfiguration {
    return { iceServers: this.iceServers, iceTransportPolicy: this.opts?.relayOnly ? "relay" : "all" };
  }

  private report(peerId: string, state: LinkState): void {
    try {
      this.deps.onLinkState(peerId, state);
    } catch {
      // The listener's trouble is not ours.
    }
  }

  private send(peer: Peer, link: Link, data: SignalData): void {
    try {
      this.deps.sendSignal(peer.id, link.session, data);
    } catch {
      // A dropped signal shows up as a failed link and takes the restart path.
    }
  }

  // ---- negotiation ----

  private async negotiate(peer: Peer, link: Link): Promise<void> {
    if (!this.live(peer, link)) return;
    try {
      link.makingOffer = true;
      await link.pc.setLocalDescription();
      if (this.live(peer, link)) this.sendDescription(peer, link);
    } catch {
      // A signaling error is not fixed by an ICE restart.
      if (this.live(peer, link)) this.rebuild(peer);
    } finally {
      link.makingOffer = false;
    }
  }

  private sendDescription(peer: Peer, link: Link): void {
    const d = link.pc.localDescription;
    if (!d) return;
    this.send(peer, link, { kind: "sdp", toSession: peer.peerSession, description: { type: d.type, sdp: d.sdp } });
    if (d.type === "offer" && !link.everConnected) this.armSetup(peer, link);
  }

  /** (Re)starts the timer that rebuilds a link that never connects. */
  private armSetup(peer: Peer, link: Link): void {
    this.clearTimer(link, "setupTimer");
    link.setupTimer = this.deps.clock.setTimeout(() => {
      link.setupTimer = null;
      if (this.live(peer, link) && !link.connected) this.rebuild(peer);
    }, SETUP_TIMEOUT_MS);
  }

  /** The polite side sends on the transceiver the offer made. */
  private adoptTransceiver(link: Link): void {
    const t = link.pc.getTransceivers()[0];
    if (!t) return;
    t.direction = "sendrecv";
    link.sender = t.sender;
    link.sentTrack = null;
    void this.runPolicy();
  }

  private async process(peer: Peer, link: Link, signal: SignalData): Promise<void> {
    if (!this.live(peer, link)) return;
    const pc = link.pc;
    try {
      if (signal.kind === "sdp") {
        const desc = signal.description;
        const collision = desc.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
        link.ignoreOffer = !link.polite && collision;
        if (link.ignoreOffer) return;
        // Candidates gathered for my offer that is about to roll back are stale.
        if (collision) link.outgoing = [];
        await pc.setRemoteDescription(desc);
        if (!this.live(peer, link)) return;
        if (desc.type === "offer" && !link.sender) this.adoptTransceiver(link);
        const queued = link.queued;
        link.queued = [];
        for (const c of queued) await addCandidate(pc, c);
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          if (this.live(peer, link)) this.sendDescription(peer, link);
        }
      } else {
        // Candidates for an offer I ignored are dropped.
        if (link.ignoreOffer) return;
        if (!pc.remoteDescription) {
          link.queued.push(...signal.candidates);
          return;
        }
        for (const c of signal.candidates) await addCandidate(pc, c);
      }
    } catch {
      // A signaling error is not fixed by an ICE restart.
      if (this.live(peer, link)) this.rebuild(peer);
    }
  }

  private gather(peer: Peer, link: Link, candidate: RTCIceCandidate | null): void {
    if (!candidate || !this.live(peer, link)) return;
    link.outgoing.push(candidate.toJSON());
    if (link.batchTimer !== null) return;
    link.batchTimer = this.deps.clock.setTimeout(() => {
      link.batchTimer = null;
      if (!this.live(peer, link) || link.outgoing.length === 0) return;
      const candidates = link.outgoing;
      link.outgoing = [];
      this.send(peer, link, { kind: "ice", toSession: peer.peerSession, candidates });
    }, CANDIDATE_BATCH_MS);
  }

  private onTrack(peer: Peer, link: Link, ev: RTCTrackEvent): void {
    if (!this.live(peer, link) || link.attached) return;
    // A transceiver added without streams gives the far side no stream.
    const stream = ev.streams[0] ?? (typeof MediaStream === "function" ? new MediaStream([ev.track]) : null);
    if (!stream) return;
    link.attached = true;
    try {
      this.deps.playback.attach(peer.id, stream);
      this.deps.playback.setAllowed(peer.id, link.playing);
    } catch {
      // Playback trouble never reaches the room.
    }
  }

  // ---- connection state and recovery ----

  private onState(peer: Peer, link: Link): void {
    if (!this.live(peer, link)) return;
    const state = link.pc.connectionState;
    if (state === "connected") {
      this.markConnected(peer, link);
    } else if (state === "failed") {
      this.fail(peer, link);
    } else if (state === "disconnected") {
      if (link.recovering) return;
      if (link.connected) {
        link.connected = false;
        this.report(peer.id, "reconnecting");
        void this.runPolicy();
      }
      if (link.graceTimer === null) {
        link.graceTimer = this.deps.clock.setTimeout(() => {
          link.graceTimer = null;
          if (this.live(peer, link) && link.pc.connectionState === "disconnected") this.fail(peer, link);
        }, DISCONNECTED_GRACE_MS);
      }
    }
  }

  private markConnected(peer: Peer, link: Link): void {
    this.clearTimer(link, "graceTimer");
    this.clearTimer(link, "restartTimer");
    this.clearTimer(link, "setupTimer");
    link.connected = true;
    link.everConnected = true;
    link.recovering = false;
    link.attempt = 0;
    this.report(peer.id, "connected");
    void this.runPolicy();
  }

  /** An ICE failure: restarts with backoff, then a rebuild. */
  private fail(peer: Peer, link: Link): void {
    if (link.pc.connectionState === "connected") {
      if (!link.connected) this.markConnected(peer, link);
      return;
    }
    if (link.recovering) return;
    link.recovering = true;
    this.clearTimer(link, "graceTimer");
    const wasConnected = link.connected;
    link.connected = false;
    this.report(peer.id, "reconnecting");
    if (wasConnected) void this.runPolicy();
    this.scheduleRecovery(peer, link);
  }

  private scheduleRecovery(peer: Peer, link: Link): void {
    const wait = RESTART_BACKOFF_MS[Math.min(link.attempt, RESTART_BACKOFF_MS.length - 1)]!;
    link.restartTimer = this.deps.clock.setTimeout(() => {
      link.restartTimer = null;
      void this.recover(peer, link);
    }, wait);
  }

  /** One try: an ICE restart while tries are left, then a fresh link. */
  private async recover(peer: Peer, link: Link): Promise<void> {
    if (!this.live(peer, link) || link.connected) return;
    // Back without a change event: nothing to fix.
    if (isUp(link.pc)) return this.markConnected(peer, link);
    await this.freshIce();
    if (!this.live(peer, link) || link.connected) return;
    if (isUp(link.pc)) return this.markConnected(peer, link);
    // A polite link that never got an offer has nothing to restart.
    if (link.attempt < RESTART_BACKOFF_MS.length && link.sender) {
      link.attempt++;
      try {
        link.pc.restartIce();
      } catch {
        // The next try comes anyway.
      }
      this.report(peer.id, "reconnecting");
      this.scheduleRecovery(peer, link);
    } else {
      this.rebuild(peer);
    }
  }

  /** Waits for new ICE servers when the ones we have expire soon. One request at a time. */
  private freshIce(): Promise<void> {
    if (this.iceExpiresAt - this.deps.clock.now() >= ICE_NEAR_EXPIRY_MS) return Promise.resolve();
    if (!this.refreshing) {
      let job: Promise<void>;
      try {
        job = this.deps.refreshIce();
      } catch {
        job = Promise.resolve();
      }
      this.refreshing = job
        .catch(() => {})
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  private clearTimer(link: Link, key: "batchTimer" | "graceTimer" | "restartTimer" | "setupTimer"): void {
    const t = link[key];
    if (t === null) return;
    this.deps.clock.clearTimeout(t);
    link[key] = null;
  }

  // ---- policy ----

  /** Applies the latest rule and track to every link: everything turned off first, then on. */
  private runPolicy(): Promise<void> {
    if (this.dead) return Promise.resolve();
    const rule = this.rule;
    const plans: { id: string; link: Link; send: MediaStreamTrack | null; play: boolean }[] = [];
    for (const peer of this.peers.values()) {
      const link = peer.link;
      if (!link) continue;
      const ok = link.connected && rule !== null;
      const send = ok && rule.canTalk && rule.sendTo.includes(peer.id) ? this.track : null;
      plans.push({ id: peer.id, link, send, play: ok && rule.hear.includes(peer.id) });
    }
    const jobs: Promise<void>[] = [];
    for (const p of plans) {
      if (p.send === null && p.link.sentTrack !== null) jobs.push(this.replace(p.link, null));
      if (!p.play && p.link.playing) this.allow(p.id, p.link, false);
    }
    for (const p of plans) {
      if (p.send !== null && p.link.sentTrack !== p.send) jobs.push(this.replace(p.link, p.send));
      if (p.play && !p.link.playing) this.allow(p.id, p.link, true);
    }
    return Promise.all(jobs).then(() => {});
  }

  private replace(link: Link, track: MediaStreamTrack | null): Promise<void> {
    if (!link.sender) return Promise.resolve();
    link.sentTrack = track;
    const forget = () => {
      if (link.sentTrack === track) link.sentTrack = undefined;
    };
    try {
      return link.sender.replaceTrack(track).catch(forget);
    } catch {
      forget();
      return Promise.resolve();
    }
  }

  private allow(peerId: string, link: Link, allowed: boolean): void {
    link.playing = allowed;
    try {
      this.deps.playback.setAllowed(peerId, allowed);
    } catch {
      // Playback trouble never reaches the room.
    }
  }
}

// ---- helpers ----

/** Read fresh each time: the state can change across an await. */
function isUp(pc: PeerLike): boolean {
  return pc.connectionState === "connected";
}

/** One bad candidate (say, from an old ICE round) is skipped; it never fails the link. */
async function addCandidate(pc: PeerLike, c: RTCIceCandidateInit): Promise<void> {
  try {
    await pc.addIceCandidate(c);
  } catch {
    // Skipped.
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** The signal in a voice-signal's data, or null when it is not one. */
function readSignal(data: unknown): SignalData | null {
  if (!isObject(data)) return null;
  const toSession = data.toSession;
  if (toSession !== null && typeof toSession !== "string") return null;
  if (data.kind === "sdp") {
    const d = data.description;
    if (!isObject(d) || (d.type !== "offer" && d.type !== "answer")) return null;
    if (d.sdp !== undefined && typeof d.sdp !== "string") return null;
    return { kind: "sdp", toSession, description: d.sdp === undefined ? { type: d.type } : { type: d.type, sdp: d.sdp } };
  }
  if (data.kind === "ice") {
    if (!Array.isArray(data.candidates)) return null;
    const candidates: RTCIceCandidateInit[] = [];
    for (const c of data.candidates) {
      if (!isObject(c) || typeof c.candidate !== "string") return null;
      const init: RTCIceCandidateInit = { candidate: c.candidate };
      if (typeof c.sdpMid === "string") init.sdpMid = c.sdpMid;
      if (typeof c.sdpMLineIndex === "number") init.sdpMLineIndex = c.sdpMLineIndex;
      if (typeof c.usernameFragment === "string") init.usernameFragment = c.usernameFragment;
      candidates.push(init);
    }
    return { kind: "ice", toSession, candidates };
  }
  return null;
}

async function statsFor(peerId: string, pc: PeerLike): Promise<VoicePeerStats> {
  const out: VoicePeerStats = { peerId, rttMs: null, packetsLost: null, relayed: null };
  try {
    const byId = new Map<string, Record<string, unknown>>();
    (await pc.getStats()).forEach((s: Record<string, unknown>) => {
      if (typeof s.id === "string") byId.set(s.id, s);
    });
    let pair: Record<string, unknown> | undefined;
    for (const s of byId.values()) {
      if (s.type === "transport" && typeof s.selectedCandidatePairId === "string") pair = byId.get(s.selectedCandidatePairId);
      if (s.type === "inbound-rtp" && s.kind === "audio" && typeof s.packetsLost === "number") out.packetsLost = s.packetsLost;
    }
    // Firefox has no transport stat; it marks the pair instead.
    pair ??= [...byId.values()].find((s) => s.type === "candidate-pair" && (s.selected === true || s.nominated === true));
    if (pair) {
      if (typeof pair.currentRoundTripTime === "number") out.rttMs = Math.round(pair.currentRoundTripTime * 1000);
      const local = typeof pair.localCandidateId === "string" ? byId.get(pair.localCandidateId) : undefined;
      if (local && typeof local.candidateType === "string") out.relayed = local.candidateType === "relay";
    }
  } catch {
    // No stats this time.
  }
  return out;
}
