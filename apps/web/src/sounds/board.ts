// The sound board on this phone: the list of tiles, the tap cooldown, and the
// clips that play when the room relays a sound. No timers and no polling here;
// the view draws the cooldown from `coolingMs()`.

import { type ClientMessage, SOUND_COOLDOWN_MS } from "@games/protocol";
import { type BoardSound, freeBoard, loadExtraPacks } from "./packs.ts";

/** The tile waits this much past the server's cooldown, so network jitter never drops a tap it allowed. */
export const COOLDOWN_SLACK_MS = 250;

export interface SoundBoardDeps<Clip> {
  getJson(url: string): Promise<unknown>;
  getBytes(url: string): Promise<ArrayBuffer | null>;
  decode(bytes: ArrayBuffer): Promise<Clip | null>;
  play(clip: Clip): boolean;
  /** True once there is an audio context to decode on. */
  ready(): boolean;
  onReady(fn: () => void): () => void;
  /** The phone's Sound board setting. */
  enabled(): boolean;
  send(msg: ClientMessage): void;
  now(): number;
}

export class SoundBoard<Clip> {
  private sounds: readonly BoardSound[] = [];
  private known = new Set<string>();
  private clips = new Map<string, Clip>();
  /** Fetched bytes that wait for a context. Each leaves here once, to be decoded. */
  private waiting = new Map<string, ArrayBuffer>();
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private coolUntil = 0;
  private destroyed = false;
  private readonly deps: SoundBoardDeps<Clip>;
  private readonly offReady: () => void;

  constructor(deps: SoundBoardDeps<Clip>) {
    this.deps = deps;
    this.offReady = deps.onReady(() => this.decodeWaiting());
  }

  list(): readonly BoardSound[] {
    return this.sounds;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Lists then fetches every sound. Runs once; a later call gives the same load. */
  load(extraPacks: readonly string[]): Promise<void> {
    return (this.loading ??= this.run(extraPacks));
  }

  private async run(extraPacks: readonly string[]): Promise<void> {
    this.setList(freeBoard());
    const extra = await loadExtraPacks(extraPacks, (url) => this.deps.getJson(url));
    if (this.destroyed) return;
    this.setList([...this.sounds, ...extra]);
    await Promise.all(
      this.sounds.map(async ({ id, url }) => {
        const bytes = await this.deps.getBytes(url).catch(() => null);
        if (!bytes || this.destroyed) return;
        this.waiting.set(id, bytes);
        if (this.deps.ready()) this.decodeWaiting();
      }),
    );
  }

  private setList(sounds: readonly BoardSound[]) {
    const seen = new Set<string>();
    this.sounds = sounds.filter((s) => !seen.has(s.id) && !!seen.add(s.id));
    this.known = seen;
    for (const fn of [...this.listeners]) fn();
  }

  private decodeWaiting() {
    if (this.destroyed) return;
    for (const [id, bytes] of this.waiting) {
      this.waiting.delete(id);
      this.deps.decode(bytes).then(
        (clip) => {
          if (clip && !this.destroyed) this.clips.set(id, clip);
        },
        () => {},
      );
    }
  }

  tap(id: string): "sent" | "cooling" | "unknown" {
    if (!this.known.has(id)) return "unknown";
    if (this.coolingMs() > 0) return "cooling";
    this.deps.send({ type: "sound", id });
    this.coolUntil = this.deps.now() + SOUND_COOLDOWN_MS + COOLDOWN_SLACK_MS;
    return "sent";
  }

  /** How long until the next tap can send; 0 when it can now. */
  coolingMs(): number {
    return Math.max(0, this.coolUntil - this.deps.now());
  }

  /** A sound the room relayed. A clip not decoded yet is skipped, never queued. */
  receive(id: string): boolean {
    if (!this.deps.enabled()) return false;
    const clip = this.clips.get(id);
    return clip !== undefined && this.deps.play(clip);
  }

  destroy(): void {
    this.destroyed = true;
    this.offReady();
    this.listeners.clear();
    this.waiting.clear();
  }
}
