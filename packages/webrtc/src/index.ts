// The voice transport interface. The web app's mesh (apps/web/src/voice/mesh.ts)
// is the one implementation; an SFU could be another behind the same calls.

/** One seat's voice rule. Phase 4 gets these from the server; now everyone gets globalRule. */
export interface VoiceRule {
  canTalk: boolean;
  hear: string[];
  sendTo: string[];
  label: string;
}

/** Everyone in voice hears and talks to everyone. label "". */
export function globalRule(selfId: string, memberIds: string[]): VoiceRule {
  const others = memberIds.filter((id) => id !== selfId);
  return { canTalk: true, hear: others, sendTo: [...others], label: "" };
}

export type LinkState = "connecting" | "connected" | "reconnecting" | "closed";

/** Rides inside voice-signal's opaque data. toSession: the recipient's link session the sender is bound to, null before it knows. */
export type SignalData =
  | { kind: "sdp"; toSession: string | null; description: { type: RTCSdpType; sdp?: string } }
  | { kind: "ice"; toSession: string | null; candidates: RTCIceCandidateInit[] };

export interface VoicePeerStats {
  peerId: string;
  rttMs: number | null;
  packetsLost: number | null;
  relayed: boolean | null;
}

export interface VoiceConnectOptions {
  selfId: string;
  session: string;
  iceServers: RTCIceServer[];
  iceExpiresAt: number;
  relayOnly: boolean;
}

export interface VoiceTransport {
  connect(opts: VoiceConnectOptions): void;
  /** The other seats in voice now. Opens links to new ones, closes links to gone ones. */
  setPeers(peerIds: string[]): void;
  handleSignal(from: string, session: string, data: unknown): void;
  setIceServers(servers: RTCIceServer[], expiresAt: number): void;
  /** The track to send, or null to send nothing. Always replaceTrack, never renegotiation. */
  setPublishing(track: MediaStreamTrack | null): Promise<void>;
  /** Sends only to rule.sendTo and plays only rule.hear. Removals before additions. Fail closed for peers not connected yet. */
  applyPolicy(rule: VoiceRule): void;
  setRemoteGain(peerId: string, gain: number): void;
  getStats(): Promise<VoicePeerStats[]>;
  disconnect(): void;
}
