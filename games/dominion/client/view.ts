import { audio } from "@games/audio";
import { h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import {
  DEMOLISH_COST,
  ICE,
  MONUMENTS,
  DEVELOP,
  FACTIONS,
  HARVEST,
  IMPROVEMENT_NAMES,
  PLAYER_COLORS,
  RESOURCE_NAMES,
  REWARDS,
  rewardChoices,
  TECHS,
  NETWORK,
  TEND,
  TERRAIN,
  trainableFor,
  UNITS,
  VESSELS,
  VETERAN_KILLS,
} from "../shared/content.ts";
import { chebyshev, colOf, indexOf, neighbors, rowOf } from "../shared/grid.ts";
import { developBlock, statsOf } from "../shared/rules.ts";
import type {
  DevelopKind,
  DominionAction,
  DominionEvent,
  DominionPrivateState,
  DominionPublicState,
  KnownCity,
  KnownTile,
  KnownUnit,
  RewardChoice,
} from "../shared/types.ts";
import { Board, type BoardModel, type PlayerLook } from "./board.ts";
import { spriteUrl, type SpriteKey } from "./assets.ts";
import { diplomacyScreen } from "./diplomacy.ts";
import { techScreen } from "./techweb.ts";

/** Actions without the turn stamp; the view adds it on the way out. */
type Intent = DominionAction extends infer A ? (A extends { turn: number } ? Omit<A, "turn"> : A) : never;

const coarse = () => matchMedia("(pointer: coarse)").matches;
const ARM_MS = 3000;

export class DominionView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;
  private pub: DominionPublicState | null = null;
  private priv: DominionPrivateState | null = null;

  private root = h("div", { class: "dominion" });
  /** Top left: treasury and standing. */
  private res = h("div", { class: "dm-res dm-plate" });
  private players = h("ol", { class: "dm-players", "aria-label": "Turn order" });
  /** Top centre: whose turn, and the clock. */
  private banner = h("div", { class: "dm-banner", role: "status" });
  /** Bottom corners: Research and End turn. */
  private techBtn = h("button", { type: "button", class: "dm-slab dm-tech-btn", "aria-label": "Research" });
  private dipBtn = h("button", { type: "button", class: "dm-slab dm-tech-btn dm-dip-btn", "aria-label": "Diplomacy" });
  /** The diplomacy screen, while it's open. */
  private dipView: HTMLElement | null = null;
  private endBtn = h("button", { type: "button", class: "dm-slab dm-end" });
  private stage = h("div", {
    class: "dm-stage",
    tabindex: "0",
    role: "application",
    "aria-label": "Map. Arrow keys move the cursor along the grid, Enter selects, N jumps to the next unit, plus and minus zoom.",
  });
  /** The inspector, docked over the bottom of the map. */
  private panel = h("aside", { class: "dm-panel dm-plate", "aria-live": "polite", "aria-label": "Inspector" });
  private bottom = h("div", { class: "dm-bottom" });
  private log = h("p", { class: "dm-log", role: "status", "aria-live": "polite" });
  private a11y = h("ul", { class: "dm-sr", "aria-label": "Visible units and cities" });

  private board = new Board((tile) => this.tap(tile));
  private selected: number | null = null;
  private armedAttack: number | null = null;
  private cursor: number | null = null;
  /** Last selection the camera made room for. */
  private cleared: number | null = null;
  private centered = false;
  private wasMyTurn = false;
  private idleCursor = 0;
  /** A purchase button waiting for its confirming tap on touch screens. */
  private armedKey: string | null = null;
  private armTimer = 0;
  private endArmed = false;
  private clock = 0;
  private pending = new Map<string, string>();
  private logTimer = 0;
  /** City reward popup; `dismissedReward` is the one put off for this turn. */
  private rewardEl = h("div", { class: "dm-rewardpop", role: "dialog", "aria-modal": "false", "aria-labelledby": "dm-reward-title" });
  private dismissedReward: string | null = null;
  private shownReward: string | null = null;
  /** The research screen, while it's open. */
  private techView: { el: HTMLElement; destroy(): void } | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
    const zoom = (f: number, label: string, text: string) =>
      h("button", { type: "button", class: "dm-fab", "aria-label": label, onclick: () => this.board.zoomBy(f) }, text);
    this.stage.append(
      h(
        "div",
        { class: "dm-fabs" },
        zoom(1.25, "Zoom in", "+"),
        zoom(0.8, "Zoom out", "−"),
        h("button", { type: "button", class: "dm-fab", "aria-label": "Next unit", onclick: () => this.nextIdle() }, "⇥"),
      ),
    );
    // One surface: the map fills the game, and everything else floats on it.
    this.bottom.append(h("div", { class: "dm-left" }, this.techBtn, this.dipBtn), this.panel, this.endBtn);
    this.techBtn.addEventListener("click", () => this.openTech());
    this.dipBtn.addEventListener("click", () => this.openDiplomacy());
    this.endBtn.addEventListener("click", () => this.endTurn());
    this.stage.append(
      h("div", { class: "dm-tl" }, this.res, this.players),
      this.banner,
      this.log,
      this.bottom,
      this.rewardEl,
      this.a11y,
    );
    this.root.append(this.stage);
    this.stage.addEventListener("keydown", this.onKey);
    this.rewardEl.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      this.rewardEl.querySelector<HTMLElement>(".dm-rw-later")?.click();
    });
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    this.board.mount(this.stage);
    this.clock = window.setInterval(() => this.renderClock(), 1000);
  }

  destroy() {
    clearInterval(this.clock);
    clearTimeout(this.armTimer);
    clearTimeout(this.logTimer);
    this.closeTech();
    this.board.destroy();
    this.root.remove();
  }

  whenIdle() {
    return this.board.idle();
  }

  rejected(clientActionId: string, message: string) {
    this.pending.delete(clientActionId);
    this.say(message);
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  // ---- state --------------------------------------------------------------

  update(props: GameViewProps) {
    this.props = props;
    this.pub = props.game as DominionPublicState;
    this.priv = props.private as DominionPrivateState | null;
    if (!props.snapshot) this.playEvents(props.events as DominionEvent[]);

    const p = this.priv;
    const myTurn = !!p?.myTurn;
    if (myTurn && !this.wasMyTurn) {
      audio.play("your-turn");
      this.endArmed = false;
    }
    this.wasMyTurn = myTurn;
    // Selection survives updates, but not a unit that's gone or a turn that ended.
    if (!myTurn) this.armedAttack = null;
    this.render();

    // First sight of the map: start at home. After render, so the board knows its size.
    if (p && !this.centered) {
      const home = p.cities.find((c) => c.owner === p.me && c.capital) ?? p.cities.find((c) => c.owner === p.me);
      const at = home?.at ?? p.units.find((u) => u.owner === p.me)?.at;
      if (at !== undefined) {
        // Open close enough to read the art; wide screens can afford more.
        this.board.setZoom(this.stage.clientWidth > 900 ? 1.6 : 1.15);
        this.board.centerOn(at);
        this.centered = true;
      }
    }
  }

  private player(id: string | null): PlayerLook & { label: string } {
    const pub = this.pub!;
    const pl = id ? pub.players.find((x) => x.id === id) : undefined;
    const color = pl ? PLAYER_COLORS[pl.color]!.hex : "#9e9e9e";
    // Computer players have no room seat; their name comes with the game.
    const name = !id ? "Nobody" : id === this.priv?.me ? "You" : (pl?.name ?? seatName(this.props!.room, id));
    return { color, kind: pl?.kind ?? "orchard", name, label: name };
  }

  private playEvents(events: DominionEvent[]) {
    const p = this.priv;
    const lines: string[] = [];
    for (const e of events) {
      switch (e.type) {
        case "move":
          if (e.from !== null && e.to !== null) this.board.animateMove(e.unit, e.from, e.to);
          break;
        case "attack":
          this.board.effect(e.to, "effect.hit");
          this.board.floatText(e.to, `−${e.damage}`, "#ff6b5e");
          if (e.retaliation) {
            this.board.effect(e.from, "effect.hit");
            this.board.floatText(e.from, `−${e.retaliation}`, "#ffb74d");
          }
          if (e.defenderKilled) lines.push("A unit fell.");
          if (e.attackerKilled) lines.push("The attacker fell.");
          break;
        case "spawn":
          this.board.effect(e.at, "effect.spawn");
          break;
        case "heal":
          this.board.effect(e.at, "effect.heal");
          this.board.floatText(e.at, `+${e.amount}`, "#8ef07a");
          break;
        case "capture": {
          this.board.effect(e.at, "effect.capture");
          const city = p?.cities.find((c) => c.at === e.at);
          lines.push(`${this.player(e.by).name} captured ${city?.name ?? "a city"}.`);
          break;
        }
        case "develop":
          this.board.effect(e.at, "effect.discovery");
          break;
        case "research": {
          lines.push(`Researched ${TECHS[e.tech].name}.`);
          const capital = p?.cities.find((c) => c.owner === p.me && c.capital);
          if (capital) this.board.effect(capital.at, "effect.research");
          break;
        }
        case "city-level": {
          const city = p?.cities.find((c) => c.mine?.id === e.city);
          lines.push(`${city?.name ?? "A city"} grew to level ${e.level}. Pick a reward.`);
          if (city) this.board.effect(city.at, "effect.city_upgrade", "effect.spawn");
          break;
        }
        case "ruins":
          this.board.effect(e.at, "effect.discovery");
          lines.push(`Ruins: ${ruinText(e.reward)}`);
          break;
        case "turn-start":
          lines.push(e.playerId === p?.me ? `Round ${e.round}. Your turn.` : `${this.player(e.playerId).name}'s turn.`);
          break;
        case "sabotage":
          this.board.effect(e.at, "effect.sabotage", "effect.hit");
          lines.push(e.by === p?.me ? "Sabotage: their city pays nothing next turn." : `Sabotage in ${p?.cities.find((c) => c.at === e.at)?.name ?? "a city"}!`);
          break;
        case "contact":
          lines.push(`You've met ${this.player(e.with).name}.`);
          break;
        case "peace-offered":
          lines.push(e.from === p?.me ? `Peace offered to ${this.player(e.to).name}.` : `${this.player(e.from).name} offers peace. Open Diplomacy to answer.`);
          break;
        case "peace-answered": {
          const other = e.from === p?.me ? e.to : e.from;
          lines.push(e.accepted ? `Peace with ${this.player(other).name}.` : `${this.player(other).name} ${e.from === p?.me ? "declined" : "was declined"}.`);
          break;
        }
        case "peace-broken":
          lines.push(e.by === p?.me ? `You broke peace with ${this.player(e.with).name}.` : `${this.player(e.by).name} broke the peace. War at the start of their next turn.`);
          break;
        case "embassy":
          lines.push(e.from === p?.me ? `Embassy opened with ${this.player(e.to).name}.` : `${this.player(e.from).name} opened an embassy with you.`);
          break;
        case "splash":
          this.board.effect(e.at, "effect.splash", "effect.hit");
          this.board.floatText(e.at, `−${e.damage}`, "#ff6b5e");
          break;
        case "beacon":
          this.board.effect(e.at, "effect.discovery");
          lines.push("Found a beacon: +1 population for your capital.");
          break;
        case "convert":
          this.board.effect(e.at, "effect.conversion", "effect.capture");
          lines.push(e.by === p?.me ? "Converted. They fight for you now." : `${this.player(e.by).name} converted a unit.`);
          break;
        case "monument":
          this.board.effect(e.at, "effect.spawn");
          break;
        case "freeze":
          this.board.effect(e.at, "effect.freeze", "effect.spawn");
          break;
        case "thaw":
          this.board.effect(e.at, "effect.thaw", "effect.splash");
          break;
        case "burn":
          this.board.effect(e.at, "effect.burn", "effect.hit");
          break;
        case "poison":
          this.board.effect(e.at, "effect.poison", "effect.hit");
          this.board.floatText(e.at, "−1", "#9be15d");
          break;
        case "achievement":
          lines.push(`Milestone: ${MONUMENTS[e.kind as keyof typeof MONUMENTS]?.name ?? "a monument"}. Place it on your land.`);
          break;
        case "eliminated":
          lines.push(`${this.player(e.playerId).name} ${e.playerId === p?.me ? "are" : "is"} out.`);
          break;
        case "game-over":
          break;
      }
    }
    if (lines.length) this.say(lines.slice(-2).join(" "));
  }

  /** A line of news over the map. It fades on its own; the map is the point. */
  private say(text: string) {
    this.log.textContent = text;
    clearTimeout(this.logTimer);
    this.logTimer = window.setTimeout(() => (this.log.textContent = ""), 6000);
  }

  // ---- actions ------------------------------------------------------------

  private act(intent: Intent, what: string) {
    const p = this.priv;
    if (!p) return;
    const action = intent.type === "surrender" ? intent : { ...intent, turn: p.turn };
    this.pending.set(this.api.act(action), what);
  }

  /** On touch screens a purchase needs a second tap (§15). Returns true when it should go ahead. */
  private confirm(key: string): boolean {
    if (!coarse() || this.armedKey === key) {
      this.armedKey = null;
      return true;
    }
    this.armedKey = key;
    clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => {
      this.armedKey = null;
      this.renderPanel();
    }, ARM_MS);
    this.renderPanel();
    return false;
  }

  private tap(tile: number) {
    const p = this.priv;
    if (!p) return;
    this.cursor = null;
    const sel = this.selectedUnit();
    if (sel && p.myTurn && p.freezes[sel.id]?.includes(tile)) {
      // Freezing ends the unit's turn and costs a credit: two taps.
      if (this.armedAttack === tile) {
        this.armedAttack = null;
        this.act({ type: "freeze", unit: sel.id, target: tile }, "freeze");
      } else {
        this.armedAttack = tile;
        this.say(`Freeze this water into ice for ${ICE.cost}¢? It ends the unit's turn. Tap again.`);
      }
      this.render();
      return;
    }
    if (sel && p.myTurn && p.converts[sel.id]?.includes(tile)) {
      // Converting takes a second tap too, like an attack.
      if (this.armedAttack === tile) {
        this.armedAttack = null;
        this.act({ type: "convert", unit: sel.id, target: tile }, "convert");
      } else {
        this.armedAttack = tile;
        this.say("Tap again to convert this unit to your side.");
      }
      this.render();
      return;
    }
    if (sel && p.myTurn) {
      const attack = p.attacks[sel.id]?.find((a) => a.target === tile);
      if (attack) {
        if (this.armedAttack === tile) {
          this.armedAttack = null;
          this.act({ type: "attack", unit: sel.id, target: tile }, "attack");
        } else {
          this.armedAttack = tile;
          this.say(`Deals ${attack.damage}${attack.retaliation ? `, takes ${attack.retaliation} back` : ", no return fire"}. Tap again to attack.`);
        }
        this.render();
        return;
      }
      if (p.moves[sel.id]?.includes(tile)) {
        this.armedAttack = null;
        this.act({ type: "move", unit: sel.id, to: tile }, "move");
        this.selected = tile;
        this.render();
        return;
      }
    }
    this.armedAttack = null;
    // Fog isn't selectable: nothing is known there. It hops instead.
    if (!p.tiles[tile]) {
      this.board.poke(tile);
      this.render();
      return;
    }
    this.selected = this.selected === tile && !this.unitAt(tile) ? null : tile;
    this.render();
  }

  private unitAt(tile: number): KnownUnit | undefined {
    return this.priv?.units.find((u) => u.at === tile);
  }

  private selectedUnit(): KnownUnit | undefined {
    if (this.selected === null) return undefined;
    const u = this.unitAt(this.selected);
    return u && u.owner === this.priv?.me ? u : undefined;
  }

  private nextIdle() {
    const p = this.priv;
    if (!p) return;
    const idle = p.idleUnits.length ? p.idleUnits : p.units.filter((u) => u.owner === p.me).map((u) => u.id);
    if (!idle.length) return;
    const id = idle[this.idleCursor++ % idle.length]!;
    const unit = p.units.find((u) => u.id === id);
    if (!unit) return;
    this.selected = unit.at;
    this.armedAttack = null;
    this.board.centerOn(unit.at);
    this.render();
  }

  private onKey = (e: KeyboardEvent) => {
    const p = this.priv;
    // Keys aimed at the inspector's buttons are theirs, not the map's.
    if (!p || e.target !== this.stage) return;
    const size = this.pub!.size;
    const at = this.cursor ?? this.selected ?? Math.floor((size * size) / 2);
    let r = rowOf(at, size);
    let c = colOf(at, size);
    switch (e.key) {
      case "ArrowUp": r--; break;
      case "ArrowDown": r++; break;
      case "ArrowLeft": c--; break;
      case "ArrowRight": c++; break;
      case "Enter":
      case " ":
        e.preventDefault();
        this.tap(at);
        this.cursor = at;
        this.render();
        return;
      case "Escape":
        this.selected = null;
        this.armedAttack = null;
        this.render();
        return;
      case "n":
      case "N":
        this.nextIdle();
        return;
      case "+":
      case "=":
        this.board.zoomBy(1.25);
        return;
      case "-":
        this.board.zoomBy(0.8);
        return;
      default:
        return;
    }
    e.preventDefault();
    r = Math.max(0, Math.min(size - 1, r));
    c = Math.max(0, Math.min(size - 1, c));
    this.cursor = indexOf(r, c, size);
    if (!this.board.isOnScreen(this.cursor)) this.board.centerOn(this.cursor);
    this.render();
  };

  // ---- rendering ----------------------------------------------------------

  private render() {
    const p = this.priv;
    const pub = this.pub;
    if (!pub) return;
    const looks = new Map<string, PlayerLook>(pub.players.map((pl) => [pl.id, this.player(pl.id)]));
    if (p) {
      const model: BoardModel = {
        size: pub.size,
        tiles: p.tiles,
        units: p.units,
        cities: p.cities,
        players: looks,
        me: p.me,
        idle: new Set(p.myTurn ? p.idleUnits : []),
      };
      this.board.setModel(model);
      const sel = this.selectedUnit();
      this.board.setHighlights({
        selected: this.selected,
        moves: new Set(sel && p.myTurn ? (p.moves[sel.id] ?? []) : []),
        attacks: new Map(sel && p.myTurn ? (p.attacks[sel.id] ?? []).map((a) => [a.target, a]) : []),
        converts: new Set(sel && p.myTurn ? (p.converts[sel.id] ?? []) : []),
        freezes: new Set(sel && p.myTurn ? (p.freezes[sel.id] ?? []) : []),
        armed: this.armedAttack,
        cursor: this.cursor,
      });
    }
    this.renderHud();
    this.renderPlayers();
    this.renderPanel();
    this.renderReward();
    if (this.dipView) this.openDiplomacy(true);
    this.renderA11y();
    // Only on a new selection: panning away from a selected tile is the player's call.
    if (this.selected !== null && this.selected !== this.cleared) this.board.keepClear(this.selected, this.bottom.offsetHeight + 14);
    this.cleared = this.selected;
  }

  private renderClock() {
    const el = this.banner.querySelector<HTMLElement>(".dm-clock");
    const pub = this.pub;
    if (!el || !pub?.deadline) return;
    const left = Math.max(0, Math.ceil((pub.deadline - this.api.serverNow()) / 1000));
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    el.classList.toggle("low", left <= 20);
  }

  private endTurn() {
    const p = this.priv;
    if (!p?.myTurn) return;
    const idle = p.idleUnits.length;
    const rewards = p.cities.filter((c) => c.mine?.pendingRewards.length).length;
    // Unused units or open rewards: ask once, then honour a deliberate save.
    if ((idle || rewards) && !this.endArmed) {
      this.endArmed = true;
      this.say(rewards ? "A city reward is waiting. Ending now picks the first option." : `${plural(idle, "unit")} can still act.`);
      this.renderHud();
      return;
    }
    this.endArmed = false;
    this.selected = null;
    this.act({ type: "end-turn" }, "end turn");
  }

  private renderHud() {
    const p = this.priv;
    const pub = this.pub!;
    const current = pub.currentPlayerId ? this.player(pub.currentPlayerId) : null;
    const myTurn = !!p?.myTurn;
    const idle = p?.idleUnits.length ?? 0;

    replaceChildren(
      this.res,
      h(
        "div",
        { class: "dm-purse", title: "Credits, and what your cities pay each turn" },
        h("span", { class: "dm-coin", "aria-hidden": "true" }),
        h("strong", { class: "dm-credits" }, p ? String(p.credits) : "–"),
        p ? h("span", { class: "dm-income" }, `+${p.income} a turn`) : null,
      ),
      h(
        "div",
        { class: "dm-standing" },
        p ? h("span", {}, `Score ${p.score}`) : null,
        p?.monumentsToPlace ? h("span", { class: "dm-income" }, `${plural(p.monumentsToPlace, "monument")} to place`) : null,
        h("span", {}, `Round ${pub.round}${pub.roundLimit ? ` of ${pub.roundLimit}` : ""}`),
      ),
    );

    const headline =
      pub.phase === "finished" ? "Game over"
      : p?.eliminated ? "Your empire has fallen"
      : myTurn ? "Your turn"
      : current ? `${current.name} is ${pub.players.find((x) => x.id === pub.currentPlayerId)?.bot ? "thinking" : "playing"}`
      : "";
    this.banner.style.setProperty("--c", current?.color ?? "#9aa6b2");
    this.banner.classList.toggle("mine", myTurn);
    replaceChildren(this.banner, h("span", { class: "dm-banner-text" }, headline), pub.deadline && pub.phase === "playing" ? h("span", { class: "dm-clock" }) : null);

    replaceChildren(
      this.techBtn,
      h("span", { class: "dm-tech-glyph", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
      h("span", {}, "Research"),
    );
    this.techBtn.disabled = !p || p.eliminated;
    const offers = p?.diplomacy.filter((d) => d.offerFromThem).length ?? 0;
    replaceChildren(
      this.dipBtn,
      h("span", { class: "dm-dip-glyph", "aria-hidden": "true" }, h("i"), h("i")),
      h("span", {}, "Diplomacy"),
      offers ? h("span", { class: "dm-badge", "aria-label": `${offers} offers waiting` }, String(offers)) : null,
    );
    this.dipBtn.disabled = !p || p.eliminated;

    this.endBtn.disabled = !myTurn;
    this.endBtn.classList.toggle("armed", this.endArmed);
    replaceChildren(
      this.endBtn,
      h("span", { class: "dm-end-main" }, this.endArmed ? "End anyway" : myTurn ? "End turn" : "Waiting"),
      h("span", { class: "dm-end-sub" }, myTurn ? (idle ? `${plural(idle, "unit")} ready` : "All units used") : current ? `${current.name}'s move` : ""),
    );
    this.renderClock();
  }

  /**
   * A city levelled up: the choice comes to the player rather than waiting in
   * the inspector. One at a time, oldest first; "Decide later" puts it off for
   * this turn (ending the turn still takes the first option).
   */
  private renderReward() {
    const p = this.priv;
    const city = p?.myTurn ? p.cities.find((c) => c.mine?.pendingRewards.length) : undefined;
    const level = city?.mine?.pendingRewards[0];
    const key = city && level !== undefined ? `${city.mine!.id}:${level}:${p!.turn}` : null;
    if (!p || !city || level === undefined || key === this.dismissedReward || this.techView) {
      this.rewardEl.hidden = true;
      this.shownReward = null;
      return;
    }
    this.rewardEl.hidden = false;
    if (key === this.shownReward) return;
    this.shownReward = key;
    if (!this.centered) this.board.setZoom(this.stage.clientWidth > 900 ? 1.6 : 1.15);
    // The card sits mid-screen; put the city just above it so you see what grew.
    this.board.centerOn(city.at, Math.min(220, this.stage.clientHeight * 0.28));
    this.centered = true; // the opening "go home" mustn't undo this

    const me = this.player(p.me);
    const art: Record<RewardChoice, SpriteKey | null> = {
      workshop: { id: "improvement.lumber_camp.default" },
      scout: { id: `unit.cavalry.${me.kind}.idle`, color: me.color },
      treasury: null,
      walls: { id: `city.${me.kind}.tier1`, color: me.color },
      population: { id: "resource.crops.default" },
      borders: { id: "improvement.farm.default" },
      park: { id: "resource.fruit.default" },
      champion: { id: `unit.infantry.${me.kind}.idle`, color: me.color },
    };
    const choices = rewardChoices(level).map((choice) => {
      const pic = art[choice];
      const img = h("img", { alt: "", class: "dm-rw-art", draggable: "false" });
      if (pic) void spriteUrl(pic).then((url) => (url ? (img.src = url) : img.remove()));
      return h(
        "button",
        {
          type: "button",
          class: "dm-slab dm-rw-choice",
          onclick: () => {
            this.act({ type: "reward", city: city.mine!.id, choice }, REWARDS[choice].name);
            this.rewardEl.hidden = true;
          },
        },
        pic ? img : h("span", { class: "dm-coin dm-rw-coin", "aria-hidden": "true" }),
        h("strong", {}, REWARDS[choice].name),
        h("span", {}, REWARDS[choice].blurb),
      );
    });
    replaceChildren(
      this.rewardEl,
      h(
        "div",
        { class: "dm-rw-card dm-plate" },
        h("p", { class: "dm-rw-kicker" }, city.name),
        h("h2", { id: "dm-reward-title" }, `Grew to level ${level}`),
        h("p", { class: "dm-muted" }, "Pick one."),
        h("div", { class: "dm-rw-choices" }, choices),
        h(
          "button",
          {
            type: "button",
            class: "dm-rw-later",
            onclick: () => {
              this.dismissedReward = key;
              this.renderReward();
            },
          },
          "Decide later",
        ),
      ),
    );
    requestAnimationFrame(() => this.rewardEl.querySelector<HTMLElement>(".dm-rw-choice")?.focus());
  }

  private renderPlayers() {
    const pub = this.pub!;
    replaceChildren(
      this.players,
      pub.players.map((pl) => {
        const look = this.player(pl.id);
        return h(
          "li",
          {
            class: `dm-player${pl.id === pub.currentPlayerId ? " now" : ""}${pl.eliminated ? " out" : ""}`,
            style: `--c:${look.color}`,
            title: FACTIONS[pl.kind].name,
            "aria-current": pl.id === pub.currentPlayerId ? "true" : null,
          },
          look.name,
          pl.bot ? h("span", { class: "dm-cpu", title: pl.caretaker ? "Removed; the computer keeps their empire going" : `Computer, ${pl.bot}` }, pl.caretaker ? "CPU for them" : "CPU") : null,
          pl.team !== undefined && pl.team !== null ? h("span", { class: "dm-cpu", title: "Team" }, `T${pl.team + 1}`) : null,
        );
      }),
    );
  }

  private renderPanel() {
    const p = this.priv;
    const i = this.selected;
    // Nothing selected, nothing to show: the map gets the room.
    this.panel.hidden = !p || i === null;
    if (!p || i === null) return replaceChildren(this.panel);
    const tile = p.tiles[i] ?? null;
    const unit = this.unitAt(i);
    const city = p.cities.find((c) => c.at === i);
    replaceChildren(
      this.panel,
      h(
        "button",
        {
          type: "button",
          class: "dm-close",
          "aria-label": "Close inspector",
          onclick: () => {
            this.selected = null;
            this.armedAttack = null;
            this.render();
          },
        },
        "×",
      ),
      h(
        "div",
        { class: "dm-sections" },
        this.tileSection(i, tile, city),
        unit ? this.unitSection(unit, tile, city) : null,
        city ? this.citySection(city) : null,
        tile && !city ? this.developSection(i, tile) : null,
      ),
    );
  }

  private tileSection(i: number, tile: KnownTile | null, city: KnownCity | undefined): HTMLElement {
    if (!tile) return h("section", {}, h("h3", {}, "Unexplored"), h("p", { class: "dm-muted" }, "Send a unit to find out."));
    const owner = tile.owner ? this.player(tile.owner) : null;
    const title = city ? city.name : tile.feat === "village" ? "Village" : tile.feat === "ruins" ? "Ruins" : tile.feat === "beacon" ? "Beacon" : TERRAIN[tile.t].name;
    const bits = [
      // The heading already names bare terrain; don't say it twice.
      title !== TERRAIN[tile.t].name && TERRAIN[tile.t].name,
      tile.res && `${RESOURCE_NAMES[tile.res]}${tile.tended ? " (tended)" : ""}`,
      tile.imp && IMPROVEMENT_NAMES[tile.imp],
      tile.road && "Road",
      tile.myc && (tile.myc === this.priv!.me ? "Your mycelium" : `${this.player(tile.myc).name}'s mycelium`),
      owner && (owner.name === "You" ? "Your land" : `${owner.name}'s land`),
    ].filter(Boolean);
    return h(
      "section",
      {},
      h("h3", {}, title),
      bits.length ? h("p", { class: "dm-muted" }, bits.join(", ")) : null,
      !tile.vis ? h("p", { class: "dm-stale" }, tile.seen >= 0 ? `Last seen in round ${tile.seen}. It may have changed.` : "Mapped, never visited.") : null,
      tile.feat === "village" ? h("p", {}, "A neutral village. Move a unit in, then capture it next turn.") : null,
      tile.feat === "ruins" ? h("p", {}, "Old ruins. The first unit to step in finds something.") : null,
      tile.feat === "beacon" ? h("p", {}, "A beacon. Each empire that first sights it gains a population in its capital.") : null,
      tile.t === "ocean" && !this.priv!.techs.includes("navigation") ? h("p", { class: "dm-muted" }, "Ships need Navigation for open ocean.") : null,
      tile.t === "mountain" && !this.priv!.techs.includes("climbing") ? h("p", { class: "dm-muted" }, "Needs Climbing to cross.") : null,
      h("p", { class: "dm-sr" }, `Row ${rowOf(i, this.pub!.size) + 1}, column ${colOf(i, this.pub!.size) + 1}`),
    );
  }

  private unitSection(unit: KnownUnit, tile: KnownTile | null, city: KnownCity | undefined): HTMLElement {
    const p = this.priv!;
    const def = UNITS[unit.type];
    // At sea the ship's numbers count; the unit rides along as cargo.
    const st = statsOf(unit);
    const vessel = unit.vessel ? VESSELS[unit.vessel] : null;
    const owner = this.player(unit.owner);
    const mine = unit.mine;
    const actions: HTMLElement[] = [];
    if (mine && p.myTurn) {
      const fresh = !mine.done && !mine.moved && !mine.attacked;
      const capturable = !def.noCapture && (tile?.feat === "village" || (!!city && !this.alliedWith(city.owner)));
      if (capturable && fresh) {
        actions.push(
          h("button", {
            type: "button",
            class: "primary dm-btn",
            disabled: !mine.settled,
            title: mine.settled ? "" : "Units capture the turn after they arrive",
            onclick: () => this.act({ type: "capture", unit: unit.id }, "capture"),
          }, mine.settled ? "Capture" : "Capture next turn"),
        );
      }
      if (fresh && (unit.hp < unit.maxHp || unit.poisoned)) {
        const label = unit.poisoned ? "Cleanse poison" : "Heal";
        actions.push(h("button", { type: "button", class: "dm-btn", onclick: () => this.act({ type: "heal", unit: unit.id }, label.toLowerCase()) }, label));
      }
      if (fresh && def.evolvesInto) {
        const onNet = tile?.myc === p.me || tile?.owner === p.me;
        for (const into of def.evolvesInto) {
          const d = UNITS[into];
          if (d.needs && !p.techs.includes(d.needs)) continue;
          const price = d.cost - def.cost;
          const key = `evolve:${unit.id}:${into}`;
          const reason = !onNet ? "Only on your mycelium" : p.credits < price ? "Not enough credits" : null;
          actions.push(
            h(
              "button",
              {
                type: "button",
                class: `dm-btn dm-buy${this.armedKey === key ? " armed" : ""}`,
                disabled: !!reason,
                title: reason ?? "",
                onclick: () => this.confirm(key) && this.act({ type: "evolve", unit: unit.id, into }, `evolve into ${d.name}`),
              },
              this.armedKey === key ? "Confirm" : `Evolve: ${d.name}`,
              h("span", { class: "dm-cost" }, [`${price}¢`, `${d.attack}/${d.defense}, ${d.hp} HP`, reason].filter(Boolean).join(" · ")),
            ),
          );
        }
      }
      if (!mine.done && !unit.vessel && tile?.myc && tile.myc !== p.me && !this.alliedWith(tile.myc) && !p.diplomacy.some((d) => d.id === tile.myc && d.relation !== "war")) {
        actions.push(h("button", { type: "button", class: "dm-btn", onclick: () => this.act({ type: "burn", unit: unit.id }, "burn") }, "Burn the mycelium"));
      }
      if (!unit.veteran && mine.kills >= VETERAN_KILLS) {
        actions.push(h("button", { type: "button", class: "dm-btn", onclick: () => this.act({ type: "promote", unit: unit.id }, "promote") }, "Promote"));
      }
      if ((def.sage || def.mender) && !mine.done && !mine.attacked) {
        const hurt = p.units.some(
          (u) => u.id !== unit.id && this.alliedWith(u.owner) && (u.hp < u.maxHp || u.poisoned) && chebyshev(u.at, unit.at, this.pub!.size) === 1,
        );
        actions.push(h("button", { type: "button", class: "dm-btn", disabled: !hurt, title: hurt ? "" : "Nobody beside it is hurt", onclick: () => this.act({ type: "mend", unit: unit.id }, "mend") }, "Mend neighbours"));
        if (p.converts[unit.id]?.length) actions.push(h("p", { class: "dm-muted" }, "Tap a purple-ringed enemy to convert it."));
      }
      if (p.freezes[unit.id]?.length) {
        actions.push(h("p", { class: "dm-muted" }, `Tap a blue-ringed water tile to freeze it (${ICE.cost}¢, ends the turn). Ice lasts ${ICE.rounds} rounds unless your people stay near it.`));
      }
      if (def.stealth && !mine.done && !unit.vessel && city && city.owner !== p.me && !this.alliedWith(city.owner)) {
        const atPeace = p.diplomacy.some((d) => d.id === city.owner && d.relation !== "war");
        actions.push(
          h(
            "button",
            {
              type: "button",
              class: "dm-btn primary",
              disabled: atPeace,
              title: atPeace ? "Not while you're at peace with them" : "",
              onclick: () => this.act({ type: "sabotage", unit: unit.id }, "sabotage"),
            },
            "Sabotage",
          ),
        );
      }
      if (unit.vessel === "transport" && !mine.done && !mine.attacked) {
        for (const v of ["scout", "rammer", "bomber"] as const) {
          const vd = VESSELS[v];
          if (!p.techs.includes(vd.needs)) continue;
          const key = `refit:${unit.id}:${v}`;
          const reason = p.credits < vd.cost ? "Not enough credits" : null;
          actions.push(
            h(
              "button",
              {
                type: "button",
                class: `dm-btn dm-buy${this.armedKey === key ? " armed" : ""}`,
                disabled: !!reason,
                onclick: () => this.confirm(key) && this.act({ type: "upgrade", unit: unit.id, vessel: v }, vd.name),
              },
              this.armedKey === key ? "Confirm" : `Refit: ${vd.name}`,
              h("span", { class: "dm-cost" }, [`${vd.cost}¢`, `${vd.attack}/${vd.defense}, move ${vd.move}, range ${vd.range}`, reason].filter(Boolean).join(" · ")),
            ),
          );
        }
      }
      if (p.techs.includes("free_spirit")) {
        const key = `disband:${unit.id}`;
        const refund = Math.floor(def.cost / 2);
        actions.push(
          h(
            "button",
            {
              type: "button",
              class: `dm-btn${this.armedKey === key ? " armed" : ""}`,
              onclick: () => {
                // Always two taps: losing a unit to a stray click is worse than a slow one.
                if (this.armedKey !== key) {
                  this.armedKey = key;
                  this.renderPanel();
                  return;
                }
                this.armedKey = null;
                this.act({ type: "disband", unit: unit.id }, "disband");
              },
            },
            this.armedKey === key ? "Tap again to disband" : `Disband${refund ? ` (+${refund}¢)` : ""}`,
          ),
        );
      }
    }
    const status = mine
      ? mine.done ? "Done for this turn" : mine.attacked ? "Attacked" : mine.moved ? `Moved, ${mine.mp / 2} move left` : "Ready"
      : null;
    return h(
      "section",
      { class: "dm-unit" },
      h("h4", {}, h("span", { class: "dm-swatch", style: `--c:${owner.color}` }), `${vessel ? vessel.name : def.name}${unit.veteran ? " ★" : ""}`, h("span", { class: "dm-muted" }, ` · ${owner.name}`)),
      vessel ? h("p", { class: "dm-muted" }, `Carrying ${def.name.toLowerCase()}. It lands as one when the ship reaches shore.`) : null,
      h(
        "dl",
        { class: "dm-stats" },
        stat("HP", `${unit.hp}/${unit.maxHp}`),
        stat("Attack", st.attack),
        stat("Defense", st.defense),
        stat("Move", st.move),
        stat("Range", st.range),
        mine ? stat("Kills", mine.kills) : null,
      ),
      status ? h("p", { class: "dm-muted" }, status) : null,
      mine?.maturesIn !== undefined && def.matures
        ? h("p", { class: "dm-muted" }, `Becomes a ${UNITS[def.matures.into].name.toLowerCase()} in ${mine.maturesIn} turn${mine.maturesIn === 1 ? "" : "s"}.`)
        : null,
      def.flying ? h("p", { class: "dm-muted" }, "Flies over water, peaks and enemy lines; lands on solid ground. Can't capture.") : null,
      unit.chilled ? h("p", { class: "dm-warn" }, "Chilled: can't move next turn.") : null,
      unit.poisoned ? h("p", { class: "dm-warn" }, "Poisoned: loses 1 HP a turn and can't heal. Healing draws it out.") : null,
      def.networkMove ? h("p", { class: "dm-muted" }, "Quick on your mycelium, slow off it.") : null,
      def.habitat === "amphibious" ? h("p", { class: "dm-muted" }, "Walks land and shallows alike, no ship needed.") : null,
      def.habitat === "water" ? h("p", { class: "dm-muted" }, "Lives in the water, open ocean included. Can't capture.") : null,
      actions.length ? h("div", { class: "dm-actions" }, actions) : null,
    );
  }

  private citySection(city: KnownCity): HTMLElement {
    const p = this.priv!;
    const owner = this.player(city.owner);
    const m = city.mine;
    if (!m) {
      return h(
        "section",
        {},
        h("h4", {}, h("span", { class: "dm-swatch", style: `--c:${owner.color}` }), `Level ${city.level}${city.capital ? " capital" : ""}`, h("span", { class: "dm-muted" }, ` · ${city.owner ? owner.name : "unclaimed"}`)),
        city.owner === null ? h("p", {}, "Abandoned. Move a unit in and capture it.") : null,
      );
    }
    const inc = m.income;
    const credits = p.credits;
    const reward = m.pendingRewards[0];
    const train = trainableFor(p.kind).map((type) => {
      const def = UNITS[type];
      const reason =
        def.needs && !p.techs.includes(def.needs) ? `Needs ${TECHS[def.needs].name}`
        : m.occupied ? "Enemy in the city"
        : p.units.some((u) => u.at === city.at) ? "City tile is taken"
        : m.units >= m.capacity ? "No room: grow the city"
        : credits < def.cost ? "Not enough credits"
        : null;
      if (def.needs && !p.techs.includes(def.needs)) return null;
      const key = `train:${m.id}:${type}`;
      return h(
        "button",
        {
          type: "button",
          class: `dm-btn dm-buy${this.armedKey === key ? " armed" : ""}`,
          disabled: !p.myTurn || !!reason,
          title: reason ?? "",
          onclick: () => this.confirm(key) && this.act({ type: "train", city: m.id, unitType: type }, `train ${def.name}`),
        },
        this.armedKey === key ? `Confirm ${def.name}` : def.name,
        h("span", { class: "dm-cost" }, `${def.cost}¢${reason ? ` · ${reason}` : ""}`),
      );
    });
    return h(
      "section",
      { class: "dm-city" },
      h("h4", {}, `Level ${city.level}${city.capital ? " capital" : ""}`, m.occupied ? h("span", { class: "dm-warn" }, " · occupied") : null),
      h(
        "div",
        { class: "dm-pop", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(m.nextLevelAt), "aria-valuenow": String(m.pop), "aria-label": "Population" },
        Array.from({ length: m.nextLevelAt }, (_, k) => h("span", { class: k < m.pop ? "on" : "" })),
      ),
      h("p", { class: "dm-muted" }, `${m.pop}/${m.nextLevelAt} to level ${city.level + 1}. Units ${m.units}/${m.capacity}.`),
      h(
        "p",
        { class: "dm-muted" },
        `Pays ${inc.total}¢: level ${inc.level}`,
        inc.workshop ? `, workshop ${inc.workshop}` : "",
        inc.capital ? `, capital ${inc.capital}` : "",
        inc.connection ? `, road link ${inc.connection}` : "",
        inc.forest ? `, forest ${inc.forest}` : "",
        inc.reef ? `, reef nests ${inc.reef}` : "",
        m.walls ? ". Walls." : "",
        m.parks ? ` Parks: ${m.parks}.` : "",
      ),
      reward !== undefined && p.myTurn
        ? h(
            "button",
            {
              type: "button",
              class: "dm-btn primary dm-reward-btn",
              onclick: () => {
                this.dismissedReward = null;
                this.renderReward();
              },
            },
            `Choose level ${reward} reward`,
          )
        : null,
      h("div", { class: "dm-actions dm-train" }, train),
    );
  }

  private developSection(i: number, tile: KnownTile): HTMLElement | null {
    const p = this.priv!;
    if (!tile.vis) return null;
    const mine = tile.owner === p.me;
    const size = this.pub!.size;
    // The network, as far as this player knows it: their mycelium and their land.
    const onNet = (j: number) => {
      const t = p.tiles[j];
      return !!t && (t.myc === p.me || t.owner === p.me);
    };
    const ctx = {
      kind: p.kind,
      mine,
      open: tile.owner === null || this.alliedWith(tile.owner),
      hasCity: p.cities.some((c) => c.at === i),
      techs: p.techs,
      credits: p.credits,
      network: FACTIONS[p.kind].network
        ? {
            on: onNet(i),
            near: neighbors(i, size).some(onNet),
            partner: !!tile.owner && p.diplomacy.some((d) => d.id === tile.owner && d.relation !== "war"),
          }
        : undefined,
    };
    const res = tile.res ? RESOURCE_NAMES[tile.res].toLowerCase() : "";
    /** Name, price, population and a note for every kind of development. */
    const terms = (kind: DevelopKind): { name: string; cost: number; pop: number; extra?: string } => {
      switch (kind) {
        case "harvest":
          return { name: `Harvest ${res}`, cost: HARVEST[tile.res!]!.cost, pop: HARVEST[tile.res!]!.pop };
        case "tend":
          return { name: `Tend ${res}`, cost: TEND.cost, pop: TEND.pop, extra: "the resource stays" };
        case "absorb":
          return { name: `Absorb ${res}`, cost: NETWORK.absorbCost, pop: NETWORK.absorbPop };
        case "spread":
          return { name: "Spread mycelium", cost: NETWORK.spreadCost, pop: 0, extra: "your swarm moves fast on it" };
        case "demolish":
          return { name: `Demolish ${IMPROVEMENT_NAMES[tile.imp!].toLowerCase()}`, cost: DEMOLISH_COST, pop: 0 };
        default: {
          const d = DEVELOP[kind];
          const extra: Partial<Record<DevelopKind, string>> = {
            mill: "+1 pop per farm beside it",
            forge: "+1 pop per mine beside it",
            market: "+1¢ per workshop beside it",
            grove: "still counts as wild forest",
            reef_nest: "+1¢ beside 2 fish or reefs; boards ships",
          };
          return { name: d.name, cost: d.cost, pop: d.pop, extra: extra[kind] };
        }
      }
    };
    const kinds: DevelopKind[] = [
      "harvest", "tend", "absorb", "spread", "farm", "lumber_camp", "grove", "mine", "mill", "forge", "market", "temple", "port", "reef_nest", "road", "demolish",
    ];
    const options = kinds.flatMap((kind) => {
      const block = developBlock(kind, tile, ctx);
      return block === undefined ? [] : [{ kind, ...terms(kind), reason: block }];
    });
    // A monument can go on any open land of yours.
    const monument =
      mine && p.monumentsToPlace > 0 && !tile.imp && !tile.feat && !tile.res && !ctx.hasCity && tile.t !== "shallow" && tile.t !== "ocean";
    if (!options.length && !monument) return null;
    return h(
      "section",
      {},
      h("h4", {}, "Develop"),
      h(
        "div",
        { class: "dm-actions" },
        monument
          ? h(
              "button",
              { type: "button", class: "dm-btn primary dm-buy", disabled: !p.myTurn, onclick: () => this.act({ type: "monument", tile: i }, "monument") },
              "Place monument",
              h("span", { class: "dm-cost" }, "+3 pop"),
            )
          : null,
        options.map((o) => {
          const key = `dev:${i}:${o.kind}`;
          const detail = [`${o.cost}¢`, o.pop ? `+${o.pop} pop` : null, o.extra, o.reason].filter(Boolean).join(" · ");
          return h(
            "button",
            {
              type: "button",
              class: `dm-btn dm-buy${this.armedKey === key ? " armed" : ""}`,
              disabled: !p.myTurn || !!o.reason,
              title: o.reason ?? "",
              onclick: () => this.confirm(key) && this.act({ type: "develop", tile: i, kind: o.kind }, o.name),
            },
            this.armedKey === key ? `Confirm` : o.name,
            h("span", { class: "dm-cost" }, detail),
          );
        }),
      ),
    );
  }

  private alliedWith(id: string | null): boolean {
    const pub = this.pub;
    const me = this.priv?.me;
    if (!pub || !me || id === null) return false;
    if (id === me) return true;
    const team = (x: string) => pub.players.find((pl) => pl.id === x)?.team;
    const t = team(me);
    return t !== undefined && t !== null && t === team(id);
  }

  private renderA11y() {
    const p = this.priv;
    if (!p) return;
    const size = this.pub!.size;
    const where = (i: number) => `row ${rowOf(i, size) + 1}, column ${colOf(i, size) + 1}`;
    const select = (i: number) => () => {
      this.selected = i;
      this.board.centerOn(i);
      this.render();
    };
    replaceChildren(
      this.a11y,
      p.cities.filter((c) => c.vis).map((c) => h("li", {}, h("button", { type: "button", onclick: select(c.at) }, `${c.name}, level ${c.level}, ${this.player(c.owner).name}, ${where(c.at)}`))),
      p.units.map((u) => h("li", {}, h("button", { type: "button", onclick: select(u.at) }, `${this.player(u.owner).name} ${UNITS[u.type].name}, ${u.hp} HP, ${where(u.at)}`))),
    );
  }

  private openTech() {
    const p = this.priv;
    if (!p || this.techView) return;
    const me = this.player(p.me);
    const restore = document.activeElement as HTMLElement | null;
    const screen = techScreen({
      view: p,
      kind: me.kind,
      color: me.color,
      confirmTwice: coarse(),
      onResearch: (tech) => {
        this.act({ type: "research", tech }, TECHS[tech].name);
        this.closeTech();
      },
      onClose: () => {
        this.closeTech();
        restore?.focus();
      },
    });
    this.techView = screen;
    this.stage.append(screen.el);
  }

  /** `refresh`: rebuild in place with the latest state (offers come and go out of turn). */
  private openDiplomacy(refresh = false) {
    const p = this.priv;
    if (!p || (!refresh && this.dipView)) return;
    const screen = diplomacyScreen({
      view: p,
      round: this.pub!.round,
      who: (id) => this.player(id),
      act: (intent, what) => this.act(intent as Intent, what),
      onClose: () => {
        this.dipView?.remove();
        this.dipView = null;
        this.dipBtn.focus();
      },
    });
    if (this.dipView) this.dipView.replaceWith(screen);
    else this.stage.append(screen);
    this.dipView = screen;
  }

  private closeTech() {
    this.techView?.destroy();
    this.techView = null;
    this.renderReward();

  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One label/value pair, kept together so the list can wrap to any width. */
function stat(label: string, value: string | number): HTMLElement {
  return h("div", {}, h("dt", {}, label), h("dd", {}, String(value)));
}

function ruinText(r: Extract<DominionEvent, { type: "ruins" }>["reward"]): string {
  switch (r.kind) {
    case "credits":
      return `${r.amount} credits.`;
    case "population":
      return `+${r.amount} population for a nearby city.`;
    case "tech":
      return `the secret of ${TECHS[r.tech].name}.`;
    case "unit":
      return "a band of fighters joins you.";
    case "explore":
      return "a map of the surrounding land.";
  }
}
