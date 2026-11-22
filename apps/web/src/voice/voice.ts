// The voice controller: joins and leaves room voice, keeps the mic, the links
// and the speakers in step with the roster and the user's choices, and gives
// the bar one view to draw. Browser objects come in through VoiceDeps.
//
// Voice never breaks the game: every entry point catches its own errors, and
// nothing here logs signals, ICE servers or the roster.

import type { ClientMessage, ErrorCode, IceServer, RoomPublicState, VoiceMember } from "@games/protocol";
import { globalRule, type LinkState, type VoiceRule, type VoiceTransport } from "@games/webrtc";
import { MAX_GAIN, METER_HZ, nextSpeaking, type Mic, type MicPrefs, type Playback, type SpeakState } from "./audio.ts";
import type { MeshDeps } from "./mesh.ts";
import { DEFAULT_VOICE_PREFS, type RoomVoice, type VoicePrefs, type voicePrefs } from "./prefs.ts";

export type VoiceStatus = "off" | "joining" | "on" | "full" | "unsupported";
export type MicState = "on" | "muted" | "off" | "denied" | "lost";

export interface VoiceMemberView {
  id: string;
  selfMuted: boolean;
  hostMuted: boolean;
  speaking: boolean;
  volume: number;
  blocked: boolean;
  link: LinkState | null;
}

export interface VoiceView {
  status: VoiceStatus;
  mic: MicState;
  talking: boolean;
  deafened: boolean;
  pttHeld: boolean;
  mode: "open" | "ptt";
  members: VoiceMemberView[];
  needsSoundTap: boolean;
  needsMicTap: boolean;
  hasTurn: boolean;
  canPickOutput: boolean;
}

export interface VoiceDeps {
  code: string;
  send(msg: ClientMessage): void;
  selfId(): string | null;
  rtcSupported: boolean;
  createTransport(deps: Omit<MeshDeps, "createPeer" | "clock">): VoiceTransport;
  mic: Mic;
  playback: Playback;
  prefs: ReturnType<typeof voicePrefs>;
  micPermission(): Promise<"granted" | "denied" | "prompt" | "unknown">;
  newSession(): string;
  clock: MeshDeps["clock"];
}

/** Signals kept while waiting for the first voice-ice; the oldest go first. */
export const SIGNAL_QUEUE_MAX = 200;
/** A voice-ice-request gives up waiting after this. */
export const ICE_REFRESH_WAIT_MS = 3_000;
/** The server's ICE_REQUEST_LIMIT: more than this a minute is dropped there, so it is not sent. */
export const ICE_REFRESH_LIMIT = { burst: 3, windowMs: 60_000 };
/** A volume is saved this long after the last change to it. */
export const VOLUME_SAVE_MS = 300;

/** Talking = joined and not self-muted and not host-muted and rule.canTalk and transport up and (open mic or PTT held) and a live mic track. */
export function shouldPublish(s: {
  joined: boolean;
  selfMuted: boolean;
  hostMuted: boolean;
  canTalk: boolean;
  up: boolean;
  mode: "open" | "ptt";
  pttHeld: boolean;
  micLive: boolean;
}): boolean {
  return s.joined && !s.selfMuted && !s.hostMuted && s.canTalk && s.up && (s.mode === "open" || s.pttHeld) && s.micLive;
}

const hasTurnServer = (servers: IceServer[]) =>
  servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => typeof u === "string" && /^turns?:/.test(u)));

const clampVolume = (v: number) => Math.min(MAX_GAIN, Math.max(0, Number.isFinite(v) ? v : 1));

/**
 * idle: not in voice. starting: waiting on the mic (or the permission check)
 * before voice-join. joined: voice-join sent, until leave, stop or voice-full.
 */
type Phase = "idle" | "starting" | "joined";

export class VoiceController {
  private readonly deps: VoiceDeps;
  private readonly unsupported: boolean;

  private phase: Phase = "idle";
  private status: VoiceStatus;
  /** Bumped on every teardown: an older join that lands late does nothing. */
  private generation = 0;
  private welcomed = false;
  /** A welcome came since the last roster: the next roster is the server's view after a (re)connect. */
  private welcomeSinceRoster = false;

  private roster: VoiceMember[] = [];
  private transport: VoiceTransport | null = null;
  private session: string | null = null;
  /** connect() called on the current transport (the first voice-ice came). */
  private up = false;
  private queue: { from: string; session: string; data: unknown }[] = [];
  private iceServers: IceServer[] = [];
  /** The track last given to setPublishing on this transport. undefined: unknown, after a failed call, so the next change sends again. */
  private published: MediaStreamTrack | null | undefined = null;

  private selfMuted = false;
  private micIssue: "denied" | "lost" | null = null;
  private needsMicTap = false;
  private pttHeld = false;
  private deafened = false;
  /** The mute before "Hear no one also mutes my mic" muted it. */
  private muteBeforeDeafen: boolean | null = null;

  /** Read once; this tab is the only writer that matters while it runs. */
  private prefs: VoicePrefs;
  private roomPrefs: RoomVoice | null = null;
  /** A volume change waiting to be saved (a slider moves many times a second). */
  private saveTimer: number | null = null;
  private links = new Map<string, LinkState>();
  private speaking = new Map<string, SpeakState>();
  private meterTimer: number | null = null;

  private refreshing: Promise<void> | null = null;
  private refreshDone: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private refreshTimes: number[] = [];

  private readonly listeners = new Set<() => void>();

  constructor(deps: VoiceDeps) {
    this.deps = deps;
    this.unsupported = !deps.rtcSupported;
    this.status = this.unsupported ? "unsupported" : "off";
    this.prefs = this.unsupported ? { ...DEFAULT_VOICE_PREFS } : this.readPrefs();
    if (this.unsupported) return;
    this.guard(() => {
      deps.mic.onLost(() => this.guard(() => this.onMicLost()));
      deps.playback.onChange(() => this.notify());
    });
  }

  // ---- server and room events ----

  onWelcome(): void {
    if (this.unsupported) return;
    this.guard(() => {
      this.welcomeSinceRoster = true;
      if (this.welcomed) return;
      this.welcomed = true;
      if (this.phase === "idle" && this.room().on) void this.autoJoin();
    });
  }

  onVoiceState(members: VoiceMember[]): void {
    if (this.unsupported) return;
    this.guard(() => {
      this.roster = members.map((m) => ({ ...m }));
      const afterWelcome = this.welcomeSinceRoster;
      this.welcomeSinceRoster = false;
      const listed = this.isListed();
      if (this.phase === "joined") {
        if (listed) this.applyRoster();
        // A reconnect after my seat left voice: join again, keeping the mic.
        else if (afterWelcome) this.rejoin();
        // Otherwise someone else's change that does not list me yet.
      } else if (this.phase === "idle" && listed && afterWelcome) {
        // Listed from an earlier page, but not joining here: let the others stop trying.
        this.deps.send({ type: "voice-leave" });
      }
      this.notify();
    });
  }

  onSignal(from: string, session: string, data: unknown): void {
    if (this.unsupported) return;
    this.guard(() => {
      if (this.phase !== "joined" || !this.transport) return;
      if (this.up) return this.transport.handleSignal(from, session, data);
      this.queue.push({ from, session, data });
      if (this.queue.length > SIGNAL_QUEUE_MAX) this.queue.shift();
    });
  }

  onIce(iceServers: IceServer[], expiresAt: number): void {
    if (this.unsupported) return;
    this.guard(() => {
      this.finishRefresh();
      if (this.phase !== "joined" || !this.transport) return;
      this.iceServers = iceServers;
      const transport = this.transport;
      if (this.up) {
        transport.setIceServers(iceServers as RTCIceServer[], expiresAt);
      } else {
        const selfId = this.deps.selfId();
        if (!selfId || !this.session) return;
        transport.connect({
          selfId,
          session: this.session,
          iceServers: iceServers as RTCIceServer[],
          iceExpiresAt: expiresAt,
          relayOnly: this.prefs.relayOnly && hasTurnServer(iceServers),
        });
        this.up = true;
        const queued = this.queue;
        this.queue = [];
        for (const s of queued) this.guard(() => transport.handleSignal(s.from, s.session, s.data));
        this.syncPublishing();
      }
      this.notify();
    });
  }

  onError(code: ErrorCode): void {
    if (this.unsupported || code !== "voice-full") return;
    this.guard(() => {
      this.teardown();
      this.saveRoom({ on: false });
      this.setStatus("full");
    });
  }

  onRoom(room: RoomPublicState): void {
    if (this.unsupported) return;
    // Only the end of the party touches voice; game switches, results and restarts do not.
    if (room.phase === "ended") this.stop();
  }

  // ---- user actions ----

  async join(withMic: boolean): Promise<void> {
    if (this.unsupported || this.phase !== "idle") return;
    try {
      const gen = this.begin();
      await this.finishJoin(gen, withMic, false);
    } catch {
      // Voice never breaks the room.
    }
  }

  leave(): void {
    if (this.unsupported) return;
    this.guard(() => {
      if (this.phase !== "idle") this.deps.send({ type: "voice-leave" });
      this.teardown();
      this.saveRoom({ on: false });
      this.setStatus("off");
    });
  }

  /** Leave room, end party, fatal close, RoomView.destroy: tracks stopped, links closed, nothing sent. */
  stop(): void {
    if (this.unsupported) return;
    this.guard(() => {
      this.teardown();
      this.setStatus("off");
    });
  }

  setMuted(muted: boolean): void {
    if (this.unsupported) return;
    this.guard(() => {
      if (this.phase !== "joined") return;
      if (!muted) {
        // Host-muted: no unmute, and no mic prompt for one.
        if (this.hostMuted()) return;
        // "Hear no one also mutes my mic": talking again means hearing again.
        if (this.deafened && this.prefs.deafenAlsoMutes) {
          this.deafened = false;
          this.muteBeforeDeafen = null;
          this.deps.playback.setDeafened(false);
        }
        // Unmuting with no live mic means turning it on.
        if (!this.micLive()) return void this.turnOnMic();
      }
      this.applyMute(muted);
    });
  }

  turnOffMic(): void {
    if (this.unsupported) return;
    this.guard(() => {
      this.deps.mic.stop();
      this.micIssue = null;
      this.needsMicTap = false;
      if (this.phase === "joined") this.applyMute(true);
      else this.selfMuted = true;
      this.syncPublishing();
      this.notify();
    });
  }

  async turnOnMic(): Promise<void> {
    if (this.unsupported || this.phase !== "joined") return;
    try {
      const gen = this.generation;
      this.needsMicTap = false;
      this.notify();
      const r = await this.deps.mic.start(this.micPrefs());
      if (gen !== this.generation) return;
      if (r.ok) {
        this.micIssue = null;
        if (!this.hostMuted()) this.applyMute(false);
      } else if (r.reason !== "cancelled") {
        this.micIssue = "denied";
      }
      this.syncPublishing();
      this.notify();
    } catch {
      // Voice never breaks the room.
    }
  }

  setDeafened(deafened: boolean): void {
    if (this.unsupported) return;
    this.guard(() => {
      if (deafened === this.deafened) return;
      this.deafened = deafened;
      this.deps.playback.setDeafened(deafened);
      if (this.phase === "joined" && this.prefs.deafenAlsoMutes) {
        if (deafened) {
          this.muteBeforeDeafen = this.selfMuted;
          this.applyMute(true);
        } else if (this.muteBeforeDeafen !== null) {
          if (!this.muteBeforeDeafen && this.micLive() && !this.hostMuted()) this.applyMute(false);
          this.muteBeforeDeafen = null;
        }
      }
      this.notify();
    });
  }

  /** 0..1.5, default 1. Saved for this room by seat id. */
  setVolume(id: string, v: number): void {
    if (this.unsupported) return;
    this.guard(() => {
      const room = this.room();
      this.roomPrefs = { ...room, volumes: { ...room.volumes, [id]: clampVolume(v) } };
      this.applyGain(id);
      if (this.saveTimer !== null) this.deps.clock.clearTimeout(this.saveTimer);
      this.saveTimer = this.deps.clock.setTimeout(() => this.guard(() => this.flushSave()), VOLUME_SAVE_MS);
      this.notify();
    });
  }

  /** "Mute for me". Saved for this room by seat id. */
  setBlocked(id: string, blocked: boolean): void {
    if (this.unsupported) return;
    this.guard(() => {
      const rest = this.room().blocked.filter((b) => b !== id);
      this.saveRoom({ blocked: blocked ? [...rest, id] : rest });
      this.applyGain(id);
      this.notify();
    });
  }

  setPtt(held: boolean): void {
    if (this.unsupported) return;
    this.guard(() => {
      if (held === this.pttHeld) return;
      this.pttHeld = held;
      this.syncPublishing();
      this.notify();
    });
  }

  async updatePrefs(patch: Partial<VoicePrefs>): Promise<void> {
    if (this.unsupported) return;
    try {
      const before = this.prefs;
      const next = (this.prefs = this.deps.prefs.set(patch));
      if (next.mode !== before.mode) this.pttHeld = false;
      const micChanged =
        next.micDeviceId !== before.micDeviceId ||
        next.echoCancellation !== before.echoCancellation ||
        next.noiseSuppression !== before.noiseSuppression ||
        next.autoGainControl !== before.autoGainControl;
      if (next.outputDeviceId !== before.outputDeviceId) void this.deps.playback.setOutput(next.outputDeviceId);
      if (next.relayOnly !== before.relayOnly && this.phase === "joined") this.rejoin();
      this.syncPublishing();
      this.notify();
      if (micChanged && this.micLive()) {
        const gen = this.generation;
        const r = await this.deps.mic.restart(this.micPrefs());
        if (gen !== this.generation) return;
        // A failed restart keeps the old track where the browser allows it (not iOS).
        if (!r.ok && r.reason !== "cancelled" && !this.deps.mic.track) this.micIssue = "denied";
        this.syncPublishing();
        this.notify();
      }
    } catch {
      // Voice never breaks the room.
    }
  }

  // ---- view ----

  view(): VoiceView {
    const selfId = this.deps.selfId();
    const room = this.unsupported ? { on: false, volumes: {}, blocked: [] } : this.room();
    let needsSoundTap = false;
    let canPickOutput = false;
    try {
      needsSoundTap = this.phase === "joined" && this.deps.playback.needsTap;
      canPickOutput = !this.unsupported && this.deps.playback.canPickOutput;
    } catch {
      // Defaults above.
    }
    return {
      status: this.status,
      mic: this.micState(),
      talking: !!this.published,
      deafened: this.deafened,
      pttHeld: this.pttHeld,
      mode: this.prefs.mode,
      members: this.roster.map((m) => ({
        id: m.id,
        selfMuted: m.selfMuted,
        hostMuted: m.hostMuted,
        speaking: this.speaking.get(m.id)?.speaking ?? false,
        volume: room.volumes[m.id] ?? 1,
        blocked: room.blocked.includes(m.id),
        link: m.id === selfId ? null : (this.links.get(m.id) ?? null),
      })),
      needsSoundTap,
      needsMicTap: this.needsMicTap,
      hasTurn: hasTurnServer(this.iceServers),
      canPickOutput,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- joining ----

  /** The sync start of a join: status "joining" at once, so a roster that lands meanwhile is not taken as "not joining". */
  private begin(): number {
    this.phase = "starting";
    this.setStatus("joining");
    return this.generation;
  }

  /** A reload with voice on: the mic only if the browser already allows it, so no prompt pops up by itself. */
  private async autoJoin(): Promise<void> {
    try {
      const gen = this.begin();
      let perm: Awaited<ReturnType<VoiceDeps["micPermission"]>> = "unknown";
      try {
        perm = await this.deps.micPermission();
      } catch {
        // "unknown".
      }
      if (gen !== this.generation) return;
      await this.finishJoin(gen, perm === "granted", perm !== "granted");
    } catch {
      // Voice never breaks the room.
    }
  }

  private async finishJoin(gen: number, withMic: boolean, tapMic: boolean): Promise<void> {
    this.micIssue = null;
    if (withMic) {
      const r = await this.deps.mic.start(this.micPrefs());
      if (gen !== this.generation) return;
      // "cancelled": a newer request or a stop won; no error to show.
      if (!r.ok && r.reason !== "cancelled") this.micIssue = "denied";
    }
    const live = this.micLive();
    this.selfMuted = !live;
    if (this.deafened && this.prefs.deafenAlsoMutes) {
      // Deafened before joining: join muted, and undeafen puts back the mute it would have had.
      this.muteBeforeDeafen = this.selfMuted;
      this.selfMuted = true;
    }
    this.needsMicTap = tapMic && !live;
    this.phase = "joined";
    // The saved speaker. The browser may refuse until the first tap; the settings can set it again.
    if (this.prefs.outputDeviceId !== null) void this.deps.playback.setOutput(this.prefs.outputDeviceId).catch(() => false);
    this.openSession();
    this.deps.send({ type: "voice-join", muted: this.selfMuted });
    this.saveRoom({ on: true });
    // Already listed (a reload): the server sends no roster when nothing changed.
    if (this.isListed()) this.applyRoster();
    this.notify();
  }

  /** A fresh transport and session, keeping the mic. */
  private rejoin(): void {
    this.closeTransport();
    this.openSession();
    this.setStatus("joining");
    this.deps.send({ type: "voice-join", muted: this.selfMuted || !this.micLive() });
    if (this.isListed()) this.applyRoster();
  }

  private openSession(): void {
    this.session = this.deps.newSession();
    this.up = false;
    this.queue = [];
    this.published = null;
    this.links.clear();
    let transport: VoiceTransport | null = null;
    transport = this.deps.createTransport({
      sendSignal: (to, session, data) => {
        if (this.transport !== transport) return;
        this.deps.send({ type: "voice-signal", to, session, data });
      },
      playback: this.deps.playback,
      onLinkState: (peerId, state) => {
        if (this.transport !== transport || this.links.get(peerId) === state) return;
        this.links.set(peerId, state);
        this.notify();
      },
      refreshIce: () => (this.transport === transport ? this.refreshIce() : Promise.resolve()),
    });
    this.transport = transport;
  }

  private closeTransport(): void {
    const t = this.transport;
    this.transport = null;
    this.up = false;
    this.queue = [];
    this.published = null;
    this.links.clear();
    if (t) this.guard(() => t.disconnect());
  }

  /** Everything off, nothing sent. */
  private teardown(): void {
    this.flushSave();
    this.generation++;
    this.phase = "idle";
    this.closeTransport();
    this.session = null;
    this.iceServers = [];
    this.guard(() => this.deps.mic.stop());
    this.micIssue = null;
    this.needsMicTap = false;
    this.selfMuted = false;
    this.pttHeld = false;
    this.muteBeforeDeafen = null;
    this.speaking.clear();
    this.stopMeter();
    this.finishRefresh();
  }

  // ---- roster ----

  private isListed(): boolean {
    const selfId = this.deps.selfId();
    return !!selfId && this.roster.some((m) => m.id === selfId);
  }

  private others(): string[] {
    const selfId = this.deps.selfId();
    return this.roster.map((m) => m.id).filter((id) => id !== selfId);
  }

  /** The one seam phase 4 replaces when `room.voice.mode === "game"`. */
  private rule(): VoiceRule {
    return globalRule(this.deps.selfId() ?? "", this.roster.map((m) => m.id));
  }

  private applyRoster(): void {
    const t = this.transport;
    if (!t) return;
    this.setStatus("on");
    const others = this.others();
    for (const id of this.links.keys()) if (!others.includes(id)) this.links.delete(id);
    for (const id of this.speaking.keys()) if (!this.roster.some((m) => m.id === id)) this.speaking.delete(id);
    this.guard(() => t.setPeers(others));
    this.guard(() => t.applyPolicy(this.rule()));
    for (const id of others) this.applyGain(id);
    this.syncPublishing();
    this.startMeter();
  }

  private hostMuted(): boolean {
    const selfId = this.deps.selfId();
    return this.roster.find((m) => m.id === selfId)?.hostMuted ?? false;
  }

  // ---- mic and publishing ----

  private micPrefs(): MicPrefs {
    const p = this.prefs;
    return { deviceId: p.micDeviceId, echoCancellation: p.echoCancellation, noiseSuppression: p.noiseSuppression, autoGainControl: p.autoGainControl };
  }

  private micLive(): boolean {
    const track = this.deps.mic.track;
    return !!track && track.readyState !== "ended" && this.micIssue !== "lost";
  }

  private micState(): MicState {
    if (this.micIssue) return this.micIssue;
    if (!this.micLive()) return "off";
    return this.selfMuted || this.hostMuted() ? "muted" : "on";
  }

  /** Sends voice-self-mute when it changes. Never unmutes while host-muted. */
  private applyMute(muted: boolean): void {
    if (!muted && this.hostMuted()) return;
    if (muted !== this.selfMuted) {
      this.selfMuted = muted;
      this.deps.send({ type: "voice-self-mute", muted });
    }
    this.syncPublishing();
    this.notify();
  }

  private onMicLost(): void {
    if (!this.deps.mic.track) return;
    this.micIssue = "lost";
    this.needsMicTap = true;
    this.syncPublishing();
    this.notify();
  }

  /** Recomputes shouldPublish and tells the transport only when the track to send changed. */
  private syncPublishing(): void {
    const t = this.transport;
    if (!t) return;
    const on = shouldPublish({
      joined: this.phase === "joined",
      selfMuted: this.selfMuted,
      hostMuted: this.hostMuted(),
      canTalk: this.rule().canTalk,
      up: this.up,
      mode: this.prefs.mode,
      pttHeld: this.pttHeld,
      micLive: this.micLive(),
    });
    const want = on ? this.deps.mic.track : null;
    if (want === this.published) return;
    this.published = want;
    const failed = () => {
      if (this.transport === t && this.published === want) this.published = undefined;
    };
    try {
      void t.setPublishing(want).catch(failed);
    } catch {
      failed();
    }
  }

  // ---- gains ----

  private room(): RoomVoice {
    return (this.roomPrefs ??= this.deps.prefs.room(this.deps.code));
  }

  /** Saves now, with any volume still waiting. */
  private saveRoom(patch: Partial<RoomVoice>): void {
    if (this.saveTimer !== null) this.deps.clock.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.roomPrefs = this.deps.prefs.setRoom(this.deps.code, { ...this.room(), ...patch });
  }

  private flushSave(): void {
    if (this.saveTimer === null) return;
    this.saveRoom({});
  }

  private applyGain(id: string): void {
    const room = this.room();
    const gain = room.blocked.includes(id) ? 0 : (room.volumes[id] ?? 1);
    this.guard(() => this.deps.playback.setGain(id, gain));
  }

  // ---- speaking dots ----

  private startMeter(): void {
    if (this.meterTimer !== null || this.status !== "on") return;
    this.meterTimer = this.deps.clock.setTimeout(() => this.tick(), 1000 / METER_HZ);
  }

  private stopMeter(): void {
    if (this.meterTimer === null) return;
    this.deps.clock.clearTimeout(this.meterTimer);
    this.meterTimer = null;
  }

  private tick(): void {
    this.meterTimer = null;
    if (this.status !== "on") return;
    this.guard(() => {
      const levels = this.deps.playback.levels();
      const selfId = this.deps.selfId();
      let changed = false;
      for (const m of this.roster) {
        const level = m.id === selfId ? (this.published ? this.deps.mic.level() : 0) : (levels.get(m.id) ?? 0);
        const prev = this.speaking.get(m.id) ?? { speaking: false, quietTicks: 0 };
        const next = nextSpeaking(prev, level);
        this.speaking.set(m.id, next);
        if (next.speaking !== prev.speaking) changed = true;
      }
      if (changed) this.notify();
    });
    this.startMeter();
  }

  // ---- ICE refresh ----

  /** Sends voice-ice-request; resolves on the next voice-ice, or after 3 s. At most 3 a minute, one at a time. */
  private refreshIce(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const now = this.deps.clock.now();
    this.refreshTimes = this.refreshTimes.filter((t) => now - t < ICE_REFRESH_LIMIT.windowMs);
    // The server would drop it: go on with the servers we have.
    if (this.refreshTimes.length >= ICE_REFRESH_LIMIT.burst) return Promise.resolve();
    this.refreshTimes.push(now);
    this.refreshing = new Promise<void>((resolve) => {
      this.refreshDone = resolve;
    });
    this.refreshTimer = this.deps.clock.setTimeout(() => {
      this.refreshTimer = null;
      this.finishRefresh();
    }, ICE_REFRESH_WAIT_MS);
    this.guard(() => this.deps.send({ type: "voice-ice-request" }));
    return this.refreshing;
  }

  private finishRefresh(): void {
    if (this.refreshTimer !== null) this.deps.clock.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const done = this.refreshDone;
    this.refreshDone = null;
    this.refreshing = null;
    done?.();
  }

  // ---- plumbing ----

  private setStatus(status: VoiceStatus): void {
    if (status === this.status) return;
    this.status = status;
    if (status !== "on") {
      this.stopMeter();
      this.speaking.clear();
    }
    this.notify();
  }

  private notify(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        // A listener's trouble is not voice's.
      }
    }
  }

  private readPrefs(): VoicePrefs {
    try {
      return this.deps.prefs.get();
    } catch {
      return { ...DEFAULT_VOICE_PREFS };
    }
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      // Voice never breaks the room.
    }
  }
}
