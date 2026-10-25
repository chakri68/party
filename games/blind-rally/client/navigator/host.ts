import { audio } from "@games/audio";
import { h, seatName, type GameClientApi } from "@games/ui";
import { formatClock, parseControl, parseGhost } from "../../shared/wire.ts";
import type { NavigatorSession } from "../../shared/types.ts";
import { raceElapsed, teamBadge, type RoleProps, type RoleView } from "../role.ts";
import { GodotBridge } from "./bridge.ts";
import "./navigator.css";

// The Navigator's screen (spec §4.2): the Godot course, edge to edge, with a
// thin strip of race chrome on top. TS owns the socket; Godot only ever talks
// to this file. Its jobs:
//   Driver's `in` relays → receiveControl
//   Godot snapshots / impacts → `snap` / `ev` streams (the server reduces them for the Driver)
//   phase and clock → freeze / go race events
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
    h("div", { class: "br-strip" }, this.team, this.driver, this.clock, this.back, this.start, this.end),
    h("div", { class: "br-view" }, this.stage, this.boot, this.count, this.msg),
  );

  /** What Godot has last been told, so each race event is sent once. */
  private frozen: boolean | null = null;
  private sessionSent = false;
  private lastInput = 0;
  private liveSince = 0;
  private ticker: ReturnType<typeof setInterval>;
  private seenEvents = new WeakSet<object>();

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
        // Only mid-race: the server drops anything else, so why send it.
        if (this.live()) api.stream({ ...s, t: "snap" });
      },
      physics: (e) => {
        if (e.kind === "impact" && this.live()) api.stream({ t: "ev", kind: "impact", strength: e.strength });
        // cp / finish become game-actions in step 10; Godot's own count is a hint until then.
      },
    });
    this.back.addEventListener("click", () => api.act({ type: "player.ready", ready: false }));
    this.start.addEventListener("click", () => api.act({ type: "race.start" }));
    this.end.addEventListener("click", () => confirm("End the race now? Anyone still out is DNF.") && api.act({ type: "race.end" }));
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
      // The server's said yes to the Driver's reset; Godot puts the car back on its last checkpoint.
      if (ev.type === "reset" && ev.teamId === props.private.teamId) {
        this.bridge.event({ kind: "reset" });
        this.msg.textContent = `Reset: +${ev.penaltyMs / 1000} s so far.`;
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
    if (this.sessionSent || !session || !this.bridge.isReady) return;
    this.sessionSent = true;
    this.bridge.init(
      {
        ...session,
        // M1 has no assists yet (step 11): the static map, no live marker.
        assists: { liveMarker: false },
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

  private live(): boolean {
    const p = this.props;
    if (!p) return false;
    const g = p.game;
    const now = this.api.serverNow();
    const run = g.teams.find((t) => t.id === p.private.teamId)?.status;
    return (g.phase === "countdown" || g.phase === "racing") && run === "running" && g.startsAt !== null && g.endsAt !== null && now >= g.startsAt && now < g.endsAt;
  }

  private tick() {
    const p = this.props;
    if (!p) return;
    const g = p.game;
    const now = this.api.serverNow();
    const live = this.live();
    if (live && !this.liveSince) this.liveSince = performance.now();
    if (!live) this.liveSince = 0;

    // The car sits still until the server's start time, and again once the run's over.
    if (this.bridge.isReady && this.sessionSent && this.frozen !== !live) {
      this.frozen = !live;
      this.bridge.event({ kind: live ? "go" : "freeze" });
    }

    const team = g.teams.find((t) => t.id === p.private.teamId);
    this.clock.textContent = g.phase === "teams" ? "" : formatClock(raceElapsed(g, now) + (team?.penaltyMs ?? 0));
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
