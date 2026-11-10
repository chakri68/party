import type { TreasureLayout } from "../../shared/types.ts";
import build from "./godot-build.json";

// The TS half of the iframe bridge, copied from Blind Rally's and cut down to
// M1. The export runs in a same-origin iframe, so tearing it down is just
// removing it (the wasm heap goes with it), and Godot's globals stay out of
// the shell. We put `treasureHuntHost` on its window; web_bridge.gd finds it,
// hangs initSession on it, and calls ready().
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

export interface SessionConfig {
  layout: TreasureLayout;
}

/** What Godot reports. M1 has one kind. */
export type GodotStatus = { kind: "world-ready"; ms: number; chunks: number };

/** The object both sides share. Godot fills in initSession. */
interface HostObject {
  emitStatus(s: GodotStatus): void;
  ready(): void;
  initSession?(config: SessionConfig): void;
}

export interface BridgeHandlers {
  status(s: GodotStatus): void;
  /** Godot has attached (the session goes out by itself). */
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
  | { treasureHuntBoot: "progress"; loaded: number; total: number }
  | { treasureHuntBoot: "started" }
  | { treasureHuntBoot: "failed"; message: string };

/**
 * No new bytes for this long mid-download and we call it stalled. A wasm
 * fetch that dies after Godot's retries never rejects, so without this the
 * bar would just sit there.
 */
const STALL_MS = 30_000;

export const godotBuild = build as GodotBuild;

/**
 * Review Focus 3: send the session once per layout seed, and again only when
 * Godot came back up on its own (an iframe reload is a fresh engine with no
 * world). Godot ignores a repeat seed anyway; this keeps the wire quiet.
 */
export function shouldSendSession(lastSentSeed: number | null, godotReloaded: boolean, layoutSeed: number): boolean {
  return godotReloaded || lastSentSeed !== layoutSeed;
}

export class GodotBridge {
  private iframe: HTMLIFrameElement | null = null;
  private host: HostObject | null = null;
  private handlers: BridgeHandlers;
  private container: HTMLElement | null = null;
  private disposed = false;
  private stall: ReturnType<typeof setTimeout> | undefined;
  private session: SessionConfig | null = null;
  private sentSeed: number | null = null;
  private onMessage = (e: MessageEvent) => {
    if (!this.iframe || e.source !== this.iframe.contentWindow || e.origin !== location.origin) return;
    const m = e.data as BootMessage | null;
    if (!m || typeof m !== "object" || !("treasureHuntBoot" in m)) return;
    if (m.treasureHuntBoot === "progress") {
      this.handlers.progress(m.loaded, m.total);
      // Downloaded; compiling can take a while, and Godot reports failures there itself.
      if (m.total > 0 && m.loaded >= m.total) clearTimeout(this.stall);
      else this.watch();
    } else if (m.treasureHuntBoot === "started") {
      clearTimeout(this.stall);
      this.handlers.started();
    } else if (m.treasureHuntBoot === "failed") {
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
   * dies on a parse error instead of saying "not found".
   */
  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    this.disposed = false;
    const b = godotBuild;
    if (!b.hash || !b.files.includes("index.html")) return this.fail("There is no game build. Run the Godot export.");
    for (const [file, want] of [["index.pck", "application/octet-stream"], ["index.wasm", "application/wasm"]] as const) {
      try {
        const res = await fetch(b.base + file, { method: "HEAD" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || type.includes("text/html")) return this.fail(`The game build is missing ${file}.`);
        // Streaming compile wants application/wasm; anything else is slower, not fatal.
        if (file === "index.wasm" && !type.includes(want)) console.warn(`treasure-hunt: ${file} served as ${type}`);
      } catch {
        return this.fail("Could not load the game.");
      }
      if (this.disposed) return;
    }

    this.host = {
      emitStatus: (s) => this.handlers.status(s),
      ready: () => {
        // A second ready() is the iframe reloading: a fresh Godot, so the session goes again.
        const reloaded = this.isReady;
        this.isReady = true;
        this.handlers.ready();
        this.send(reloaded);
      },
    };
    const iframe = document.createElement("iframe");
    iframe.className = "th-godot";
    iframe.title = "Treasure Hunt map";
    iframe.allow = "fullscreen; autoplay";
    iframe.src = `${b.base}index.html`;
    this.iframe = iframe;
    // Set it now and again on load: the about:blank window can be swapped for
    // the real document's. Godot polls for it for 20 s either way.
    const attach = () => {
      const w = iframe.contentWindow as (Window & { treasureHuntHost?: HostObject }) | null;
      if (w && this.host && w.treasureHuntHost !== this.host) w.treasureHuntHost = this.host;
    };
    addEventListener("message", this.onMessage);
    container.append(iframe);
    attach();
    iframe.addEventListener("load", attach);
    this.watch();
  }

  /** The session to give Godot. Sent now if Godot is up, else on ready(). */
  setSession(config: SessionConfig) {
    this.session = config;
    this.send(false);
  }

  /** Tear the engine down and boot it again from scratch: the failed state's way out. */
  retry() {
    const container = this.container;
    this.teardown();
    if (container) void this.mount(container);
  }

  /** Gives the map keyboard focus, so WASD goes to Godot after a click on the page. */
  focus() {
    this.iframe?.contentWindow?.focus();
  }

  dispose() {
    this.teardown();
    this.container = null;
  }

  private send(reloaded: boolean) {
    const s = this.session;
    if (!s || !this.isReady || !this.host?.initSession) return;
    if (!shouldSendSession(this.sentSeed, reloaded, s.layout.seed)) return;
    this.sentSeed = s.layout.seed;
    this.host.initSession(s);
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

  private teardown() {
    this.disposed = true;
    this.isReady = false;
    // The next mount is a fresh Godot: it needs the session again.
    this.sentSeed = null;
    clearTimeout(this.stall);
    removeEventListener("message", this.onMessage);
    this.iframe?.remove();
    this.iframe = null;
    this.host = null;
  }
}
