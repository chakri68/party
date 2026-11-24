// The sound board on this phone: the list of tiles, the tap cooldown, and the
// clips that play when the room relays a sound. No timers and no polling here;
// the view draws the cooldown from `coolingMs()`.

import { type ClientMessage, SOUND_COOLDOWN_MS } from "@games/protocol";
import { type BoardSound, attempt, freeBoard, loadExtraPacks, parseHostList } from "./packs.ts";

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

interface Fetched {
  bytes: ArrayBuffer;
  url: string;
}

export class SoundBoard<Clip> {
  /** The tiles: always `[...base, ...host]`. */
  private sounds: readonly BoardSound[] = [];
  /** The free pack and the extra packs, from `load`. */
  private base: readonly BoardSound[] = [];
  /** The host's own sounds, from `loadHost`. */
  private host: readonly BoardSound[] = [];
  private known = new Set<string>();
  private clips = new Map<string, Clip>();
  /** Fetched bytes that wait for a context. Each leaves here once, to be decoded. */
  private waiting = new Map<string, Fetched>();
  /** For each host id, the url its bytes last came from. A url that fails is never noted, so it is tried again. */
  private hostFetched = new Map<string, string>();
  private hostRun: Promise<void> | null = null;
  private hostNext: Promise<void> | null = null;
  private hostNextUrl = "";
  /** Decodes run one after another, so a low-end phone isn't asked for dozens at once. */
  private decodes: Promise<void> = Promise.resolve();
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
    this.base = freeBoard();
    this.setList();
    const extra = await loadExtraPacks(extraPacks, (url) => this.deps.getJson(url));
    if (this.destroyed) return;
    this.base = [...this.base, ...extra];
    this.setList();
    await Promise.all(
      this.base.map(async ({ id, url }) => {
        const bytes = await attempt(() => this.deps.getBytes(url)).catch(() => null);
        if (!bytes || this.destroyed) return;
        this.queue(id, { bytes, url });
      }),
    );
  }

  /**
   * Lists the host's sounds again and fetches only the files that changed. A
   * call while one runs gives one more run after it, never more than one.
   */
  loadHost(listUrl: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (!this.hostRun) {
      const run = this.runHost(listUrl).finally(() => {
        if (this.hostRun === run) this.hostRun = null;
      });
      this.hostRun = run;
      return run;
    }
    this.hostNextUrl = listUrl;
    return (this.hostNext ??= this.hostRun.then(() => {
      this.hostNext = null;
      return this.loadHost(this.hostNextUrl);
    }));
  }

  private async runHost(listUrl: string): Promise<void> {
    // A failed fetch keeps the old list. A 404 (no host sounds) comes as null and clears it.
    const body = await attempt(() => this.deps.getJson(listUrl)).then(
      (b) => ({ b }),
      () => null,
    );
    if (!body || this.destroyed) return;
    const host = parseHostList(body.b, listUrl);
    const ids = new Set(host.map((s) => s.id));
    for (const id of this.host.map((s) => s.id)) {
      if (ids.has(id)) continue;
      this.clips.delete(id);
      this.waiting.delete(id);
      this.hostFetched.delete(id);
    }
    this.host = host;
    this.setList();
    await Promise.all(
      host
        .filter(({ id, url }) => this.hostFetched.get(id) !== url)
        .map(async ({ id, url }) => {
          const bytes = await attempt(() => this.deps.getBytes(url)).catch(() => null);
          if (!bytes || this.destroyed) return;
          this.hostFetched.set(id, url);
          this.queue(id, { bytes, url });
        }),
    );
  }

  private setList() {
    const seen = new Set<string>();
    this.sounds = [...this.base, ...this.host].filter((s) => !seen.has(s.id) && !!seen.add(s.id));
    this.known = seen;
    for (const fn of [...this.listeners]) fn();
  }

  private queue(id: string, fetched: Fetched) {
    this.waiting.set(id, fetched);
    if (this.deps.ready()) this.decodeWaiting();
  }

  /** True while these bytes are still the ones for this id: a host slot can be removed or replaced while they decode. */
  private current(id: string, url: string): boolean {
    return this.known.has(id) && (!this.hostFetched.has(id) || this.hostFetched.get(id) === url);
  }

  private decodeWaiting() {
    if (this.destroyed) return;
    for (const [id, { bytes, url }] of this.waiting) {
      this.waiting.delete(id);
      this.decodes = this.decodes.then(async () => {
        if (this.destroyed || !this.current(id, url)) return;
        const clip = await attempt(() => this.deps.decode(bytes)).catch(() => null);
        // The old clip, if any, plays until here.
        if (clip && !this.destroyed && this.current(id, url)) this.clips.set(id, clip);
      });
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
