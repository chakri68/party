import { audio } from "@games/audio";
import { h, seatName, type GameClientApi } from "@games/ui";
import { formatClock, parseControl, parseGhost } from "../../shared/wire.ts";
import type { NavigatorSession, PublicTeam } from "../../shared/types.ts";
import { awayBanner, teamBadge, teamClock, type RoleProps, type RoleView } from "../role.ts";
import { GodotBridge, type GodotPhysicsEvent, type GodotSnapshot } from "./bridge.ts";
import { StageLoader } from "./loader.ts";
import { navigatorTrack } from "./track.ts";
import { trackName } from "../../shared/tracks-public.ts";
import "./navigator.css";

// The Navigator's screen (spec §4.2): the Godot course, edge to edge, with a
// thin strip of race chrome on top. TS owns the socket; Godot only ever talks
// to this file. Its jobs:
//   Driver's `in` relays → receiveControl
//   Godot snapshots / impacts → `snap` / `ev` streams (the server reduces them for the Driver)
//   Godot cp / finish → `race.event` game-actions (the server checks order and position)
//   phase, clock, reset hold, a dropped teammate → freeze / go race events
//   the server's `recover` → a reset event naming the checkpoint to go back to
//   assists: liveMarker and camera3d (map-only) go to Godot in initSession; the
//     trip meter and the pace notes are drawn here, in TS, from snapshots and
//     the track data
//   initSession from the navigator DTO (seed, clouds, camera, allowedCameras,
//     teamNumber/teamColor/teamShape, ghosts), plus `room: true` (Godot leaves
//     recovery to the server and hides its debug HUD) and, for a reload
//     mid-race, the checkpoints the server counted and what's left of a hold
//   Godot's `fell` (out of the world, car parked) → race.reset with reason "fell"
//   shared stage: rivals' `ghost` relays → receiveGhostSnapshot
//   Godot's `pin` (the Navigator's guess on the big map) → `map.guess`
//     game-actions, at most one per PIN_SPACING_MS, latest wins; a reload gets
//     them back as initSession `pins`, and a new race sends the session again (no pins).
//     Outside the run the server keeps none, so one placed then comes straight
//     back off the map (a `pins` event with the server's copy), with a reason.
//
// Rally passes a SeatAddon (client/rally/drive.ts): the controls are on this
// device, so Godot gets `keyboard` and `selfDrive` in initSession (no guess
// pins, R asks for a reset), the addon feeds receiveControl itself, and the
// Driver's status line goes.

/** Without input from the Driver for this long mid-race, say so. Godot has already gone neutral. */
const DRIVER_QUIET_MS = 1_000;
const GO_SHOWN_MS = 800;
/** The server takes one pin per 500 ms; leave room for the network bunching two up. */
const PIN_SPACING_MS = 600;

/** What a seat can bolt onto this screen. Rally's local controls are one. */
export interface SeatAddon {
  /** Chrome for the strip, and anything over the course. */
  mount(strip: HTMLElement, view: HTMLElement): void;
  update(props: RoleProps): void;
  /** Every Godot snapshot, live or not. */
  snapshot(s: GodotSnapshot): void;
  /** Godot events this screen doesn't handle itself. */
  physics(e: GodotPhysicsEvent): void;
  /** 10 Hz: whether the car may move right now. */
  tick(move: boolean): void;
  destroy(): void;
}

export interface NavigatorOptions {
  /** The car is driven from this device (Rally). */
  addon?: (bridge: GodotBridge, api: GameClientApi) => SeatAddon;
}

export function createNavigatorView(api: GameClientApi, options: NavigatorOptions = {}): RoleView {
  return new NavigatorView(api, options);
}

class NavigatorView implements RoleView {
  private api: GameClientApi;
  private addon: SeatAddon | null = null;
  private props: RoleProps | null = null;
  private bridge: GodotBridge;

  private stage = h("div", { class: "br-stage" });
  private team = h("span", { class: "br-teamtag" });
  private driver = h("span", { class: "br-link", role: "status" });
  private clock = h("span", { class: "br-nclock" });
  /** Metres driven, from Godot's snapshots: detours count (spec §4.3). */
  private trip = h("span", { class: "br-trip", title: "Distance actually driven, wrong turns included" });
  private notesBtn = h("button", { type: "button", class: "br-chip", "aria-expanded": "false" }, "Notes");
  /**
   * Static and hand-scrolled: never advanced or highlighted by the game, which
   * would give the car away. The one mark on it is the Navigator's own: tap a
   * line to say "we're about here".
   */
  private notes = h("aside", { class: "br-notes", "aria-label": "Pace notes", hidden: true });
  private notesMark: number | null = null;
  private banner = h("p", { class: "br-banner", role: "alert" });
  private back = h("button", { type: "button", class: "br-chip" }, "Not ready");
  /** The host readies up too; Start has to be reachable from the seat. */
  private start = h("button", { type: "button", class: "br-chip primary" }, "Start race");
  private end = h("button", { type: "button", class: "br-chip danger" }, "End race");
  private loader: StageLoader;
  private count = h("div", { class: "br-count", "aria-live": "assertive" });
  private msg = h("p", { class: "br-nmsg", "aria-live": "polite" });
  private root = h(
    "div",
    { class: "br-navigator" },
    h("div", { class: "br-strip" }, this.team, this.driver, this.trip, this.clock, this.notesBtn, this.back, this.start, this.end),
    h("div", { class: "br-view" }, this.stage, this.count, this.notes, this.banner, this.msg),
  );

  /** What Godot has last been told, so each race event is sent once. */
  private frozen: boolean | null = null;
  private sessionSent = false;
  private lastInput = 0;
  private liveSince = 0;
  private ticker: ReturnType<typeof setInterval>;
  private seenEvents = new WeakSet<object>();
  private tripM: number | null = null;
  private notesFor: string | null = null;
  private lastPinAt = 0;
  private pendingPin: { x: number; z: number } | { clear: true } | null = null;
  private pinTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPhase: string | null = null;

  constructor(api: GameClientApi, options: NavigatorOptions) {
    this.api = api;
    this.loader = new StageLoader(() => this.bridge.retry());
    this.root.querySelector(".br-view")!.append(this.loader.el);
    this.bridge = new GodotBridge({
      ready: () => {
        this.loader.el.hidden = true;
        this.sendSession();
      },
      progress: (loaded, total) => this.loader.progress(loaded, total),
      started: () => this.loader.started(),
      failed: (why) => {
        this.loader.el.hidden = false;
        this.loader.failed(why);
      },
      snapshot: (s) => {
        if (typeof s.distance === "number") this.tripM = s.distance;
        this.addon?.snapshot(s);
        // Only mid-race: the server drops anything else, so why send it.
        if (this.live()) api.stream({ ...s, t: "snap" });
      },
      physics: (e) => {
        // Before the live() gate: a pin outside the run has to be taken back off the map.
        if (e.kind === "pin") return this.queuePin(e.clear === true ? { clear: true } : typeof e.x === "number" && typeof e.z === "number" ? { x: e.x, z: e.z } : null);
        if (!this.live()) return;
        if (e.kind === "impact") api.stream({ t: "ev", kind: "impact", strength: e.strength });
        // Reliable and answered: a "no" (out of order, nowhere near) comes back through rejected().
        else if (e.kind === "cp" && typeof e.checkpointId === "number") api.act({ type: "race.event", kind: "cp", checkpointId: e.checkpointId });
        else if (e.kind === "finish") api.act({ type: "race.event", kind: "finish" });
        // Godot's parked a car that dropped out of the world and won't move it on its own say-so.
        else if (e.kind === "fell") api.act({ type: "race.reset", reason: "fell" });
        else this.addon?.physics(e);
      },
    });
    this.back.addEventListener("click", () => api.act({ type: "player.ready", ready: false }));
    this.start.addEventListener("click", () => api.act({ type: "race.start" }));
    this.end.addEventListener("click", () => confirm("End the race now? Anyone still out is DNF.") && api.act({ type: "race.end" }));
    this.notesBtn.addEventListener("click", () => {
      this.notes.hidden = !this.notes.hidden;
      this.notesBtn.setAttribute("aria-expanded", String(!this.notes.hidden));
    });
    if (options.addon) {
      this.addon = options.addon(this.bridge, api);
      this.addon.mount(this.root.querySelector(".br-strip")!, this.root.querySelector(".br-view")!);
      this.driver.hidden = true;
    }
    this.ticker = setInterval(() => this.tick(), 100);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    void this.bridge.mount(this.stage);
  }

  destroy() {
    clearInterval(this.ticker);
    this.addon?.destroy();
    clearTimeout(this.pinTimer);
    this.bridge.dispose();
    this.root.remove();
  }

  rejected(message: string) {
    this.msg.textContent = message;
  }

  update(props: RoleProps) {
    this.props = props;
    this.loader.setStage(trackName(props.game.tracks, props.game.trackId));
    const mine = props.game.teams.find((t) => t.id === props.private.teamId);
    // A Rally car of one is "Car 2", like its grid.
    if (mine) this.team.replaceChildren(teamBadge(mine, this.addon ? "Car" : "Team"));
    // A new race on the same Godot (a rematch on the same stage): the session again, from the
    // new run. Godot's checkpoint count and finish flag go back to zero, the car to the start,
    // and last race's pins come off the map.
    const phase = props.game.phase;
    if (phase === "countdown" && this.lastPhase !== null && this.lastPhase !== "countdown") this.sessionSent = false;
    this.lastPhase = phase;
    this.sendSession();
    for (const ev of props.events) {
      if (this.seenEvents.has(ev)) continue;
      this.seenEvents.add(ev);
      if (ev.type === "reset" && ev.teamId === props.private.teamId) this.msg.textContent = `Reset: +${ev.penaltyMs / 1000} s so far.`;
      // The server's said yes to the Driver's reset: back to the anchor after the checkpoint
      // *it* counted, held for holdMs (tick() freezes until private.run.holdUntil too).
      if (ev.type === "recover" && ev.teamId === props.private.teamId) {
        this.bridge.event({ kind: "reset", checkpoint: ev.checkpoint, holdMs: ev.holdMs });
        this.frozen = null;
      }
      // The Driver's gone: stop the car now, not after Godot's input timeout.
      if (ev.type === "park" && ev.teamId === props.private.teamId) {
        this.bridge.event({ kind: "neutral" });
        this.frozen = null;
      }
    }
    this.addon?.update(props);
    this.tick();
  }

  stream(from: string, data: unknown) {
    const p = this.props;
    const team = p?.game.teams.find((t) => t.id === p.private.teamId);
    if (!team) return;
    // Shared stage: a rival's car. The server only sends these to Navigators, and only in shared mode.
    const ghost = parseGhost(data);
    if (ghost) {
      if (ghost.teamId !== team.id) this.bridge.ghost(ghost);
      return;
    }
    if (from !== team.driverId || this.addon) return;
    const input = parseControl(data);
    if (!input) return;
    this.lastInput = performance.now();
    this.bridge.control({ steer: input.steer, throttle: input.throttle, brake: input.brake, seq: input.seq });
  }

  private session(): NavigatorSession | null {
    return this.props?.private.role === "navigator" ? this.props.private.session : null;
  }

  private sendSession() {
    const session = this.session();
    this.renderNotes(session);
    if (this.sessionSent || !session || !this.bridge.isReady) return;
    this.sessionSent = true;
    const run = this.props!.private.role === "navigator" ? this.props!.private.run : null;
    this.bridge.init(
      {
        ...session,
        room: true,
        // A reloaded Navigator's car goes back to the anchor of what the server counted,
        // held for whatever's left of a reset's hold.
        checkpoints: run?.checkpoints ?? 0,
        holdMs: Math.max(0, (run?.holdUntil ?? 0) - this.api.serverNow()),
        // Their own guess pins, if Godot's been reloaded mid-race.
        pins: run?.pins ?? { pin: null, trail: [] },
        // Rally: this device drives. WASD in Godot when the course has focus; no pins; R asks for a reset.
        keyboard: !!this.addon,
        selfDrive: !!this.addon,
        autopilot: false,
        muted: !audio.settings.sound,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      this.props!.playerId,
    );
    this.frozen = null; // initSession may have reset the car; say it again
    this.tick();
  }

  /**
   * A guess pin for the server (the results and, later, replays). Only while
   * the car's out there: a pin is scored against where the car was, and on
   * the grid, parked at the finish or paused that's a free "spot on". Godot
   * draws a pin the moment it's tapped, so one the server won't keep is taken
   * back off, not left to vanish on the next reload. Taps faster than
   * PIN_SPACING_MS coalesce: the last one goes.
   */
  private queuePin(pin: { x: number; z: number } | { clear: true } | null) {
    if (!pin) return;
    if (!this.live()) return this.refusePin();
    this.pendingPin = pin;
    if (this.pinTimer !== undefined) return;
    const wait = this.lastPinAt + PIN_SPACING_MS - performance.now();
    const send = () => {
      this.pinTimer = undefined;
      const p = this.pendingPin;
      this.pendingPin = null;
      if (!p) return;
      if (!this.live()) return this.refusePin();
      this.lastPinAt = performance.now();
      this.api.act({ type: "map.guess", ...p });
    };
    if (wait <= 0) send();
    else this.pinTimer = setTimeout(send, wait);
  }

  /** Puts the map back to the pins the server kept, and says why the new one didn't stick. */
  private refusePin() {
    const p = this.props;
    if (p?.private.role !== "navigator") return;
    this.bridge.event({ kind: "pins", ...p.private.run.pins });
    const g = p.game;
    const team = this.myTeam();
    this.msg.textContent = g.phase === "teams" || (g.phase === "countdown" && team?.status === "running")
      ? "Pins count from the green light."
      : team?.status === "running" && team.away.length
        ? "Paused: pins wait till everyone's back."
        : "Race over: your pins are in.";
  }

  private myTeam(): PublicTeam | undefined {
    const p = this.props;
    return p?.game.teams.find((t) => t.id === p.private.teamId);
  }

  /** The server would take our snapshots now: the stage is open, the run's on, nobody's dropped. */
  private live(): boolean {
    const p = this.props;
    if (!p) return false;
    const g = p.game;
    const now = this.api.serverNow();
    const team = this.myTeam();
    return (g.phase === "countdown" || g.phase === "racing") && team?.status === "running" && !team.away.length && g.startsAt !== null && g.endsAt !== null && now >= g.startsAt && now < g.endsAt;
  }

  /** live(), and the car's not being held on its anchor after a reset. */
  private canMove(): boolean {
    const p = this.props;
    return this.live() && p?.private.role === "navigator" && this.api.serverNow() >= p.private.run.holdUntil;
  }

  /** The printed notes for this track, once; or nothing, if the assist's off. */
  private renderNotes(session: NavigatorSession | null) {
    const on = !!session?.assists.paceNotes;
    this.notesBtn.hidden = !on;
    if (!on) {
      this.notes.hidden = true;
      return;
    }
    if (this.notesFor === session!.trackId) return;
    this.notesFor = session!.trackId;
    this.notesMark = null;
    const track = navigatorTrack(session!.trackId);
    const lines = (track?.paceNotes ?? []).map((n, i) => {
      // Calls are written in capitals in the track data (RIGHT 4, HAIRPIN LEFT); landmarks aren't.
      const call = /^[A-Z]{2,}/.test(n.text);
      const line = h(
        "button",
        { type: "button", class: `br-line${call ? " call" : ""}`, "aria-pressed": "false" },
        h("span", { class: "br-line-at" }, String(n.distance)),
        h("span", { class: "br-line-text" }, n.text),
      );
      line.addEventListener("click", () => this.markNote(i));
      return h("li", {}, line);
    });
    this.notes.replaceChildren(
      h(
        "div",
        { class: "br-notepad" },
        spiral(),
        h(
          "div",
          { class: "br-pad-scroll" },
          h("p", { class: "br-pad-head" }, h("span", {}, "Pace notes"), h("span", { class: "br-pad-track" }, track?.name ?? session!.trackId)),
          h("p", { class: "br-pad-sub" }, "Metres along the clean line. Tap a line to mark your place."),
          h("ol", { class: "br-pad-lines" }, lines),
        ),
      ),
    );
  }

  /** The Navigator's own pencil mark: one line at a time, tap it again to rub it out. */
  private markNote(i: number) {
    this.notesMark = this.notesMark === i ? null : i;
    this.notes.querySelectorAll(".br-line").forEach((b, j) => b.setAttribute("aria-pressed", String(j === this.notesMark)));
  }

  private tick() {
    const p = this.props;
    if (!p) return;
    const g = p.game;
    const now = this.api.serverNow();
    const live = this.live();
    const move = this.canMove();
    if (live && !this.liveSince) this.liveSince = performance.now();
    if (!live) this.liveSince = 0;

    // The car sits still until the server's start time, while it's held after a reset,
    // while a teammate's dropped, and again once the run's over.
    if (this.bridge.isReady && this.sessionSent && this.frozen !== !move) {
      this.frozen = !move;
      this.bridge.event({ kind: move ? "go" : "freeze" });
    }
    this.addon?.tick(move);

    const team = this.myTeam();
    this.clock.textContent = g.phase === "teams" ? "" : formatClock(teamClock(g, team, now));
    const tripOn = !!this.session()?.assists.tripMeter;
    this.trip.hidden = !tripOn || g.phase === "teams";
    if (tripOn) this.trip.textContent = `Trip ${this.tripM === null ? "-" : this.tripM < 1000 ? `${Math.round(this.tripM)} m` : `${(this.tripM / 1000).toFixed(2)} km`}`;
    const banner = awayBanner(team, (r) => (r === "driver" && !this.addon ? "Your Driver" : "You"), now);
    this.banner.hidden = !banner;
    if (banner && this.banner.textContent !== banner) this.banner.textContent = banner;
    this.back.hidden = g.phase !== "teams";
    this.start.hidden = g.phase !== "teams" || p.room.hostId !== p.playerId;
    this.start.disabled = g.startBlocker !== null;
    this.end.hidden = (g.phase !== "countdown" && g.phase !== "racing") || p.room.hostId !== p.playerId;

    let count = "";
    if (g.startsAt !== null && g.phase !== "teams" && g.phase !== "finished") {
      if (now < g.startsAt) count = String(Math.ceil((g.startsAt - now) / 1000));
      else if (now - g.startsAt < GO_SHOWN_MS) count = "GO";
    }
    if (this.count.textContent !== count) {
      this.count.textContent = count;
      this.count.classList.toggle("go", count === "GO");
    }

    const driverId = team?.driverId ?? null;
    const seat = p.room.seats.find((s) => s.id === driverId);
    const name = driverId ? seatName(p.room, driverId) : "your Driver";
    let text: string;
    let tone: "ok" | "warn" | "bad";
    if (!seat || seat.presence !== "connected") [text, tone] = [`${name} dropped out`, "bad"];
    else if (g.phase === "teams") [text, tone] = [g.startBlocker ?? "Waiting for the host", "warn"];
    else if (g.phase === "finished") [text, tone] = ["Race over", "warn"];
    else if (live && performance.now() - Math.max(this.lastInput, this.liveSince) > DRIVER_QUIET_MS) [text, tone] = [`${name} isn't touching anything`, "warn"];
    else [text, tone] = [`${name} driving`, "ok"];
    text = text[0]!.toUpperCase() + text.slice(1); // "your Driver dropped out" opens a sentence
    if (this.driver.textContent !== text) this.driver.textContent = text;
    this.driver.dataset.tone = tone;
  }
}

/**
 * The pad's wire binding, drawn once: a hole punched in the paper and a coil
 * over the top edge, tiled across whatever width the pad is.
 */
function spiral(): SVGSVGElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg class="br-spiral" width="100%" height="24" aria-hidden="true" focusable="false">
    <defs><pattern id="br-coil" width="20" height="24" patternUnits="userSpaceOnUse" x="6">
      <circle cx="10" cy="17" r="3.2" fill="#0e0e0c"/>
      <path d="M8.2 17V5.5a2.6 2.6 0 0 1 5.2 0V15.5" fill="none" stroke="#6f6c62" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M8.2 17V5.5a2.6 2.6 0 0 1 5.2 0" fill="none" stroke="#c9c5b8" stroke-width="1" stroke-linecap="round"/>
    </pattern></defs>
    <rect width="100%" height="24" fill="url(#br-coil)"/>
  </svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
