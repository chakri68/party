// The client's pure helpers: log lines, the status banner and hand tags. No page needed.
import { seededRandomInt } from "@games/game-core";
import { describe as group, expect, it } from "vitest";
import { describe, handLabel, quickBets, resultText, statusText, waitingOn, type Names } from "../client/text.ts";
import { blackjackGame as bj } from "../server/game.ts";
import { DEFAULT_SETTINGS } from "../shared/types.ts";

const NAMES: Record<string, string> = { p1: "Asha", p2: "Ravi", p3: "Meera" };
const names: Names = { me: "p1", name: (id) => NAMES[id] ?? "?" };

const start = (deck: string[] = []) =>
  bj.createGame(["p1", "p2", "p3"].map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, { now: 0, randomInt: seededRandomInt(1) }, { deck }).state;

group("hand tags", () => {
  it("say what a hand got, in chips won", () => {
    expect(resultText({ result: "win", bet: 100, paid: 200 })).toBe("Win +100");
    expect(resultText({ result: "blackjack", bet: 15, paid: 37 })).toBe("Blackjack +22");
    expect(resultText({ result: "push", bet: 15, paid: 15 })).toBe("Tie");
    expect(resultText({ result: "bust", bet: 15, paid: 0 })).toBe("Bust");
  });

  it("label totals", () => {
    expect(handLabel({ total: 17, soft: true, blackjack: false })).toBe("Soft 17");
    expect(handLabel({ total: 21, soft: true, blackjack: true })).toBe("Blackjack");
    expect(handLabel({ total: 21, soft: true, blackjack: false })).toBe("21");
    expect(handLabel({ total: 25, soft: false, blackjack: false })).toBe("Bust 25");
  });

  it("quick bets stay inside the stack", () => {
    expect(quickBets(10, 1000)).toEqual([10, 25, 50, 100, 250, 500]);
    expect(quickBets(10, 60)).toEqual([10, 25, 50]);
    expect(quickBets(7, 7)).toEqual([]);
  });
});

group("log lines", () => {
  it("speak to you, and about others", () => {
    expect(describe({ type: "bet", playerId: "p1", amount: 50 }, names)).toBe("You bet 50.");
    expect(describe({ type: "bet", playerId: "p2", amount: 1500 }, names)).toBe("Ravi bets 1,500.");
    expect(describe({ type: "move", playerId: "p2", hand: 0, kind: "stand", auto: "timer" }, names)).toBe("Ravi stands (out of time).");
    expect(describe({ type: "bust", playerId: "p1", hand: 0, total: 24 }, names)).toBe("You went over 21 with 24.");
    expect(describe({ type: "round-start", round: 4, shuffled: true }, names)).toBe("Round 4. Place your bets. The dealer shuffled the cards.");
    expect(describe({ type: "back", playerId: "p2" }, names)).toBe("Ravi plays again from the next round.");
  });

  it("sum your hands at the pay", () => {
    const line = describe(
      {
        type: "settled",
        dealerTotal: 19,
        dealerBust: false,
        results: [
          { playerId: "p1", hand: 0, result: "win", bet: 100, paid: 200 },
          { playerId: "p1", hand: 1, result: "lose", bet: 100, paid: 0 },
        ],
      },
      names,
    );
    expect(line).toBe("The dealer has 19. You get your bet back.");
  });
});

group("status", () => {
  it("asks for your bet, then names who the table waits on", () => {
    let state = start();
    expect(statusText(bj.getPublicState(state), bj.getPrivateState(state, "p1"), names)).toBe("Place your bet");
    const r = bj.handleAction(state, "p1", { type: "bet", amount: 10 }, { now: 0, randomInt: seededRandomInt(1) });
    if (!r.ok) throw new Error(r.error.message);
    state = r.transition.state;
    expect(waitingOn(bj.getPublicState(state))).toEqual(["p2", "p3"]);
    expect(statusText(bj.getPublicState(state), bj.getPrivateState(state, "p1"), names)).toBe("Waiting for Ravi and Meera to bet");
  });
});
