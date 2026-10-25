import { audio } from "@games/audio";
import { h, seatName, type GameClientApi } from "@games/ui";
import { formatClock, parseControl, parseGhost } from "../../shared/wire.ts";
import type { NavigatorSession, PublicTeam } from "../../shared/types.ts";
import { awayBanner, teamBadge, teamClock, type RoleProps, type RoleView } from "../role.ts";
import { GodotBridge } from "./bridge.ts";
import { navigatorTrack } from "./track.ts";
import "./navigator.css";

// The Navigator's screen (spec §4.2): the Godot course, edge to edge, with a
// thin strip of race chrome on top. TS owns the socket; Godot only ever talks
// to this file. Its jobs:
//   Driver's `in` relays → receiveControl
//   Godot snapshots / impacts → `snap` / `ev` streams (the server reduces them for the Driver)
//   Godot cp / finish → `race.event` game-actions (the server checks order and position)
//   phase, clock, reset hold, a dropped teammate → freeze / go race events
//   the server's `recover` → a reset event naming the checkpoint to go back to
//   assists: liveMarker goes to Godot in initSession; the trip meter and the
//     pace notes are drawn here, in TS, from snapshots and the track data
//   initSession from the navigator DTO (seed, clouds, camera, allowedCameras,
//     teamNumber/teamColor/teamShape, ghosts)
//   shared stage: rivals' `ghost` relays → receiveGhostSnapshot (seam: Godot side TBD)

/** Without input from the Driver for this long mid-race, say so. Godot has already gone neutral. */
const DRIVER_QUIET_MS = 1_000;
const GO_SHOWN_MS = 800;

export function createNavigatorView(api: GameClientApi): RoleView {
  return new NavigatorView(api);
}

class NavigatorView implements RoleView {
  private api: GameClientApi;
  private props: RoleProps | null = null;
  private bridge: GodotBridge;

  private stage = h("div", { class: "br-stage" });
  private team = h("span", { class: "br-teamtag" });
  private driver = h("span", { class: "br-link", role: "status" });
  private clock = h("span", { class: "br-nclock" });
  /** Metres driven, from Godot's snapshots: detours count (spec §4.3). */
  private trip = h("span", { class: "br-trip", title: "Distance actually driven, wrong turns included" });
  private notesBtn = h("button", { type: "button", class: "br-back", "aria-expanded": "false" }, "Notes");
  /** Static and hand-scrolled: never advanced or highlighted, which would give the car away. */
  private notes = h("aside", { class: "br-notes", "aria-label": "Pace notes", hidden: true });
  private banner = h("p", { class: "br-banner", role: "alert" });
  private back = h("button", { type: "button", class: "br-back" }, "Not ready");
  /** The host readies up too; Start has to be reachable from the seat. */
  private start = h("button", { type: "button", class: "br-start-seat primary" }, "Start race");
  private end = h("button", { type: "button", class: "br-back" }, "End race");
  private boot = h("div", { class: "br-boot" }, h("p", {}, "Loading the course…"));
  private count = h("div", { class: "br-count", "aria-live": "assertive" });
  private msg = h("p", { class: "br-nmsg", "aria-live": "polite" });
  private root = h(
    "div",
    { class: "br-navigator" },
    h("div", { class: "br-strip" }, this.team, this.driver, this.trip, this.clock, this.notesBtn, this.back, this.start, this.end),
    h("div", { class: "br-view" }, this.stage, this.boot, this.count, this.notes, this.banner, this.msg),
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

  constructor(api: GameClientApi) {
    this.api = api;
    this.bridge = new GodotBridge({
      ready: () => {
        this.boot.hidden = true;
        this.sendSession();
      },
      missing: (why) => {
        this.boot.replaceChildren(h("p", {}, why), h("p", { class: "br-dim" }, "The Driver can't move until this loads."));
      },
      snapshot: (s) => {
        if (typeof s.distance === "number") this.tripM = s.distance;
        // Only mid-race: the server drops anything else, so why send it.
        if (this.live()) api.stream({ ...s, t: "snap" });
      },
      physics: (e) => {
        if (!this.live()) return;
        if (e.kind === "impact") api.stream({ t: "ev", kind: "impact", strength: e.strength });
        // Reliable and answered: a "no" (out of order, nowhere near) comes back through rejected().
        else if (e.kind === "cp" && typeof e.checkpointId === "number") api.act({ type: "race.event", kind: "cp", checkpointId: e.checkpointId });
        else if (e.kind === "finish") api.act({ type: "race.event", kind: "finish" });
      },
    });
    this.back.addEventListener("click", () => api.act({ type: "player.ready", ready: false }));
    this.start.addEventListener("click", () => api.act({ type: "race.start" }));
    this.end.addEventListener("click", () => confirm("End the race now? Anyone still out is DNF.") && api.act({ type: "race.end" }));
    this.notesBtn.addEventListener("click", () => {
      this.notes.hidden = !this.notes.hidden;
      this.notesBtn.setAttribute("aria-expanded", String(!this.notes.hidden));
    });
    this.ticker = setInterval(() => this.tick(), 100);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    void this.bridge.mount(this.stage);
  }

  destroy() {
    clearInterval(this.ticker);
    this.bridge.dispose();
    this.root.remove();
  }

  rejected(message: string) {
    this.msg.textContent = message;
  }

  update(props: RoleProps) {
    this.props = props;
    const mine = props.game.teams.find((t) => t.id === props.private.teamId);
    if (mine) this.team.replaceChildren(teamBadge(mine));
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
    if (from !== team.driverId) return;
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
        // A reloaded Navigator's car goes back to the anchor of what the server counted.
        checkpoints: run?.checkpoints ?? 0,
        keyboard: false,
        autopilot: false,
        muted: !audio.settings.sound,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      this.props!.playerId,
    );
    this.frozen = null; // initSession may have reset the car; say it again
    this.tick();
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
    const track = navigatorTrack(session!.trackId);
    this.notes.replaceChildren(
      h("h3", {}, "Pace notes"),
      h("p", { class: "br-dim" }, "Distances are along the clean line. Your trip meter counts what you actually drove."),
      h("ol", {}, (track?.paceNotes ?? []).map((n) => h("li", {}, h("span", { class: "br-note-at" }, `${n.distance} m`), " ", n.text))),
    );
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

    const team = this.myTeam();
    this.clock.textContent = g.phase === "teams" ? "" : formatClock(teamClock(g, team, now));
    const tripOn = !!this.session()?.assists.tripMeter;
    this.trip.hidden = !tripOn || g.phase === "teams";
    if (tripOn) this.trip.textContent = `trip ${this.tripM === null ? "-" : this.tripM < 1000 ? `${Math.round(this.tripM)} m` : `${(this.tripM / 1000).toFixed(2)} km`}`;
    const banner = awayBanner(team, (r) => (r === "driver" ? "Your Driver" : "You"), now);
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
    if (this.driver.textContent !== text) this.driver.textContent = text;
    this.driver.dataset.tone = tone;
  }
}
