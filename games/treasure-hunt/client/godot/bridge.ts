import type { Phase, Seat, TreasureLayout, Vehicle } from "../../shared/types.ts";
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

/** What Godot reports. M1 has one kind. `seed` is the layout Godot built. */
export type GodotStatus = { kind: "world-ready"; ms: number; chunks: number; seed: number };

export interface CacheReveal {
  id: string;
  x: number;
  z: number;
  dy: number;
}
export interface GodotPos {
  x: number;
  y: number;
  z: number;
  /** The body's facing, radians, Godot style: the walker's, or the buggy's you're in. */
  yaw: number;
  foot: boolean;
  /** The vehicle you're in. null on foot, and in the standalone buggy (no list yet), which has no id. */
  v: string | null;
}

/** Everyone Godot should draw, plus who's us (Godot skips `me`). `color` is "#rrggbb". */
export interface Roster {
  me: string;
  players: { id: string; name: string; color: string; team: number }[];
}

/** Every buggy, as the server has them, plus who's us (Godot drives the ones naming `me`). */
export interface Vehicles {
  me: string;
  list: Vehicle[];
}

/** E by a buggy: which seat Godot asks for. */
export interface SeatAsk {
  vehicleId: string;
  seat: Seat;
}

/** Getting out: the buggy's pose. The server clamps it for a driver and ignores it for a passenger. */
export interface UnseatPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** My team's pins, all of them, every time. `color` is the team's "#rrggbb"; `mine` is whether I dropped it. */
export interface PinsCall {
  list: { id: string; x: number; z: number; color: string; mine: boolean }[];
}

/** P: where on the ground Godot's camera was pointing. */
export interface PinAsk {
  x: number;
  z: number;
}

/** Another player's pos relay, with who sent it. */
export type RemotePos = GodotPos & { id: string };

/** One call into Godot. All are idempotent on Godot's side; roster is the full list. */
export type BridgeCall =
  | { fn: "revealCache"; arg: CacheReveal }
  | { fn: "cacheFound"; arg: { id: string } }
  | { fn: "setPhase"; arg: { phase: Phase } }
  | { fn: "roster"; arg: Roster }
  | { fn: "remotePos"; arg: RemotePos }
  | { fn: "vehicles"; arg: Vehicles }
  | { fn: "pins"; arg: PinsCall };

type GodotFns = { [C in BridgeCall as C["fn"]]?: (arg: C["arg"]) => void };

/** The object both sides share. Godot fills in initSession and the GodotFns. */
interface HostObject extends GodotFns {
  emitStatus(s: GodotStatus): void;
  ready(): void;
  /** Checked with godotPos: it comes from Godot's JSON, not from our types. */
  emitPos(p: unknown): void;
  emitClaim(c: { id: string }): void;
  /** Checked with godotSeat. */
  emitSeat(s: unknown): void;
  /** Checked with godotUnseat. */
  emitUnseat(p: unknown): void;
  /** Checked with godotPin. */
  emitPin(p: unknown): void;
  initSession?(config: SessionConfig): void;
}

export interface BridgeHandlers {
  status(s: GodotStatus): void;
  /** Godot has attached and has the session. Anything else it needs goes now. */
  ready(): void;
  /** Where the player is, about POS_HZ times a second. */
  pos(p: GodotPos): void;
  /** The player pressed E by this cache. */
  claim(id: string): void;
  /** The player pressed E by a buggy. */
  seat(s: SeatAsk): void;
  /** The player got out. */
  unseat(p: UnseatPose): void;
  /** The player pressed P: a pin for this spot. */
  pin(p: PinAsk): void;
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

/** What Godot's emitPos gave us, checked and copied, or null. */
export function godotPos(p: unknown): GodotPos | null {
  if (!p || typeof p !== "object") return null;
  const d = p as Record<string, unknown>;
  const nums = [d.x, d.y, d.z, d.yaw];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (typeof d.foot !== "boolean" || !(d.v === null || typeof d.v === "string")) return null;
  return { x: d.x as number, y: d.y as number, z: d.z as number, yaw: d.yaw as number, foot: d.foot, v: d.v };
}

/** What Godot's emitSeat gave us, checked and copied, or null. Ids are buggySlots ids, 1–8 chars. */
export function godotSeat(s: unknown): SeatAsk | null {
  if (!s || typeof s !== "object") return null;
  const d = s as Record<string, unknown>;
  if (typeof d.vehicleId !== "string" || d.vehicleId.length < 1 || d.vehicleId.length > 8) return null;
  if (d.seat !== "driver" && d.seat !== "passenger") return null;
  return { vehicleId: d.vehicleId, seat: d.seat };
}

/** What Godot's emitUnseat gave us, checked and copied, or null. */
export function godotUnseat(p: unknown): UnseatPose | null {
  if (!p || typeof p !== "object") return null;
  const d = p as Record<string, unknown>;
  const nums = [d.x, d.y, d.z, d.yaw];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { x: d.x as number, y: d.y as number, z: d.z as number, yaw: d.yaw as number };
}

/** What Godot's emitPin gave us, checked and copied, or null. */
export function godotPin(p: unknown): PinAsk | null {
  if (!p || typeof p !== "object") return null;
  const d = p as Record<string, unknown>;
  if (typeof d.x !== "number" || typeof d.z !== "number" || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return null;
  return { x: d.x, z: d.z };
}

/** Is this status Godot saying the world for `seed` is built? A late one from an older layout isn't. */
export function worldReadyFor(s: GodotStatus, seed: number): boolean {
  return s.kind === "world-ready" && s.seed === seed;
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
  private isReady = false;

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
        this.send(reloaded);
        // After the session, so the view's resync lands on the new world's queue.
        this.handlers.ready();
      },
      emitPos: (p) => {
        const pos = godotPos(p);
        if (pos) this.handlers.pos(pos);
      },
      emitClaim: (c) => {
        if (c && typeof c.id === "string") this.handlers.claim(c.id);
      },
      emitSeat: (s) => {
        const ask = godotSeat(s);
        if (ask) this.handlers.seat(ask);
      },
      emitUnseat: (p) => {
        const pose = godotUnseat(p);
        if (pose) this.handlers.unseat(pose);
      },
      emitPin: (p) => {
        const at = godotPin(p);
        if (at) this.handlers.pin(at);
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
    // A load is a new document, so any Godot we had is gone. Until the new
    // one calls ready(), there's nobody to send to, and it'll need the session.
    // (The first load is harmless: Godot boots off a 30 MB wasm fetch, so its
    // ready() comes long after its page has loaded.)
    const reloaded = () => {
      this.isReady = false;
      this.sentSeed = null;
      if (this.host) for (const k of ["initSession", "revealCache", "cacheFound", "setPhase", "roster", "remotePos", "vehicles", "pins"] as const) delete this.host[k];
      attach();
    };
    addEventListener("message", this.onMessage);
    container.append(iframe);
    attach();
    iframe.addEventListener("load", reloaded);
    this.watch();
  }

  /** The session to give Godot. Sent now if Godot is up, else on ready(). */
  setSession(config: SessionConfig) {
    this.session = config;
    this.send(false);
  }

  /**
   * Calls into Godot, if it's up. Before ready() there's nobody listening;
   * the view sends the lot again when ready() comes.
   */
  call(calls: BridgeCall[]) {
    const host = this.host;
    if (!host || !this.isReady) return;
    for (const c of calls) (host[c.fn] as ((arg: unknown) => void) | undefined)?.(c.arg);
  }

  /** Tear the engine down and boot it again from scratch: the failed state's way out. */
  retry() {
    const container = this.container;
    this.teardown();
    if (container) void this.mount(container);
  }

  /** Hands the mouse back (the round is over, there's nothing to look at). */
  releasePointer() {
    this.iframe?.contentDocument?.exitPointerLock();
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
