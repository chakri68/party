// Who is in room voice. The roster is stored with the room; this file only
// decides who still belongs on it.

import type { IceServer, Presence, RoomPhase, VoiceMember } from "@games/protocol";

/**
 * Members whose seat is still here and still a person: drops missing, bot,
 * "disconnected" and "left" seats, and everyone once the party has ended.
 * Order kept. The host is never host-muted: their entry comes back (a copy)
 * with `hostMuted: false`, so a new host is never stuck.
 */
export function pruneVoice(
  members: VoiceMember[],
  seats: { id: string; presence: Presence; bot?: true }[],
  phase: RoomPhase,
  hostId: string | null,
): VoiceMember[] {
  if (phase === "ended") return [];
  const here = new Set<string>();
  for (const s of seats) if (!s.bot && (s.presence === "connected" || s.presence === "reconnecting")) here.add(s.id);
  return members.filter((m) => here.has(m.id)).map((m) => (m.id === hostId && m.hostMuted ? { ...m, hostMuted: false } : m));
}

/** About 20 signals a second, burst 60. */
export const VOICE_SIGNAL_LIMIT = { burst: 60, windowMs: 3_000 };
export const TURN_TTL_S = 4 * 60 * 60;
/** A cached credential this close to expiry is fetched again. */
export const ICE_REUSE_MARGIN_MS = 30 * 60_000;
/** After a failed fetch, hand out STUN only for this long before trying again. */
export const ICE_FAIL_BACKOFF_MS = 60_000;
export const STUN_ONLY: IceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

type Mint = (ttlSeconds: number) => Promise<IceServer[] | null>;
type IceEntry = { iceServers: IceServer[]; expiresAt: number };

/** The room's ICE servers: one fetch at a time, shared by everyone who asks. In memory only. */
export class IceCache {
  private entry: (IceEntry & { reuseUntil: number }) | null = null;
  private inflight: Promise<IceEntry> | null = null;

  private readonly mint: Mint | undefined;
  private readonly now: () => number;

  constructor(mint: Mint | undefined, now: () => number) {
    this.mint = mint;
    this.now = now;
  }

  /** Cached if it has more than ICE_REUSE_MARGIN_MS left; one fetch in flight at a time, shared by callers. Never rejects. */
  get(): Promise<IceEntry> {
    const e = this.entry;
    if (e && e.reuseUntil > this.now()) return Promise.resolve(e);
    return (this.inflight ??= this.fetch().finally(() => (this.inflight = null)));
  }

  private async fetch(): Promise<IceEntry> {
    const start = this.now();
    let servers: IceServer[] | null = null;
    if (this.mint) {
      try {
        servers = await this.mint(TURN_TTL_S);
      } catch {
        servers = null;
      }
    }
    if (!this.mint) {
      const expiresAt = start + TURN_TTL_S * 1000;
      this.entry = { iceServers: STUN_ONLY, expiresAt, reuseUntil: expiresAt - ICE_REUSE_MARGIN_MS };
    } else if (servers && servers.length > 0) {
      const expiresAt = start + TURN_TTL_S * 1000;
      this.entry = { iceServers: servers, expiresAt, reuseUntil: expiresAt - ICE_REUSE_MARGIN_MS };
    } else {
      const expiresAt = start + ICE_FAIL_BACKOFF_MS;
      this.entry = { iceServers: STUN_ONLY, expiresAt, reuseUntil: expiresAt };
    }
    return this.entry;
  }
}
