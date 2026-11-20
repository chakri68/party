import type { GameBot } from "@games/game-core";
import type { Disc, ThornsAction, ThornsPrivateState, ThornsPublicState } from "../shared/types.ts";

/** About 1 move in this many is any legal move, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 9;
/** About 1 in this many: put the thorn down, and bid instead of placing. */
const THORN_ODDS = 3;
const BID_ODDS = 3;
/** A bot bids instead of placing only once it has this many discs on its mat. */
const BID_AFTER_DISCS = 2;

/**
 * Thorns: place a thorn now and then, bid on what it can safely flip, and
 * flip the mat with the most discs left. It never bids past its own thorn
 * unless it is forced to, because its own stack flips first.
 */
export const thornsBot: GameBot<ThornsPublicState, ThornsPrivateState, ThornsAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    // A player who is out, or removed, has nothing to do.
    const me = pub.players.find((p) => p.id === playerId);
    if (!me || me.out || me.removed) return null;
    if (priv.canReady) return { type: "ready" };

    if (priv.canFlip.length) {
      const flipped = new Map<string, number>();
      for (const f of pub.challenge?.flips ?? []) flipped.set(f.owner, (flipped.get(f.owner) ?? 0) + 1);
      const left = (owner: string) => (pub.players.find((p) => p.id === owner)?.height ?? 0) - (flipped.get(owner) ?? 0);
      if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) return { type: "flip", owner: priv.canFlip[ctx.randomInt(priv.canFlip.length)]! };
      const most = Math.max(...priv.canFlip.map(left));
      const best = priv.canFlip.filter((o) => left(o) === most);
      return { type: "flip", owner: best[ctx.randomInt(best.length)]! };
    }

    if (!priv.canPlace && !priv.canBid && !priv.canPass) return null;

    // Roses above my thorn are the most I can win a bid on; a bid past that is a sure loss.
    const thornAt = priv.stack.indexOf("thorn");
    const safe = thornAt < 0 ? priv.stack.length : priv.stack.length - 1 - thornAt;
    const thornDown = thornAt >= 0;
    const min = pub.minBid;
    const bidOk = priv.canBid && min <= pub.tableTotal;

    const placeDisc = (): ThornsAction => {
      const wantThorn = priv.hand.includes("thorn") && ctx.randomInt(THORN_ODDS) === 0;
      const disc: Disc = wantThorn ? "thorn" : priv.hand.includes("rose") ? "rose" : "thorn";
      return { type: "place", disc };
    };

    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) {
      // A slip: a kind of move first, so a big table's many bid sizes don't crowd out the rest.
      const kinds: ThornsAction["type"][] = [];
      if (priv.canPlace && priv.hand.length) kinds.push("place");
      if (bidOk) kinds.push("bid");
      if (priv.canPass) kinds.push("pass");
      if (kinds.length) {
        const kind = kinds[ctx.randomInt(kinds.length)]!;
        if (kind === "place") return { type: "place", disc: priv.hand[ctx.randomInt(priv.hand.length)]! };
        if (kind === "bid") return { type: "bid", amount: Math.min(pub.tableTotal, min + ctx.randomInt(2)) };
        return { type: "pass" };
      }
    }

    // Placing the first disc, and any turn where it can place rather than bid.
    if (priv.canPlace && !priv.canPass) {
      const ownDiscs = priv.stack.length;
      const wantsBid = bidOk && ownDiscs >= BID_AFTER_DISCS && !(thornDown && min > safe) && ctx.randomInt(BID_ODDS) === 0;
      if (!wantsBid) return placeDisc();
    }

    if (!bidOk) return priv.canPass ? { type: "pass" } : null;

    // What I expect to flip: my safe roses and about half of the other discs.
    const others = pub.tableTotal - priv.stack.length;
    const fair = safe + Math.round(others / 2);
    if (priv.canPass && (min > fair || (thornDown && min > safe))) return { type: "pass" };
    return { type: "bid", amount: min };
  },
};
