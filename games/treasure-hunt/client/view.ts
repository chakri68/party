import { h, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import type { Phase, THPrivate, THPublic } from "../shared/types.ts";
import { GodotBridge, worldReadyFor, type BridgeCall, type CacheReveal } from "./godot/bridge.ts";
import { StageLoader } from "./godot/loader.ts";
import { Hud } from "./hud.ts";

// The whole game is the Godot map in an iframe; this file is the frame
// around it and the only one that talks to the bridge.
//
//   generating  the map loads (StageLoader). Godot's ready() gets the
//               session ({layout}); its world-ready gets act("ready"), once
//               per seed. Then "Waiting for N players" until the round starts.
//   countdown   3, 2, 1 over the map. Godot keeps everyone still.
//   hunting     the map fills the game area, under one strip: the help line,
//               the timer, the score and End round for the host. The clue
//               board sits down the right of the map.
//   finished    the mouse is let go.
//
// Godot sends where the player is (→ api.stream) and E by a cache
// (→ act claim). The server sends a reveal when a cache of ours is close; it
// goes straight to Godot, and lands in private state too, but only at the
// next real update (a relay doesn't bump the state). Every render and every
// ready() sends it all again (resync): private state plus the reveals that
// came over the stream since. A reveal can miss: it went to the old world
// just before a rebuild, or to an iframe that reloaded.
//
// Phones and tablets (a coarse pointer and no fine one) never boot Godot.
// They get a plain message and still send ready, so nobody waits on them.

const HELP = "Click to look around. WASD to move. E to get in or out, or to pick up a cache. 0° is north.";
const PHONE = "Treasure Hunt needs a computer with a keyboard and mouse.";
const TOAST_MS = 3000;

const CLAIM_ERRORS: Record<string, string> = {
  "in-vehicle": "Get out of the buggy first.",
  "too-far": "Go closer to the cache.",
  "no-position": "Wait a moment and try again.",
  "moved-too-fast": "Wait a moment and try again.",
  "already-found": "You already found this cache.",
  "not-yours": "This cache is not on your list.",
  "not-hunting": "The hunt has not started.",
};

/** What to tell the player when a claim is turned down. */
export function claimError(code: string | undefined, message: string): string {
  return (code !== undefined && CLAIM_ERRORS[code]) || message;
}

/**
 * Review Focus 4: everything Godot should know, as calls. Each is idempotent
 * there, so sending the lot on every update is safe and heals a lost reveal.
 */
export function resync(priv: THPrivate | null, phase: Phase, streamed: Iterable<CacheReveal> = []): BridgeCall[] {
  const calls: BridgeCall[] = [];
  const seen = new Set<string>();
  for (const r of [...(priv?.revealed ?? []), ...streamed]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    calls.push({ fn: "revealCache", arg: { id: r.id, x: r.x, z: r.z, dy: r.dy } });
  }
  for (const c of priv?.clues ?? []) if (c.found) calls.push({ fn: "cacheFound", arg: { id: c.id } });
  calls.push({ fn: "setPhase", arg: { phase } });
  return calls;
}

/** The server's reveal relay, or null. */
function parseReveal(data: unknown): CacheReveal | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.t !== "reveal" || typeof d.id !== "string" || typeof d.x !== "number" || typeof d.z !== "number") return null;
  return { id: d.id, x: d.x, z: d.z, dy: typeof d.dy === "number" ? d.dy : 0 };
}

/**
 * What Godot is owed, and the only path to it. The server relays a reveal
 * once and the relay brings no state update, so the feed keeps every
 * streamed reveal for this map: a reloaded or retried Godot gets them back
 * on its ready(). No DOM, so the tests drive it the way the view does.
 */
export class GodotFeed {
  private priv: THPrivate | null = null;
  private phase: Phase | null = null;
  private seed: number | null = null;
  private streamed = new Map<string, CacheReveal>();
  private send: (calls: BridgeCall[]) => void;

  constructor(send: (calls: BridgeCall[]) => void) {
    this.send = send;
  }

  /** A state update. Sends nothing; the render that follows calls sync(). */
  update(priv: THPrivate | null, phase: Phase, seed: number) {
    // A new map's caches are new ones. (A relay before the first update is kept.)
    if (this.seed !== null && seed !== this.seed) this.streamed.clear();
    this.priv = priv;
    this.phase = phase;
    this.seed = seed;
  }

  /** A relay from the server. Only reveals mean anything here. */
  stream(data: unknown) {
    const r = parseReveal(data);
    if (!r) return;
    this.streamed.set(r.id, r);
    this.send([{ fn: "revealCache", arg: r }]);
  }

  /** Everything again. Cheap: a pool is a handful of caches. */
  sync() {
    if (this.phase) this.send(resync(this.priv, this.phase, this.streamed.values()));
  }
}

/** A touch screen with no mouse or trackpad to go with it. */
function touchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

const waitingText = (n: number) => (n === 0 ? "Starting the round" : `Waiting for ${n} ${n === 1 ? "player" : "players"}`);

export class TreasureHuntView implements GameView {
  private api: GameClientApi;
  private game: THPublic | null = null;
  private priv: THPrivate | null = null;
  private playerId = "";
  private hostId: string | null = null;
  private desktop = !touchOnly();

  private bridge: GodotBridge;
  private feed: GodotFeed;
  private loader: StageLoader;
  private hud = new Hud();
  private stage = h("div", { class: "th-stage" });
  private help = h("p", { class: "th-help" }, HELP);
  private end = h("button", { type: "button", class: "th-end", hidden: true }, "End round");
  private bar = h("div", { class: "th-bar", hidden: true }, this.help, h("div", { class: "th-bar-right" }, this.hud.score, this.hud.timer, this.hud.toggle, this.end));
  private wait = h("p", { class: "th-wait", role: "status", "aria-live": "polite", hidden: true });
  private msg = h("p", { class: "th-msg", role: "alert" });
  private toast = h("p", { class: "th-toast", role: "status", "aria-live": "polite", hidden: true });
  private root: HTMLElement;

  /** The seed Godot last said world-ready for. */
  private builtSeed: number | null = null;
  /** The seed we last sent act("ready") for. */
  private readySeed: number | null = null;
  /** Claims still out, so their rejections get the claim wording. */
  private claims = new Set<string>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(api: GameClientApi) {
    this.api = api;
    this.loader = new StageLoader(() => this.bridge.retry());
    this.bridge = new GodotBridge({
      ready: () => {
        this.loader.started();
        this.feed.sync();
      },
      progress: (loaded, total) => this.loader.progress(loaded, total),
      started: () => this.loader.started(),
      failed: (why) => {
        this.loader.el.hidden = false;
        this.loader.failed(why);
      },
      status: (s) => {
        if (!this.game || !worldReadyFor(s, this.game.layout.seed)) return;
        this.builtSeed = s.seed;
        this.render();
      },
      pos: (p) => this.api.stream({ t: "pos", x: p.x, y: p.y, z: p.z, foot: p.foot }),
      claim: (id) => {
        this.claims.add(this.api.act({ type: "claim", cacheId: id }));
      },
    });
    this.feed = new GodotFeed((calls) => this.bridge.call(calls));
    this.end.addEventListener("click", () => this.api.act({ type: "end" }));
    this.root = this.desktop
      ? h(
          "div",
          { class: "treasure-hunt" },
          this.bar,
          h("div", { class: "th-view" }, this.stage, this.hud.board, this.hud.count, this.toast, this.loader.el, this.wait, this.msg),
        )
      : h("div", { class: "treasure-hunt th-phone" }, h("p", { class: "th-phone-text" }, PHONE), this.msg);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    if (!this.desktop) return;
    void this.bridge.mount(this.stage);
    // The clocks. Four times a second keeps m:ss from skipping a beat.
    this.ticker = setInterval(() => this.tick(), 250);
  }

  destroy() {
    clearInterval(this.ticker);
    clearTimeout(this.toastTimer);
    this.bridge.dispose();
    this.root.remove();
  }

  rejected(clientActionId: string, message: string, code?: string) {
    if (this.claims.delete(clientActionId)) this.showToast(claimError(code, message));
    else this.msg.textContent = message;
  }

  stream(_from: string, data: unknown) {
    this.feed.stream(data);
  }

  update(props: GameViewProps) {
    this.game = props.game as THPublic;
    this.priv = (props.private as THPrivate | null) ?? null;
    this.playerId = props.playerId;
    this.hostId = props.room.hostId;
    this.feed.update(this.priv, this.game.phase, this.game.layout.seed);
    if (this.desktop) this.bridge.setSession({ layout: this.game.layout });
    this.render();
  }

  private showToast(text: string) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.hidden = true), TOAST_MS);
  }

  private render() {
    const game = this.game;
    if (!game) return;
    const seed = game.layout.seed;
    // Phones are "ready" at once: there is nothing for them to load.
    const loaded = !this.desktop || this.builtSeed === seed;
    if (game.phase === "generating" && loaded && this.readySeed !== seed) {
      this.readySeed = seed;
      this.api.act({ type: "ready" });
    }
    if (!this.desktop) return;

    this.feed.sync();
    this.loader.el.hidden = loaded;
    const waiting = game.phase === "generating" && loaded;
    this.wait.hidden = !waiting;
    if (waiting) {
      const n = game.players.filter((p) => p.id !== this.playerId && !p.ready && !p.removed).length;
      this.wait.textContent = waitingText(n);
    }
    this.bar.hidden = !loaded;
    this.end.hidden = game.phase !== "hunting" || this.hostId !== this.playerId;
    if (game.phase === "finished") this.bridge.releasePointer();
    if (game.phase === "hunting" && loaded) this.msg.textContent = "";
    this.tick();
  }

  private tick() {
    const game = this.game;
    if (!game) return;
    const now = this.api.serverNow();
    const me = game.players.find((p) => p.id === this.playerId);
    const live = game.phase === "countdown" || game.phase === "hunting";
    this.hud.render({
      left: game.phase === "hunting" && game.endsAt !== null ? game.endsAt - now : null,
      countdown: game.phase === "countdown" && game.countdownEndsAt !== null ? game.countdownEndsAt - now : null,
      score: live && me ? { found: me.foundCount, pool: me.poolSize } : null,
      priv: live ? this.priv : null,
    });
  }
}
