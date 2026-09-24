// Interface only (§34). Sevens doesn't use peers; drawing games will.

export interface PeerTransport {
  connect(peerId: string): Promise<void>;
  send(peerId: string, channel: string, data: unknown): void;
  broadcast(channel: string, data: unknown): void;
  disconnect(peerId: string): void;
}
