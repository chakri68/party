// Keeps the phone's screen on while I am in voice, through the Screen Wake
// Lock API. The browser drops the lock when the page hides, so it is asked
// again when the page comes back. Every browser call is guarded: a missing
// API or a refused request leaves the screen to its own timer.

export interface WakeSentinel {
  release(): Promise<void>;
  addEventListener(type: "release", fn: () => void): void;
}

export interface WakeDeps {
  /** `navigator.wakeLock.request("screen")`, or null when the browser has no wake lock. */
  request: (() => Promise<WakeSentinel>) | null;
  visible(): boolean;
  /** Calls `fn` when the page shows or hides; returns a function that stops it. */
  onVisibility(fn: () => void): () => void;
}

export class VoiceWakeLock {
  private want = false;
  private destroyed = false;
  private sentinel: WakeSentinel | null = null;
  private pending = false;
  /** The last request was refused: wait for the next visible or a fresh set(true). */
  private refused = false;
  /** Counts visibility changes: a refusal from before a hide and show is stale. */
  private visibility = 0;
  private stopListening: () => void = () => {};
  private readonly deps: WakeDeps;

  constructor(deps: WakeDeps) {
    this.deps = deps;
    if (!deps.request) return;
    try {
      this.stopListening = deps.onVisibility(() => {
        this.visibility++;
        if (this.isVisible()) this.refused = false;
        this.sync();
      });
    } catch {
      // No visibility events: the lock still follows set().
    }
  }

  set(want: boolean): void {
    if (this.destroyed || want === this.want) return;
    this.want = want;
    if (want) this.refused = false;
    this.sync();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.want = false;
    try {
      this.stopListening();
    } catch {
      // Nothing more to stop.
    }
    this.sync();
  }

  private isVisible(): boolean {
    try {
      return this.deps.visible();
    } catch {
      return false;
    }
  }

  private shouldHold(): boolean {
    return this.want && !this.destroyed && this.isVisible();
  }

  private sync(): void {
    const request = this.deps.request;
    if (!request) return;
    if (!this.shouldHold()) {
      const s = this.sentinel;
      this.sentinel = null;
      if (s) release(s);
      return;
    }
    if (this.sentinel || this.pending || this.refused) return;
    this.pending = true;
    const asked = this.visibility;
    let p: Promise<WakeSentinel>;
    try {
      p = request();
    } catch {
      this.pending = false;
      this.refused = true;
      return;
    }
    p.then(
      (s) => {
        this.pending = false;
        if (!this.shouldHold()) return release(s);
        this.sentinel = s;
        try {
          s.addEventListener("release", () => {
            if (this.sentinel === s) this.sentinel = null;
          });
        } catch {
          // Without the event a dropped lock is taken again on the next visible.
        }
      },
      () => {
        this.pending = false;
        // The page hid and came back while asking: that refusal is old, ask again.
        if (asked !== this.visibility) return this.sync();
        this.refused = true;
      },
    );
  }
}

function release(s: WakeSentinel): void {
  try {
    void s.release().catch(() => {});
  } catch {
    // Already gone.
  }
}
