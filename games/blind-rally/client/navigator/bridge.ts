import type { GhostRelay } from "../../shared/types.ts";
import build from "./godot-build.json";

// The TS half of the iframe bridge (map §3.4). The export runs in a
// same-origin iframe, so tearing it down is just removing it (the wasm heap
// goes with it, which matters on iOS across rematches), and Godot's globals
// stay out of the shell. We put `blindRallyHost` on its window; web_bridge.gd
// finds it, hangs receiveControl / initSession / receiveAuthoritativeRaceEvent
// on the same object, and calls ready().
//
// godot-build.json is written by scripts/export-godot.mjs. Importing it ties
// this chunk to exactly one export hash, so a cached .pck can't meet a newer
// .wasm.

export interface GodotBuild {
  hash: string;
  base: string;
  files: string[];
  sizes: Record<string, number>;
}

/** What GDScript calls on us. */
export interface GodotSnapshot {
  speed: number;
  [k: string]: unknown;
}

export interface GodotPhysicsEvent {
  kind: string;
  [k: string]: unknown;
}

/** The object both sides share. Godot fills in the `receive*`/`initSession` half. */
interface HostObject {
  emitSnapshot(s: GodotSnapshot): void;
  emitPhysicsEvent(e: GodotPhysicsEvent): void;
  ready(): void;
  receiveControl?(input: { steer: number; throttle: number; brake: number; seq?: number }): void;
  initSession?(config: unknown, seatToken: string): void;
  receiveAuthoritativeRaceEvent?(event: { kind: string; [k: string]: unknown }): void;
  /**
   * Shared stage (spec §7.4): a rival car to draw as a non-colliding ghost in
   * the 3D view only (never the map), interpolated ~120 ms behind
   * (godot/scripts/ghosts.gd).
   */
  receiveGhostSnapshot?(teamId: number, snapshot: GhostRelay): void;
}

export interface BridgeHandlers {
  snapshot(s: GodotSnapshot): void;
  physics(e: GodotPhysicsEvent): void;
  /** Godot has attached: initSession now. */
  ready(): void;
  /** Bytes in so far, from Godot's own preloader. `total` is 0 when it doesn't know. */
  progress(loaded: number, total: number): void;
  /** The engine's downloaded and running; the scene's still coming up. */
  started(): void;
  /** It's not going to load. `why` is for the screen; retry() is the way out. */
  failed(why: string): void;
}

/** What godot/web/shell.html posts to us while the engine boots. */
type BootMessage =
  | { blindRallyBoot: "progress"; loaded: number; total: number }
  | { blindRallyBoot: "started" }
  | { blindRallyBoot: "failed"; message: string };

/**
 * No new bytes for this long mid-download and we call it stalled. Godot's
 * loader retries a failed fetch, but a wasm fetch that dies after its retries
 * never rejects (its init chain swallows it), so without this the bar would
 * just sit there.
 */
const STALL_MS = 30_000;

export const godotBuild = build as GodotBuild;

export class GodotBridge {
  private iframe: HTMLIFrameElement | null = null;
  private host: HostObject | null = null;
  private handlers: BridgeHandlers;
  private container: HTMLElement | null = null;
  private disposed = false;
  private stall: ReturnType<typeof setTimeout> | undefined;
  private onMessage = (e: MessageEvent) => {
    if (!this.iframe || e.source !== this.iframe.contentWindow || e.origin !== location.origin) return;
    const m = e.data as BootMessage | null;
    if (!m || typeof m !== "object" || !("blindRallyBoot" in m)) return;
    if (m.blindRallyBoot === "progress") {
      this.handlers.progress(m.loaded, m.total);
      // Downloaded; compiling can take a while on a slow phone, and Godot reports failures there itself.
      if (m.total > 0 && m.loaded >= m.total) clearTimeout(this.stall);
      else this.watch();
    } else if (m.blindRallyBoot === "started") {
      clearTimeout(this.stall);
      this.handlers.started();
    } else if (m.blindRallyBoot === "failed") {
      this.fail(m.message);
    }
  };
  isReady = false;

  constructor(handlers: BridgeHandlers) {
    this.handlers = handlers;
  }

  /**
   * Checks the build is really there before booting it. Without this, a
   * missing file comes back as the SPA's index.html with a 200, and Godot
   * dies on a parse error instead of saying "not found" (map §3.3).
   */
  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.disposed = false;
    const b = godotBuild;
    if (!b.hash || !b.files.includes("index.html")) return this.fail("No Navigator build. Run the Godot export.");
    for (const [file, want] of [["index.pck", "application/octet-stream"], ["index.wasm", "application/wasm"]] as const) {
      try {
        const res = await fetch(b.base + file, { method: "HEAD" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || type.includes("text/html")) return this.fail(`The Navigator build is missing ${file}.`);
        // Streaming compile wants application/wasm; anything else is slower, not fatal.
        if (file === "index.wasm" && !type.includes(want)) console.warn(`blind-rally: ${file} served as ${type}`);
      } catch {
        return this.fail("Could not load the Navigator screen.");
      }
      if (this.disposed) return;
    }

    this.host = {
      emitSnapshot: (s) => this.handlers.snapshot(s),
      emitPhysicsEvent: (e) => this.handlers.physics(e),
      ready: () => {
        this.isReady = true;
        this.handlers.ready();
      },
    };
    const iframe = document.createElement("iframe");
    iframe.className = "br-godot";
    iframe.title = "Track view";
    iframe.allow = "fullscreen; autoplay";
    iframe.src = `${b.base}index.html`;
    this.iframe = iframe;
    // Set it now and again on load: the about:blank window can be swapped for
    // the real document's. Godot polls for it for 20 s either way.
    const attach = () => {
      const w = iframe.contentWindow as (Window & { blindRallyHost?: HostObject }) | null;
      if (w && this.host && w.blindRallyHost !== this.host) w.blindRallyHost = this.host;
    };
    addEventListener("message", this.onMessage);
    container.append(iframe);
    attach();
    iframe.addEventListener("load", attach);
    this.watch();
  }

  /** Tear the engine down and boot it again from scratch: the failed state's way out. */
  retry() {
    const container = this.container;
    this.teardown();
    if (container) void this.mount(container);
  }

  private watch() {
    clearTimeout(this.stall);
    this.stall = setTimeout(() => this.fail("The download stopped."), STALL_MS);
  }

  private fail(why: string) {
    clearTimeout(this.stall);
    if (this.disposed) return;
    this.handlers.failed(why);
  }

  control(input: { steer: number; throttle: number; brake: number; seq: number }) {
    this.host?.receiveControl?.(input);
  }

  init(config: unknown, seatToken: string) {
    this.host?.initSession?.(config, seatToken);
  }

  event(ev: { kind: string; [k: string]: unknown }) {
    this.host?.receiveAuthoritativeRaceEvent?.(ev);
  }

  ghost(g: GhostRelay) {
    this.host?.receiveGhostSnapshot?.(g.teamId, g);
  }

  /** Lets the course take keyboard focus (camera keys) after a tap elsewhere. */
  focus() {
    this.iframe?.contentWindow?.focus();
  }

  dispose() {
    this.teardown();
    this.container = null;
  }

  private teardown() {
    this.disposed = true;
    this.isReady = false;
    clearTimeout(this.stall);
    removeEventListener("message", this.onMessage);
    this.iframe?.remove();
    this.iframe = null;
    this.host = null;
  }
}
