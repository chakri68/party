import { audio } from "@games/audio";
import { h, seatName, type GameClientApi } from "@games/ui";
import { formatClock, parseDash, parseHit } from "../../shared/wire.ts";
import { awayBanner, teamBadge, teamClock, type RoleProps, type RoleView } from "../role.ts";
import { teamColor } from "../../shared/types.ts";
import { Dashboard } from "./dashboard.ts";
import { Controls, Sender, type Control } from "./input.ts";
import "./driver.css";

// The Driver's phone (spec §4.1): steering under the left thumb, pedals under
// the right, instruments in between. No Godot, no track data, nothing that
// knows where the road is; this chunk imports none of it.

/** No dash for this long mid-race means the chain Driver ← server ← Navigator is broken somewhere. */
const SIGNAL_LOST_MS = 1_500;
/** The second tap has to come this soon, or the Reset button forgets. */
const CONFIRM_MS = 3_000;
const GO_SHOWN_MS = 800;

const arrow = (dir: "left" | "right") => {
  const el = h("span", { class: "br-glyph", "aria-hidden": "true" });
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${dir === "left" ? "M15 4 7 12l8 8" : "M9 4l8 8-8 8"}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return el;
};

const pad = (control: Control, label: string, glyph: Node | string) =>
  h("div", { class: `br-pad br-pad-${control}`, "data-control": control }, glyph, h("span", { class: "br-pad-label" }, label));

const coarse = () => matchMedia("(pointer: coarse)").matches;

export function createDriverView(api: GameClientApi): RoleView {
  return new DriverView(api);
}

class DriverView implements RoleView {
  private api: GameClientApi;
  private props: RoleProps | null = null;
  private controls = new Controls();
  private sender: Sender;
  private dash = new Dashboard();

  private steer = h("div", { class: "br-zone br-steer", role: "group", "aria-label": "Steering: A and D, or the arrow keys" }, pad("left", "Left", arrow("left")), pad("right", "Right", arrow("right")));
  private pedals = h("div", { class: "br-zone br-pedals", role: "group", "aria-label": "Pedals: W for gas, S for brake and reverse" }, pad("brake", "Brake", h("span", { class: "br-glyph br-glyph-brake", "aria-hidden": "true" })), pad("gas", "Gas", h("span", { class: "br-glyph br-glyph-gas", "aria-hidden": "true" })));
  private team = h("span", { class: "br-teamtag" });
  private link = h("span", { class: "br-link", role: "status" });
  private clock = h("span", { class: "br-clock-main" }, "0:00.0");
  private clockSub = h("span", { class: "br-clock-sub" });
  private reset = h("button", { type: "button", class: "br-reset" }, "Reset car");
  private msg = h("p", { class: "br-msg", "aria-live": "polite" });
  /** A teammate's dropped: the clock's stopped and the car's parked. */
  private banner = h("p", { class: "br-banner", role: "alert", hidden: true });
  private count = h("div", { class: "br-count", "aria-live": "assertive" });
  /** Ready put you here; this takes you back to the teams screen until the race starts. */
  private back = h("button", { type: "button", class: "br-back" }, "Not ready");
  /** The host readies up too; Start has to be reachable from the seat. */
  private start = h("button", { type: "button", class: "br-start-seat primary" }, "Start race");
  private end = h("button", { type: "button", class: "br-back" }, "End race");
  private top = h("div", { class: "br-top" }, this.team, this.link, this.back, this.start, this.end);
  private cockpit = h(
    "div",
    { class: "br-cockpit" },
    this.top,
    this.dash.el,
    h("div", { class: "br-clock" }, this.clock, this.clockSub),
    this.reset,
    this.banner,
    this.msg,
  );
  private root = h("div", { class: "br-driver" }, this.steer, this.cockpit, this.pedals, this.count);

  private lastDash = 0;
  private liveSince = 0;
  private confirming: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval>;
  private seenEvents = new WeakSet<object>();
  private off: (() => void)[] = [];

  constructor(api: GameClientApi) {
    this.api = api;
    this.sender = new Sender((data) => api.stream(data));
    this.controls.onChange = (s) => this.sender.update(s);
    this.controls.onHeld = (held) => {
      for (const p of this.root.querySelectorAll<HTMLElement>(".br-pad")) p.classList.toggle("down", held.has(p.dataset.control as Control));
    };
    // Each zone is split down the middle: the whole half is the pad, gaps and all.
    const halves = (zone: HTMLElement, a: Control, b: Control) => (x: number) => {
      const r = zone.getBoundingClientRect();
      return x < r.left + r.width / 2 ? a : b;
    };
    this.controls.zone(this.steer, halves(this.steer, "left", "right"));
    this.controls.zone(this.pedals, halves(this.pedals, "brake", "gas"));
    this.controls.keyboard();

    // Pointers act on pointerup: a quick second tap is a double-tap to the browser and never
    // becomes a click, which is exactly the tap the confirm asks for. Keyboard clicks (detail 0) still count.
    this.reset.addEventListener("pointerup", (e) => e.button === 0 && this.onReset());
    this.reset.addEventListener("click", (e) => e.detail === 0 && this.onReset());
    this.back.addEventListener("click", () => api.act({ type: "player.ready", ready: false }));
    this.start.addEventListener("click", () => api.act({ type: "race.start" }));
    this.end.addEventListener("click", () => confirm("End the race now? Anyone still out is DNF.") && api.act({ type: "race.end" }));
    if (coarse() && document.fullscreenEnabled) {
      this.top.append(h("button", { type: "button", class: "br-fs", "aria-label": "Full screen", onclick: () => void toggleFullscreen() }, "⛶"));
    }
    if (!coarse()) this.msg.textContent = "WASD or arrow keys.";

    // Nothing on this screen scrolls or zooms: a stray pinch mid-hairpin is a crash.
    const stop = (e: Event) => e.preventDefault();
    for (const t of ["contextmenu", "gesturestart", "dblclick", "selectstart"]) {
      this.root.addEventListener(t, stop);
      this.off.push(() => this.root.removeEventListener(t, stop));
    }
    document.documentElement.classList.add("br-locked");

    this.ticker = setInterval(() => this.tick(), 100);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.ticker);
    clearTimeout(this.confirming);
    this.controls.neutral();
    this.controls.destroy();
    this.sender.destroy();
    this.dash.destroy();
    for (const f of this.off) f();
    document.documentElement.classList.remove("br-locked");
    this.root.remove();
  }

  rejected(message: string) {
    this.say(message);
  }

  update(props: RoleProps) {
    this.props = props;
    if (props.private.role === "driver") this.sender.catchUp(props.private.lastSeq);
    const team = props.game.teams.find((t) => t.id === props.private.teamId);
    if (team) {
      // The team colour is this dashboard's accent: the badge and the gauge's rim.
      this.team.replaceChildren(teamBadge(team));
      this.root.style.setProperty("--br-team", teamColor(team.color).hex);
    }
    for (const ev of props.events) {
      if (this.seenEvents.has(ev)) continue;
      this.seenEvents.add(ev);
      if (ev.type === "reset" && ev.teamId === team?.id) this.say(`Reset. ${ev.penaltyMs / 1000} s of penalties so far.`);
    }
    this.tick();
  }

  stream(_from: string, data: unknown) {
    const dash = parseDash(data);
    if (dash) {
      this.lastDash = performance.now();
      this.dash.speed(dash.speed);
      return;
    }
    const hit = parseHit(data);
    if (hit) {
      this.dash.hit(hit.strength, this.root);
      audio.buzz(Math.round(30 + Math.min(1, hit.strength / 3) * 120));
    }
  }

  private live(): boolean {
    const p = this.props;
    if (!p) return false;
    const g = p.game;
    const now = this.api.serverNow();
    const team = g.teams.find((t) => t.id === p.private.teamId);
    // A paused team's input is dropped by the server anyway: stop sending it.
    return (g.phase === "countdown" || g.phase === "racing") && team?.status === "running" && !team.away.length && g.startsAt !== null && g.endsAt !== null && now >= g.startsAt && now < g.endsAt;
  }

  private tick() {
    const p = this.props;
    if (!p) return;
    const g = p.game;
    const now = this.api.serverNow();
    const live = this.live();
    if (live && !this.liveSince) this.liveSince = performance.now();
    if (!live) this.liveSince = 0;
    this.sender.setLive(live);
    if (g.phase === "finished") this.controls.neutral();
    this.root.classList.toggle("live", live);
    this.reset.disabled = !live;
    // Nothing to reset before the start; and the waiting screen needs the room.
    this.reset.hidden = g.phase === "teams";
    this.back.hidden = g.phase !== "teams";
    this.start.hidden = g.phase !== "teams" || p.room.hostId !== p.playerId;
    this.start.disabled = g.startBlocker !== null;
    this.end.hidden = (g.phase !== "countdown" && g.phase !== "racing") || p.room.hostId !== p.playerId;

    // Clock: elapsed plus penalties, like the timing board will show it.
    const team = g.teams.find((t) => t.id === p.private.teamId);
    const penalty = team?.penaltyMs ?? 0;
    this.clock.textContent = formatClock(teamClock(g, team, now));
    const banner = awayBanner(team, (r) => (r === "navigator" ? "Your Navigator" : "You"), now);
    this.banner.hidden = !banner;
    if (banner && this.banner.textContent !== banner) this.banner.textContent = banner;
    this.clockSub.textContent = g.phase === "teams"
      ? `${g.timeLimitMs / 60_000} min limit`
      : g.phase === "finished"
        ? team?.status === "dnf" ? "DNF" : "Finished"
        : team?.status === "finished" ? "Finished"
        : team?.status === "dnf" ? "DNF"
        : `${penalty ? `+${penalty / 1000} s · ` : ""}${formatClock(Math.max(0, (g.endsAt ?? now) - Math.max(now, g.startsAt ?? now)))} left`;

    // Countdown and GO, from the server's start time; the phase may still say countdown after it.
    let count = "";
    if (g.phase === "teams") count = "";
    else if (g.startsAt !== null && now < g.startsAt) count = String(Math.ceil((g.startsAt - now) / 1000));
    else if (g.startsAt !== null && now - g.startsAt < GO_SHOWN_MS && g.phase !== "finished") count = "GO";
    if (this.count.textContent !== count) {
      this.count.textContent = count;
      this.count.classList.toggle("go", count === "GO");
      if (count) audio.buzz(count === "GO" ? 120 : 30);
    }

    this.renderLink(g.phase === "teams");
  }

  private renderLink(waiting: boolean) {
    const p = this.props!;
    const team = p.game.teams.find((t) => t.id === p.private.teamId);
    const navId = team?.navigatorId ?? null;
    const navSeat = p.room.seats.find((s) => s.id === navId);
    const navName = navId ? seatName(p.room, navId) : "your Navigator";
    let text: string;
    let tone: "ok" | "warn" | "bad";
    if (!navigator.onLine) [text, tone] = ["You're offline", "bad"];
    else if (!navSeat || navSeat.presence !== "connected") [text, tone] = [`${navName} dropped out`, "bad"];
    else if (waiting) [text, tone] = [p.game.startBlocker ?? "Waiting for the host", "warn"];
    else if (p.game.phase === "finished") [text, tone] = ["Race over", "warn"];
    else if (this.liveSince && performance.now() - Math.max(this.lastDash, this.liveSince) > SIGNAL_LOST_MS) [text, tone] = [`No signal from ${navName}`, "warn"];
    else [text, tone] = [`${navName} navigating`, "ok"];
    if (this.link.textContent !== text) this.link.textContent = text;
    this.link.dataset.tone = tone;
  }

  private onReset() {
    if (this.reset.disabled) return;
    if (!this.confirming) {
      this.reset.textContent = "Tap again: +5 s";
      this.reset.classList.add("confirm");
      this.confirming = setTimeout(() => this.unconfirm(), CONFIRM_MS);
      return;
    }
    this.unconfirm();
    this.api.act({ type: "race.reset" });
  }

  private unconfirm() {
    clearTimeout(this.confirming);
    this.confirming = undefined;
    this.reset.textContent = "Reset car";
    this.reset.classList.remove("confirm");
  }

  private say(text: string) {
    this.msg.textContent = text;
  }
}

/** Android only, in practice: iPhones have no element full screen. Landscape lock where allowed. */
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return void (await document.exitFullscreen());
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.("landscape");
  } catch {
    /* refused: rotating by hand works too */
  }
}
