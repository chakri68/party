import type { BotContext, GameBot } from "@games/game-core";
import { aimTargets, auditIndex, bankScore, isAimed } from "../shared/rules.ts";
import type {
  EngineCard,
  OverheatAction,
  OverheatPlayerState,
  OverheatPrivateState,
  OverheatPublicState,
  Pending,
  PowerCard,
  PowerKind,
} from "../shared/types.ts";

type Pub = OverheatPublicState;
type Player = OverheatPlayerState;

/** About 1 move in this many is any legal move, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 8;
/** With this much room or less, a person banks. */
const BANK_MARGIN = 4;
/** With this much room or more, a person flips. */
const FLIP_MARGIN = 7;
/** Between the two, a person flips 1 time in this many. */
const MIDDLE_FLIP_ODDS = 3;
/**
 * Cutthroat: a saved row isn't safe (Steal, Swap and Audit reach it), so a
 * person pushes a little further before saving: these replace the three above.
 */
const CUT_BANK_MARGIN = 3;
const CUT_FLIP_MARGIN = 5;
const CUT_MIDDLE_FLIP_ODDS = 2;
/** Cutthroat: play Cool with this much room or less. */
const COOL_ROOM = 6;
/** Cutthroat: play Double with this much room or more. */
const DOUBLE_ROOM = 12;
/** Aiming Push, Burn or Dump, the leader counts as this much closer to the limit. */
const LEADER_EDGE = 3;
/** On a saved or too-hot turn, the cards worth playing, best first. */
const SAVED_ORDER: PowerKind[] = ["shove", "dump", "fuse", "audit", "steal", "wrench", "heatwave"];

const worth = (e: EngineCard) => e.card.value * e.mult;
const highest = (engine: EngineCard[]) => engine.reduce((a, b) => (worth(b) > worth(a) ? b : a));
const lowest = (engine: EngineCard[]) => engine.reduce((a, b) => (worth(b) < worth(a) ? b : a));
/** Heat left before the gauge, counting the fuses that will tick. A card that lands exactly on it is Perfect. */
const room = (p: Player) => p.gauge - p.heat - p.fuses;
/** The room in flips: a waiting Double makes the next card count twice. */
const margin = (p: Player) => room(p) / (p.turbo ? 2 : 1);

/** The same rule the game uses (`aimTargets`). */
function targetsFor(pub: Pub, me: Player, kind: Pending["kind"]): Player[] {
  const seat = pub.players.indexOf(me);
  return aimTargets(pub.players, seat, kind, pub.settings.powers === "cutthroat").map((i) => pub.players[i]!);
}

/** Lower is a better aim for Push, Burn and Dump: closest to the limit, the leader first. */
function nearest(pub: Pub, targets: Player[]): Player {
  const danger = (p: Player) => margin(p) - (p.id === pub.leaderId ? LEADER_EDGE : 0);
  return targets.reduce((a, b) => (danger(b) < danger(a) || (danger(b) === danger(a) && b.score > a.score) ? b : a));
}

/** The leader's own entries if there are any, else all of them. */
function leaderFirst<T extends { t: Player }>(pub: Pub, all: T[]): T[] {
  const lead = all.filter((x) => x.t.id === pub.leaderId);
  return lead.length ? lead : all;
}

/**
 * The card a Steal should take, or null if none is worth it. Flipping: the
 * highest card that won't make us go too hot, from the leader's row first.
 * Saved or too hot: the highest card in a saved row (it lowers their score),
 * the leader first. Null for a Steal that would only cool a flipper.
 */
function stealPick(pub: Pub, me: Player, targets: Player[]): { t: Player; e: EngineCard } | null {
  const all = targets.flatMap((t) => t.engine.map((e) => ({ t, e })));
  const pool =
    me.status === "flipping"
      ? all.filter(({ e }) => worth(e) <= room(me))
      : all.filter(({ t }) => t.status === "banked");
  if (!pool.length) return null;
  return leaderFirst(pub, pool).reduce((a, b) => (worth(b.e) > worth(a.e) ? b : a));
}

/** A Swap that makes a flipper go too hot: our highest card for their lowest. */
function swapBust(me: Player, targets: Player[]): Player | null {
  if (!me.engine.length) return null;
  const give = worth(highest(me.engine));
  const busts = targets.filter((t) => t.status === "flipping" && t.heat - worth(lowest(t.engine)) + give > t.gauge);
  return busts.length ? coolest(busts) : null;
}
/** The row whose lowest card is lowest: taking it cools us most. */
const coolest = (ts: Player[]) => ts.reduce((a, b) => (worth(lowest(b.engine)) < worth(lowest(a.engine)) ? b : a));

/** A saved Swap that gains points: our lowest card for a saved player's better one, the leader first. */
function swapGain(pub: Pub, me: Player, targets: Player[]): { t: Player; e: EngineCard } | null {
  if (me.status !== "banked" || !me.engine.length) return null;
  const mine = worth(lowest(me.engine));
  const all = targets.filter((t) => t.status === "banked").flatMap((t) => t.engine.map((e) => ({ t, e })));
  const pool = all.filter(({ e }) => worth(e) > mine);
  if (!pool.length) return null;
  return leaderFirst(pub, pool).reduce((a, b) => (worth(b.e) > worth(a.e) ? b : a));
}

/** Whether `me` may play `card` now: the game's own checks (`badPlay`). */
function canPlay(pub: Pub, me: Player, card: PowerCard): boolean {
  if (pub.played || card.power === "block") return false;
  if (me.status !== "flipping" && !isAimed(card.power) && card.power !== "heatwave") return false;
  return !isAimed(card.power) || targetsFor(pub, me, card.power as Pending["kind"]).length > 0;
}

/** Whether a playable card does us any good on a saved or too-hot turn. */
function usefulSaved(pub: Pub, me: Player, power: PowerKind): boolean {
  if (power === "heatwave") return true;
  const targets = targetsFor(pub, me, power as Pending["kind"]);
  if (power === "steal") return stealPick(pub, me, targets) !== null;
  if (power === "wrench") return swapBust(me, targets) !== null || swapGain(pub, me, targets) !== null;
  if (power === "dump") {
    // Saved, a Dump costs our points: only when our lowest card makes them go too hot.
    if (me.status !== "banked") return true;
    const t = nearest(pub, targets);
    return t.heat + worth(lowest(me.engine)) > t.gauge;
  }
  return true;
}

/** A hand card to play while flipping, before the flip or save, or null to keep them all. */
function flipperPlay(pub: Pub, me: Player, hand: PowerCard[]): PowerCard | null {
  const card = (power: PowerKind) => hand.find((c) => c.power === power && canPlay(pub, me, c));
  const cool = card("vent");
  if (cool && me.heat > 0 && room(me) <= COOL_ROOM) return cool;
  const double = card("turbo");
  if (double && !me.turbo && room(me) >= DOUBLE_ROOM) return double;
  const steal = card("steal");
  if (steal && stealPick(pub, me, targetsFor(pub, me, "steal"))) return steal;
  return card("shove") ?? card("fuse") ?? card("dump") ?? card("audit") ?? null;
}

/** A saved or too-hot turn: the best card that does some good, else pass. */
function savedTurn(pub: Pub, me: Player, hand: PowerCard[], ctx: BotContext): OverheatAction {
  const playable = hand.filter((c) => canPlay(pub, me, c));
  if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) {
    const options: OverheatAction[] = [{ type: "pass" }, ...playable.map((c) => ({ type: "play" as const, cardId: c.id }))];
    return options[ctx.randomInt(options.length)]!;
  }
  for (const power of SAVED_ORDER) {
    const c = playable.find((x) => x.power === power);
    if (c && usefulSaved(pub, me, power)) return { type: "play", cardId: c.id };
  }
  return { type: "pass" };
}

/** The answer to a pending aimed card, with the same scoring as the turn. */
function choice(pub: Pub, me: Player, pending: Pending, ctx: BotContext): OverheatAction | null {
  const targets = targetsFor(pub, me, pending.kind);
  if (!targets.length) return null;
  const random = ctx.randomInt(RANDOM_MOVE_ODDS) === 0;
  const any = <T>(xs: T[]): T => xs[ctx.randomInt(xs.length)]!;

  if (pending.kind === "wrench") {
    if (random) {
      const t = any(targets);
      const theirs = any(t.engine);
      return { type: "wrench", targetId: t.id, mine: any(me.engine).card.id, theirs: theirs.card.id };
    }
    const bust = swapBust(me, targets);
    if (bust) return { type: "wrench", targetId: bust.id, mine: highest(me.engine).card.id, theirs: lowest(bust.engine).card.id };
    const gain = swapGain(pub, me, targets);
    if (gain) return { type: "wrench", targetId: gain.t.id, mine: lowest(me.engine).card.id, theirs: gain.e.card.id };
    // Otherwise take from the row where the swap cools us most.
    const t = coolest(targets);
    return { type: "wrench", targetId: t.id, mine: highest(me.engine).card.id, theirs: lowest(t.engine).card.id };
  }
  if (pending.kind === "steal") {
    if (random) {
      const t = any(targets);
      return { type: "steal", targetId: t.id, theirs: any(t.engine).card.id };
    }
    const pick = stealPick(pub, me, targets);
    if (pick) return { type: "steal", targetId: pick.t.id, theirs: pick.e.card.id };
    // Nothing safe or useful: the smallest card does the least harm.
    const all = targets.flatMap((t) => t.engine.map((e) => ({ t, e })));
    const least = all.reduce((a, b) => (worth(b.e) < worth(a.e) ? b : a));
    return { type: "steal", targetId: least.t.id, theirs: least.e.card.id };
  }
  if (pending.kind === "dump") {
    if (random) return { type: "dump", targetId: any(targets).id, mine: any(me.engine).card.id };
    // Too hot, our row is worth nothing: give the highest. Flipping, the
    // highest when it makes them go too hot or cools us when close. Saved, it
    // costs our points: the lowest.
    const t = nearest(pub, targets);
    const top = highest(me.engine);
    const big =
      me.status === "busted" || (me.status === "flipping" && (t.heat + worth(top) > t.gauge || room(me) <= COOL_ROOM));
    return { type: "dump", targetId: t.id, mine: (big ? top : lowest(me.engine)).card.id };
  }
  if (random) return { type: "target", targetId: any(targets).id };
  if (pending.kind === "audit") {
    const top = (p: Player) => worth(p.engine[auditIndex(p.engine)]!);
    return { type: "target", targetId: targets.reduce((a, b) => (top(b) > top(a) ? b : a)).id };
  }
  if (pending.kind === "fuse" && pub.settings.powers !== "cutthroat") {
    // Classic keeps its old aim: the score leader.
    return { type: "target", targetId: targets.reduce((a, b) => (b.score > a.score ? b : a)).id };
  }
  return { type: "target", targetId: nearest(pub, targets).id };
}

/**
 * Overheat: flip first, then bank when the room left is small. A Push goes to
 * whoever is closest to the limit, a Burn to the score leader, and a Swap
 * busts someone if it can, or else cools the bot's own engine. In Cutthroat
 * Push, Burn and Dump go to the flipper closest to the limit, the leader
 * first, and the bot plays
 * a hand card before the flip or save when one helps: Cool when close, Double
 * early, a Steal that fits, then Push, Burn, Dump or Audit when they have a
 * target. On a saved or too-hot turn it plays the best card that does some
 * good, else passes.
 */
export const overheatBot: GameBot<OverheatPublicState, OverheatPrivateState, OverheatAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (pub.step === "finished") return null;
    const me = pub.players.find((p) => p.id === playerId);
    if (!me) return null;

    // A Shove can make another seat choose, so look here before the turn.
    if (pub.step === "choosing") {
      const pending = pub.pending;
      if (!pending || pending.chooserId !== playerId) return null;
      return choice(pub, me, pending, ctx);
    }

    if (pub.step !== "turn" || pub.currentPlayerId !== playerId) return null;
    const hand = priv?.hand ?? [];
    if (me.status !== "flipping") return savedTurn(pub, me, hand, ctx);
    const wins = me.flipped && me.score + bankScore(me.engine, me.redline) >= pub.settings.target;
    const card = wins ? null : flipperPlay(pub, me, hand);
    if (card) return { type: "play", cardId: card.id };
    if (!me.flipped) return { type: "flip" };
    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) return { type: ctx.randomInt(2) === 0 ? "flip" : "bank" };
    if (wins) return { type: "bank" };
    const cut = pub.settings.powers === "cutthroat";
    const m = margin(me);
    if (m <= (cut ? CUT_BANK_MARGIN : BANK_MARGIN)) return { type: "bank" };
    if (m >= (cut ? CUT_FLIP_MARGIN : FLIP_MARGIN)) return { type: "flip" };
    return { type: ctx.randomInt(cut ? CUT_MIDDLE_FLIP_ODDS : MIDDLE_FLIP_ODDS) === 0 ? "flip" : "bank" };
  },
};
