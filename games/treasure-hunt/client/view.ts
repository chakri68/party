import { h, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { teamColor } from "../shared/teams.ts";
import type { Phase, PhotoCam, THPrivate, THPublic } from "../shared/types.ts";
import { MAX_TEAMS } from "../shared/world.ts";
import { GodotBridge, worldReadyFor, type BridgeCall, type CacheReveal, type GodotPhoto, type GodotPos, type PhotoPose, type PinsCall, type RemotePos, type Roster, type Vehicles } from "./godot/bridge.ts";
import { StageLoader } from "./godot/loader.ts";
import { Hud } from "./hud.ts";
import { layoutFor } from "./layout-cache.ts";
import { ReplayView } from "./replay.ts";
import { MapCanvas } from "./map/map-canvas.ts";
import { clickAction, islandView, visibleDots, type Overlay } from "./map/overlays.ts";
import { TeamsPanel } from "./teams.ts";

// The whole game is the Godot map in an iframe; this file is the frame
// around it and the only one that talks to the bridge.
//
//   teams       the map loads (StageLoader). Godot's ready() gets the
//               session ({layout}); its world-ready gets act("ready"), once
//               per seed. The teams panel sits over all of it: pick a team,
//               and the host starts once anyone is ready.
//   countdown   3, 2, 1 over the map. Godot keeps everyone still.
//   hunting     the map fills the game area, under one strip: the help line,
//               the timer, the score and End round for the host. The clue
//               board sits down the right of the map.
//   finished    the mouse is let go.
//
// Godot sends where the player is (→ api.stream) and E by a cache
// (→ act claim). The server sends a reveal when a cache of ours is close; it
// goes straight to Godot, and lands in private state too, but only at the
// next real update (a relay doesn't bump the state). Another player's pos
// relay goes straight on too, if they're in the roster: everyone Godot
// should draw, with their name and colour. Every render and every ready()
// sends it all again (the roster, the buggies, then resync: private state
// plus the reveals that came over the stream since). E by a buggy is Godot
// asking for a seat (→ act seat); getting out is act unseat. A turned-down
// seat, pin or team pick gets a toast; Godot just lets its ask time out. A
// reveal can miss: it went to the old world just before a rebuild, or to an
// iframe that reloaded.
//
// Phones and tablets (a coarse pointer and no fine one) never boot Godot.
// They get a plain message and still send ready, so nobody waits on them.
// They do get the teams panel above it, so a phone host can still start.
//
// The map (countdown and hunting): a minimap bottom-left, 300 m across and
// centred on the last pos Godot sent, and the whole island on M or the Map
// button. Others are their last pos relay, dropped after OTHERS_TTL_MS of
// quiet. M is caught on the iframe's window (Godot has focus) and on ours (the
// map does, once open). A click on the island drops a pin there, or takes
// back my own pin if it's within 12 px; both are acts, so a no gets a toast.
//
// The sky: every sync tells Godot the game minute (skyMinute) and whether it
// runs, so a reload mid-round comes up at the right time, not the start.
// Photo clues: the poses go to Godot when the clue board changes and on its
// ready(); it renders each in the world and sends back a JPEG with the pose
// it was taken at, kept in `photos` by clue id and pose for the board. A pose
// `photos` already holds never goes again: a reloaded iframe would render it
// over the good one, later in the round and so maybe darker.

const HELP = "Click to look around. WASD to move. E to get in or out, or to pick up a cache. P to drop a pin. 0° is north.";
const PHONE = "Treasure Hunt needs a computer with a keyboard and mouse.";
const TOAST_MS = 3000;
const MAP_HINT = "Click to drop a pin. Click your own pin to remove it. M or Esc to close.";
/** A player we haven't heard from in this long is off the map. */
const OTHERS_TTL_MS = 5000;
const MINI_PX = 180;
const MINI_ACROSS = 300;
/** At most 10 redraws a second, the pos stream's own rate. */
const MAP_REDRAW_MS = 100;

const CLAIM_ERRORS: Record<string, string> = {
  "in-vehicle": "Get out of the buggy first.",
  "too-far": "Go closer to the cache.",
  "no-position": "Wait a moment and try again.",
  "moved-too-fast": "Wait a moment and try again.",
  taken: "Another team found this cache first.",
  "already-found": "Your team already found this cache.",
  "not-yours": "This cache is not on your team's list.",
  "not-hunting": "The hunt has not started.",
  // Seats. "in-vehicle" above reads right for a seat too.
  "seat-taken": "Someone is already in that seat.",
  "too-far-seat": "Go closer to the buggy.",
  "no-vehicle": "That buggy is not here.",
  "not-seated": "You are not in a buggy.",
  // Pins.
  "bad-pin": "You can't put a pin there.",
  "no-pin": "That pin is gone.",
  "not-your-pin": "You can only remove your own pins.",
  // Teams.
  "too-many-teams": `There are already ${MAX_TEAMS} teams.`,
  "nobody-ready": "Wait until someone has loaded the map.",
  "not-host": "Only the host can do that.",
  "wrong-phase": "The round has started. Teams cannot change now.",
  "no-such-team": "That team is gone.",
  "already-there": "You are already on that team.",
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
  // Taken by another team is gone too: Godot hides the crate either way.
  for (const c of priv?.clues ?? []) if (c.found || c.taken) calls.push({ fn: "cacheFound", arg: { id: c.id } });
  calls.push({ fn: "setPhase", arg: { phase } });
  return calls;
}

/** What skyMinute reads. */
export type SkyState = Pick<THPublic, "phase" | "sky" | "startedAt" | "replay">;

/**
 * The game minute (after midnight) at `now`, server time. It sits at the start
 * minute before the hunt, runs one game minute per real one in it, and stops
 * at the round's length when it's over.
 */
export function skyMinute(game: SkyState, now: number): number {
  const start = game.sky.startMin;
  if (game.phase === "hunting" && game.startedAt !== null) return start + Math.max(0, now - game.startedAt) / 60_000;
  if (game.phase === "finished" && game.replay) return start + game.replay.durationS / 60;
  return start;
}

/** My team's photo clue poses, in board order. */
export function photoList(priv: THPrivate | null): PhotoPose[] {
  const out: PhotoPose[] = [];
  for (const c of priv?.clues ?? []) if (c.photo) out.push({ id: c.id, x: c.photo.x, z: c.photo.z, yaw: c.photo.yaw, pitch: c.photo.pitch, fov: c.photo.fov });
  return out;
}

/**
 * The photos Godot rendered, as data URLs, keyed `${id}|${x},${z},${yaw},${pitch},${fov}`
 * by the pose Godot rendered: a clue whose camera moved is a new photo, so an old
 * render never shows under the new pose. Lives as long as the view, so an
 * iframe reload keeps them; a new map empties it.
 */
type Pose = Pick<PhotoCam, "x" | "z" | "yaw" | "pitch" | "fov">;

export class PhotoStore {
  private images = new Map<string, string>();
  private seed: number | null = null;

  static key(id: string, cam: Pose): string {
    return `${id}|${cam.x},${cam.z},${cam.yaw},${cam.pitch},${cam.fov}`;
  }

  get size() {
    return this.images.size;
  }

  /** The map in play. A new seed's clues are new ones: the old photos go. */
  forSeed(seed: number) {
    if (this.seed !== null && seed !== this.seed) this.images.clear();
    this.seed = seed;
  }

  /** Filed under the pose Godot rendered, which may not be the board's any more. */
  put(p: GodotPhoto) {
    this.images.set(PhotoStore.key(p.id, p), `data:image/jpeg;base64,${p.data}`);
  }

  /** The data URL for this clue at this pose, or undefined while it renders. */
  get(id: string, cam: Pose): string | undefined {
    return this.images.get(PhotoStore.key(id, cam));
  }

  /** Is there an image for this clue at this pose? */
  has(id: string, cam: Pose): boolean {
    return this.images.has(PhotoStore.key(id, cam));
  }
}

/** The server's reveal relay, or null. */
function parseReveal(data: unknown): CacheReveal | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.t !== "reveal" || typeof d.id !== "string" || typeof d.x !== "number" || typeof d.z !== "number") return null;
  return { id: d.id, x: d.x, z: d.z, dy: typeof d.dy === "number" ? d.dy : 0 };
}

/** Another hunter's pos relay, tagged with who sent it, or null. */
function parseRemote(from: string, data: unknown): RemotePos | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.t !== "pos" || ![d.x, d.y, d.z].every((n) => typeof n === "number" && Number.isFinite(n)) || typeof d.foot !== "boolean") return null;
  // The server fills these in, but a missing one is cheap to read as the default.
  const yaw = typeof d.yaw === "number" && Number.isFinite(d.yaw) ? d.yaw : 0;
  const v = typeof d.v === "string" ? d.v : null;
  return { id: from, x: d.x as number, y: d.y as number, z: d.z as number, yaw, foot: d.foot, v };
}

/**
 * Who Godot draws: every hunter but spectators and the removed, `me`
 * included (Godot skips it). Names come from the room's seats.
 */
export function rosterFor(game: Pick<THPublic, "players" | "teams">, seats: readonly { id: string; name: string }[], me: string): Roster {
  const players: Roster["players"] = [];
  for (const p of game.players) {
    if (p.spectator || p.removed || p.teamId === null) continue;
    const team = game.teams.find((t) => t.id === p.teamId);
    if (!team) continue;
    players.push({ id: p.id, name: seats.find((s) => s.id === p.id)?.name ?? "Someone", color: teamColor(team.color).hex, team: team.id });
  }
  return { me, players };
}

/** My team's pins for Godot, in my team's colour. None without a team. */
export function pinsFor(game: Pick<THPublic, "players" | "teams">, priv: THPrivate | null, me: string): PinsCall {
  const teamId = game.players.find((p) => p.id === me)?.teamId ?? null;
  const team = teamId === null ? undefined : game.teams.find((t) => t.id === teamId);
  if (!team || !priv || priv.teamId !== team.id) return { list: [] };
  const color = teamColor(team.color).hex;
  return { list: priv.pins.map((p) => ({ id: p.id, x: p.x, z: p.z, color, mine: p.by === me })) };
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
  private roster: Roster | null = null;
  private vehicles: Vehicles | null = null;
  private pins: PinsCall | null = null;
  private sky: SkyState | null = null;
  /** The photo poses last sent, as JSON: "[]" sends nothing. */
  private photosSent = "[]";
  /** The last pos Godot sent. */
  private myPos: GodotPos | null = null;
  private send: (calls: BridgeCall[]) => void;
  private now: () => number;
  private held: (p: PhotoPose) => boolean;

  /** `now` is server time, for the sky clock. `held`: the page has this photo already (PhotoStore.has). */
  constructor(send: (calls: BridgeCall[]) => void, now: () => number = () => Date.now(), held: (p: PhotoPose) => boolean = () => false) {
    this.send = send;
    this.now = now;
    this.held = held;
  }

  /** A state update. Sends nothing; the render that follows calls sync(). */
  update(priv: THPrivate | null, phase: Phase, seed: number, roster: Roster | null = null, vehicles: Vehicles | null = null, pins: PinsCall | null = null, sky: SkyState | null = null) {
    this.roster = roster;
    this.vehicles = vehicles;
    this.pins = pins;
    this.sky = sky;
    // A new map's caches are new ones. (A relay before the first update is kept.)
    if (this.seed !== null && seed !== this.seed) this.streamed.clear();
    this.priv = priv;
    this.phase = phase;
    this.seed = seed;
  }

  /** Where Godot last said I am. */
  mine(p: GodotPos) {
    this.myPos = p;
  }

  /** A relay from the server: a reveal, or where someone in the roster is. */
  stream(from: string, data: unknown) {
    const pos = parseRemote(from, data);
    if (pos) {
      if (from !== this.roster?.me && this.roster?.players.some((p) => p.id === from)) this.send([{ fn: "remotePos", arg: pos }]);
      return;
    }
    const r = parseReveal(data);
    if (!r) return;
    this.streamed.set(r.id, r);
    this.send([{ fn: "revealCache", arg: r }]);
  }

  /**
   * Everything again: the roster, the buggies, the pins, the sky clock, then
   * the rest. Cheap: a pool is a handful of caches, and Godot keeps capsules
   * and buggies that didn't change. The photo poses go only when they changed,
   * or on Godot's ready() (`ready`): each one is a render on Godot's side.
   * Poses the page holds a photo for are left out, so nothing renders twice.
   */
  sync(ready = false) {
    if (!this.phase) return;
    const calls = resync(this.priv, this.phase, this.streamed.values());
    const photos = photoList(this.priv);
    const key = JSON.stringify(photos);
    if (key !== this.photosSent || ready) {
      this.photosSent = key;
      const list = photos.filter((p) => !this.held(p));
      if (list.length > 0) calls.unshift({ fn: "photos", arg: { list } });
    }
    if (this.sky) calls.unshift({ fn: "skyClock", arg: { min: skyMinute(this.sky, this.now()), running: this.sky.phase === "hunting" } });
    if (this.pins) calls.unshift({ fn: "pins", arg: this.pins });
    if (this.vehicles) calls.unshift({ fn: "vehicles", arg: this.withMine(this.vehicles) });
    if (this.roster) calls.unshift({ fn: "roster", arg: this.roster });
    this.send(calls);
  }

  /**
   * The list moves only on a commit, so the buggy I drive is listed where the
   * last action left it. A reloaded Godot would put it back there; my last pos
   * (in that buggy) is newer. A copy: the state's list stays as it came.
   */
  private withMine(vehicles: Vehicles): Vehicles {
    const p = this.myPos;
    if (!p || p.v === null || !vehicles.list.some((v) => v.id === p.v && v.driver === vehicles.me)) return vehicles;
    return { ...vehicles, list: vehicles.list.map((v) => (v.id === p.v && v.driver === vehicles.me ? { ...v, x: p.x, y: p.y, z: p.z, yaw: p.yaw } : v)) };
  }
}

/**
 * Claims still out, so their rejections get the claim wording. The server
 * sends no ack for an accepted act: a claim has resolved without a rejection
 * once its cache shows as found, and then its id is dropped. Only the oldest
 * claim per newly found cache goes, so a second claim on it keeps waiting for
 * its "already found" rejection.
 */
export class ClaimLog {
  /** Action id → cache id, oldest first. */
  private out = new Map<string, string>();
  private found = new Set<string>();
  private seed: number | null = null;

  get size() {
    return this.out.size;
  }

  add(actionId: string, cacheId: string) {
    this.out.set(actionId, cacheId);
  }

  /** True if this was one of our claims; it is no longer out either way. */
  rejected(actionId: string): boolean {
    return this.out.delete(actionId);
  }

  update(priv: THPrivate | null, seed: number) {
    if (this.seed !== null && seed !== this.seed) {
      this.out.clear();
      this.found.clear();
    }
    this.seed = seed;
    for (const c of priv?.clues ?? []) {
      if (!c.found || this.found.has(c.id)) continue;
      this.found.add(c.id);
      for (const [actionId, cacheId] of this.out) {
        if (cacheId !== c.id) continue;
        this.out.delete(actionId);
        break;
      }
    }
  }
}

/**
 * Acts whose rejection gets a toast (seats, pins, teams). An accepted act never hears
 * back, so only the latest `cap` are kept.
 */
export class ActLog {
  private ids: string[] = [];
  private cap: number;

  constructor(cap = 16) {
    this.cap = cap;
  }

  add(actionId: string) {
    this.ids.push(actionId);
    if (this.ids.length > this.cap) this.ids.shift();
  }

  /** True if this was one of ours; it is forgotten either way. */
  rejected(actionId: string): boolean {
    const i = this.ids.indexOf(actionId);
    if (i < 0) return false;
    this.ids.splice(i, 1);
    return true;
  }
}

/** Seat id → name, for the teams panel. */
const seatNames = (seats: readonly { id: string; name: string }[]) => Object.fromEntries(seats.map((s) => [s.id, s.name]));

/** Draw on a square canvas `css` px across, sharp at the screen's pixel ratio. */
function paint(canvas: HTMLCanvasElement, css: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const dpr = devicePixelRatio || 1;
  const px = Math.round(css * dpr);
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(px / css, 0, 0, px / css, 0, 0);
  draw(ctx);
}

/** A touch screen with no mouse or trackpad to go with it. */
function touchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

export class TreasureHuntView implements GameView {
  private api: GameClientApi;
  private game: THPublic | null = null;
  private priv: THPrivate | null = null;
  private playerId = "";
  private names: Record<string, string> = {};
  private hostId: string | null = null;
  private desktop = !touchOnly();

  private bridge: GodotBridge;
  private feed: GodotFeed;
  /** Photo clues Godot rendered, for the clue board: photos.get(id, cam). */
  readonly photos = new PhotoStore();
  private loader: StageLoader;
  private hud = new Hud((id, cam) => this.photos.get(id, cam));
  private teams = new TeamsPanel((a) => this.acts.add(this.api.act(a)));
  private stage = h("div", { class: "th-stage" });
  private help = h("p", { class: "th-help" }, HELP);
  private end = h("button", { type: "button", class: "th-end", hidden: true }, "End round");
  private mapBtn = h("button", { type: "button", class: "th-map-toggle", "aria-pressed": "false", hidden: true }, "Map");
  private bar = h("div", { class: "th-bar", hidden: true }, this.help, h("div", { class: "th-bar-right" }, this.hud.score, this.hud.race, this.hud.clock, this.hud.timer, this.mapBtn, this.hud.toggle, this.end));
  private msg = h("p", { class: "th-msg", role: "alert" });
  private toast = h("p", { class: "th-toast", role: "status", "aria-live": "polite", hidden: true });
  private mini = h("canvas", { class: "th-minimap", "aria-hidden": "true", hidden: true });
  private mapCanvas = h("canvas", { class: "th-map-canvas" });
  private mapBox = h("div", { class: "th-map-box" }, this.mapCanvas, h("p", { class: "th-map-hint" }, MAP_HINT));
  private mapEl = h("div", { class: "th-map", role: "dialog", "aria-label": "Map of the island", tabindex: "-1", hidden: true }, this.mapBox);
  private replay = new ReplayView();
  private root: HTMLElement;

  /** The seed Godot last said world-ready for. */
  private builtSeed: number | null = null;
  /** The seed we last sent act("ready") for. */
  private readySeed: number | null = null;
  private claims = new ClaimLog();
  /** Seat, unseat, pin and team acts: a rejection of any gets a toast. */
  private acts = new ActLog();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private mapTicker: ReturnType<typeof setInterval> | undefined;
  /** The last pos Godot sent: my own spot on the map. */
  private myPos: GodotPos | null = null;
  /** Everyone else's last pos relay, and when it came (performance.now()). */
  private others = new Map<string, { x: number; z: number; at: number }>();
  /** Painted in the lobby once the world is built (or on first use), again for a new seed. */
  private base: MapCanvas | null = null;
  private mapOpen = false;
  /** The map is up: countdown or hunting, with the world built. */
  private live = false;
  private onDocKey = (e: KeyboardEvent) => this.onKey(e);

  constructor(api: GameClientApi) {
    this.api = api;
    this.loader = new StageLoader(() => this.bridge.retry());
    this.bridge = new GodotBridge({
      ready: () => {
        this.loader.started();
        this.feed.sync(true);
      },
      progress: (loaded, total) => this.loader.progress(loaded, total),
      started: () => this.loader.started(),
      failed: (why) => {
        this.loader.el.hidden = false;
        this.loader.failed(why);
      },
      status: (s) => {
        if (!this.game || !worldReadyFor(s, this.game.seed)) return;
        this.builtSeed = s.seed;
        this.render();
      },
      keydown: (e) => this.onKey(e),
      pos: (p) => {
        this.myPos = p;
        this.feed.mine(p);
        this.api.stream({ t: "pos", x: p.x, y: p.y, z: p.z, yaw: p.yaw, foot: p.foot, v: p.v });
      },
      claim: (id) => {
        this.claims.add(this.api.act({ type: "claim", cacheId: id }), id);
      },
      seat: (s) => this.acts.add(this.api.act({ type: "seat", vehicleId: s.vehicleId, seat: s.seat })),
      pin: (p) => this.acts.add(this.api.act({ type: "pin", x: p.x, z: p.z })),
      photo: (p) => {
        this.photos.put(p);
        this.tick();
      },
      unseat: (p) => this.acts.add(this.api.act({ type: "unseat", x: p.x, y: p.y, z: p.z, yaw: p.yaw })),
    });
    this.feed = new GodotFeed(
      (calls) => this.bridge.call(calls),
      () => this.api.serverNow(),
      (p) => this.photos.has(p.id, p),
    );
    this.end.addEventListener("click", () => this.api.act({ type: "end" }));
    this.mapBtn.addEventListener("click", () => this.setMap(!this.mapOpen));
    // The dimmed edge closes it; the island takes the click as a pin.
    this.mapEl.addEventListener("click", (e) => {
      if (e.target === this.mapEl) this.setMap(false);
    });
    this.mapCanvas.addEventListener("click", (e) => this.mapClick(e));
    this.root = this.desktop
      ? h(
          "div",
          { class: "treasure-hunt" },
          this.bar,
          h("div", { class: "th-view" }, this.stage, this.mini, this.hud.board, this.hud.count, this.toast, this.loader.el, this.replay.el, this.teams.el, this.msg),
          this.mapEl,
        )
      : h("div", { class: "treasure-hunt th-phone" }, this.teams.el, h("p", { class: "th-phone-text" }, PHONE), this.replay.el, this.msg);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    if (!this.desktop) return;
    void this.bridge.mount(this.stage);
    // The clocks. Four times a second keeps m:ss from skipping a beat.
    this.ticker = setInterval(() => this.tick(), 250);
    this.mapTicker = setInterval(() => this.drawMaps(), MAP_REDRAW_MS);
    document.addEventListener("keydown", this.onDocKey);
  }

  destroy() {
    clearInterval(this.ticker);
    clearInterval(this.mapTicker);
    document.removeEventListener("keydown", this.onDocKey);
    clearTimeout(this.toastTimer);
    this.replay.destroy();
    this.bridge.dispose();
    this.root.remove();
  }

  rejected(clientActionId: string, message: string, code?: string) {
    if (this.claims.rejected(clientActionId) || this.acts.rejected(clientActionId)) this.showToast(claimError(code, message));
    else this.msg.textContent = message;
  }

  stream(from: string, data: unknown) {
    this.feed.stream(from, data);
    const p = parseRemote(from, data);
    if (p && from !== this.playerId) this.others.set(from, { x: p.x, z: p.z, at: performance.now() });
  }

  update(props: GameViewProps) {
    this.game = props.game as THPublic;
    this.priv = (props.private as THPrivate | null) ?? null;
    this.playerId = props.playerId;
    this.hostId = props.room.hostId;
    this.names = seatNames(props.room.seats);
    this.feed.update(this.priv, this.game.phase, this.game.seed, rosterFor(this.game, props.room.seats, this.playerId), {
      me: this.playerId,
      list: this.game.vehicles,
    }, pinsFor(this.game, this.priv, this.playerId), this.game);
    this.claims.update(this.priv, this.game.seed);
    this.photos.forSeed(this.game.seed);
    if (this.desktop) this.bridge.setSession({ layout: layoutFor(this.game.seed) });
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
    const seed = game.seed;
    // Phones are "ready" at once: there is nothing for them to load.
    const loaded = !this.desktop || this.builtSeed === seed;
    if (game.phase === "teams" && loaded && this.readySeed !== seed) {
      this.readySeed = seed;
      this.api.act({ type: "ready" });
    }
    // Over the loader and the map alike: Godot keeps loading under it. On a
    // phone it sits above the message instead.
    this.teams.update(game, this.names, this.playerId, this.hostId === this.playerId);
    // The replay takes the stage's place; Godot stays loaded under it.
    this.replay.update(game, layoutFor(game.seed));
    const replaying = ReplayView.shows(game);
    if (!this.desktop) return;

    this.feed.sync();
    this.stage.hidden = replaying;
    this.loader.el.hidden = loaded || replaying;
    this.bar.hidden = !loaded || replaying;
    this.end.hidden = game.phase !== "hunting" || this.hostId !== this.playerId;
    if (game.phase === "finished") this.bridge.releasePointer();
    if (game.phase === "hunting" && loaded) this.msg.textContent = "";
    this.live = loaded && (game.phase === "countdown" || game.phase === "hunting");
    // The base paint is ~330 ms of main thread. Pay it in the lobby, not in the countdown.
    if (loaded && game.phase === "teams") this.paintBase(seed);
    this.mini.hidden = this.mapBtn.hidden = !this.live;
    if (!this.live && this.mapOpen) this.setMap(false);
    this.tick();
  }

  /** M toggles the map, Esc closes it. Not while typing, and not held down. */
  private onKey(e: KeyboardEvent) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable]")) return;
    if (e.code === "KeyM" && (this.live || this.mapOpen)) {
      e.preventDefault();
      this.setMap(!this.mapOpen);
    } else if (e.key === "Escape" && this.mapOpen) {
      e.preventDefault();
      this.setMap(false);
    }
  }

  private setMap(open: boolean) {
    if (open && !this.live) return;
    this.mapOpen = open;
    this.mapEl.hidden = !open;
    this.mapBtn.setAttribute("aria-pressed", String(open));
    if (!open) return;
    this.bridge.releasePointer();
    // Keys come to us now, not to Godot: no walking off while you read the map.
    this.mapEl.focus();
    this.drawMaps();
  }

  private mapClick(e: MouseEvent) {
    const game = this.game;
    if (!this.mapOpen || !this.live || !game) return;
    const mine = (this.priv?.pins ?? []).filter((p) => p.by === this.playerId);
    const view = islandView(layoutFor(game.seed), this.mapCanvas.clientWidth);
    this.acts.add(this.api.act(clickAction({ px: e.offsetX, py: e.offsetY }, mine, view)));
  }

  /** Pins, then the dots the rules allow, then me. */
  private overlays(game: THPublic): Overlay[] {
    const now = performance.now();
    for (const [id, o] of this.others) if (now - o.at > OTHERS_TTL_MS) this.others.delete(id);
    const teamOf = (id: string) => {
      const p = game.players.find((q) => q.id === id);
      return p && !p.removed ? p.teamId : null;
    };
    const hex = (teamId: number | null) => {
      const t = game.teams.find((q) => q.id === teamId);
      return t ? teamColor(t.color).hex : "#ffffff";
    };
    const myTeam = teamOf(this.playerId);
    const out: Overlay[] = pinsFor(game, this.priv, this.playerId).list.map((p) => ({ kind: "pin", x: p.x, z: p.z, color: p.color, mine: p.mine }));
    for (const d of visibleDots(this.myPos, this.others, teamOf, myTeam, this.playerId)) out.push({ kind: "dot", x: d.x, z: d.z, color: hex(d.team), mate: d.mate });
    if (this.myPos) out.push({ kind: "me", x: this.myPos.x, z: this.myPos.z, yaw: this.myPos.yaw });
    return out;
  }

  /** Paints the minimap's base for this seed, unless it already has. */
  private paintBase(seed: number) {
    if (this.base?.seed !== seed) this.base = new MapCanvas(layoutFor(seed));
  }

  private drawMaps() {
    const game = this.game;
    if (!game || !this.live) return;
    this.paintBase(game.seed);
    const overlays = this.overlays(game);
    const spawn = layoutFor(game.seed).spawn;
    const c = this.myPos ?? spawn;
    paint(this.mini, MINI_PX, (ctx) => this.base!.draw(ctx, { cx: c.x, cz: c.z, metresAcross: MINI_ACROSS, w: MINI_PX, h: MINI_PX }, overlays));
    if (!this.mapOpen) return;
    const size = this.mapCanvas.clientWidth;
    if (size > 0) paint(this.mapCanvas, size, (ctx) => this.base!.draw(ctx, islandView(layoutFor(game.seed), size), overlays));
  }


  private tick() {
    const game = this.game;
    if (!game) return;
    const now = this.api.serverNow();
    const me = game.players.find((p) => p.id === this.playerId);
    const mine = me && game.teams.find((t) => t.id === me.teamId);
    const live = game.phase === "countdown" || game.phase === "hunting";
    this.hud.render({
      left: game.phase === "hunting" && game.endsAt !== null ? game.endsAt - now : null,
      countdown: game.phase === "countdown" && game.countdownEndsAt !== null ? game.countdownEndsAt - now : null,
      score: live && mine ? { found: mine.foundCount, pool: game.mode === "race" ? game.target : mine.poolSize, mode: game.mode } : null,
      priv: live ? this.priv : null,
      // The end time stays up once the round is over.
      clock: live || game.phase === "finished" ? skyMinute(game, now) : null,
    });
  }
}
