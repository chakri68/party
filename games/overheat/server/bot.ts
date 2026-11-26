import type { GameBot } from "@games/game-core";
import { aimTargets, auditIndex, bankScore } from "../shared/rules.ts";
import type {
  EngineCard,
  OverheatAction,
  OverheatPlayerState,
  OverheatPrivateState,
  OverheatPublicState,
  Pending,
} from "../shared/types.ts";

/** About 1 move in this many is any legal move, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 8;
/** With this much room or less, a person banks. */
const BANK_MARGIN = 4;
/** With this much room or more, a person flips. */
const FLIP_MARGIN = 7;
/** Between the two, a person flips 1 time in this many. */
const MIDDLE_FLIP_ODDS = 3;

const worth = (e: EngineCard) => e.card.value * e.mult;
/** Heat left before the gauge, counting the fuses. A Turbo card counts double, so room is halved. */
const margin = (p: OverheatPlayerState) => (p.gauge - p.heat - p.fuses) / (p.turbo ? 2 : 1);

/** The same rule the game uses (`aimTargets`). */
function targetsFor(pub: OverheatPublicState, me: OverheatPlayerState, kind: Pending["kind"]) {
  const seat = pub.players.indexOf(me);
  return aimTargets(pub.players, seat, kind, pub.settings.powers === "cutthroat").map((i) => pub.players[i]!);
}

/**
 * Overheat: flip first, then bank when the room left is small. A Shove goes
 * to whoever is closest to the limit, a Fuse to the score leader, and a
 * Wrench busts someone if it can, or else cools the bot's own engine.
 */
export const overheatBot: GameBot<OverheatPublicState, OverheatPrivateState, OverheatAction> = {
  decide({ playerId, public: pub }, ctx) {
    if (pub.step === "finished") return null;
    const me = pub.players.find((p) => p.id === playerId);
    if (!me) return null;

    // A Shove can make another seat choose, so look here before the turn.
    if (pub.step === "choosing") {
      const pending = pub.pending;
      if (!pending || pending.chooserId !== playerId) return null;
      const targets = targetsFor(pub, me, pending.kind);
      if (!targets.length) return null;
      const random = ctx.randomInt(RANDOM_MOVE_ODDS) === 0;
      if (pending.kind === "wrench") {
        const mine = [...me.engine].sort((a, b) => worth(b) - worth(a))[0]!;
        const give = worth(mine);
        const lowest = (p: OverheatPlayerState) => [...p.engine].sort((a, b) => worth(a) - worth(b))[0]!;
        const busts = targets.filter((t) => t.heat - worth(lowest(t)) + give > t.gauge);
        const pool = random ? targets : busts.length ? busts : targets;
        // Without a bust, take from the engine where the swap cools us most.
        const best = random
          ? pool[ctx.randomInt(pool.length)]!
          : pool.reduce((a, b) => (worth(lowest(b)) < worth(lowest(a)) ? b : a));
        const theirs = random ? best.engine[ctx.randomInt(best.engine.length)]! : lowest(best);
        const given = random ? me.engine[ctx.randomInt(me.engine.length)]! : mine;
        return { type: "wrench", targetId: best.id, mine: given.card.id, theirs: theirs.card.id };
      }
      if (pending.kind === "steal") {
        // The best card that doesn't make us go too hot (any card when not flipping).
        const room = me.status === "flipping" ? me.gauge - me.heat - 1 : Infinity;
        const all = targets.flatMap((t) => t.engine.map((e) => ({ t, e })));
        const safe = all.filter(({ e }) => worth(e) <= room);
        const pool = random || !safe.length ? all : safe;
        const best = random ? pool[ctx.randomInt(pool.length)]! : pool.reduce((a, b) => (worth(b.e) > worth(a.e) ? b : a));
        return { type: "steal", targetId: best.t.id, theirs: best.e.card.id };
      }
      if (pending.kind === "dump") {
        const mine = random ? me.engine[ctx.randomInt(me.engine.length)]! : [...me.engine].sort((a, b) => worth(b) - worth(a))[0]!;
        const pick = random ? targets[ctx.randomInt(targets.length)]! : targets.reduce((a, b) => (margin(b) < margin(a) ? b : a));
        return { type: "dump", targetId: pick.id, mine: mine.card.id };
      }
      let pick = targets[ctx.randomInt(targets.length)]!;
      if (!random && pending.kind === "audit") {
        const top = (p: OverheatPlayerState) => worth(p.engine[auditIndex(p.engine)]!);
        pick = targets.reduce((a, b) => (top(b) > top(a) ? b : a));
      } else if (!random) {
        pick =
          pending.kind === "shove"
            ? targets.reduce((a, b) => (margin(b) < margin(a) || (margin(b) === margin(a) && b.score > a.score) ? b : a))
            : targets.reduce((a, b) => (b.score > a.score ? b : a));
      }
      return { type: "target", targetId: pick.id };
    }

    if (pub.step !== "turn" || pub.currentPlayerId !== playerId) return null;
    // A saved or too-hot turn (Cutthroat). The bot doesn't play hand cards yet.
    if (me.status !== "flipping") return { type: "pass" };
    if (!me.flipped) return { type: "flip" };
    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) return { type: ctx.randomInt(2) === 0 ? "flip" : "bank" };
    if (me.score + bankScore(me.engine, me.redline) >= pub.settings.target) return { type: "bank" };
    const room = margin(me);
    if (room <= BANK_MARGIN) return { type: "bank" };
    if (room >= FLIP_MARGIN) return { type: "flip" };
    return { type: ctx.randomInt(MIDDLE_FLIP_ODDS) === 0 ? "flip" : "bank" };
  },
};
