// The client's pure helpers: feed wording, the card-to-action mapping, the
// "when can I play it" line and the window prompts. No page needed.
import type { GameViewProps } from "@games/ui";
import { describe as group, expect, it } from "vitest";
import { playWhen } from "../client/cards.ts";
import { describe, feedLine, nextFeed } from "../client/feed.ts";
import { cardMove } from "../client/moves.ts";
import { landsOn, movesText, namesFor, promptModel } from "../client/prompts.ts";
import { RULE_GROUPS } from "../client/rules.ts";
import {
  ACTION_KINDS,
  type ActionCard,
  type NmpEvent,
  type NmpPrivateState,
  type NmpPublicPlayer,
  type NmpPublicState,
} from "../shared/index.ts";

const ME = "p1";
const props = {
  playerId: ME,
  room: { seats: [{ id: "p1", name: "Asha" }, { id: "p2", name: "Ravi" }, { id: "p3", name: "Meera" }] },
} as unknown as GameViewProps;
const names = namesFor(props);
/** Names as another viewer reads them. */
const namesOf = (playerId: string) => namesFor({ ...props, playerId });

const say = (e: NmpEvent) => describe(e, props);
const card = (kind: ActionCard["kind"], n = 1): ActionCard => ({ id: `${kind}-${n}`, kind });

group("feed wording", () => {
  it("says each event as one plain sentence", () => {
    expect(say({ type: "turn", playerId: ME, round: 1 })).toBe("Your turn.");
    expect(say({ type: "turn", playerId: "p2", round: 1 })).toBe("Ravi's turn.");
    expect(say({ type: "played", playerId: "p2", kind: "blame-game", targetId: ME })).toBe("Ravi played Blame Game on you.");
    expect(say({ type: "played", playerId: ME, kind: "intern" })).toBe("You played Intern.");
    expect(say({ type: "drew", playerId: "p3", problem: "data-leak" })).toBe("Meera drew a Problem: Data Leak.");
    expect(say({ type: "drew", playerId: "p3", problem: null })).toBe("Meera drew a card.");
    expect(say({ type: "drew-card", card: card("spy") })).toBe("You drew Spy.");
    expect(say({ type: "spied", fromId: "p2", toId: ME, card: card("not-me") })).toBe("You took Not Me from Ravi.");
    expect(say({ type: "spied", fromId: ME, toId: "p2", card: card("not-me") })).toBe("Ravi took your Not Me.");
    expect(say({ type: "spied", fromId: "p3", toId: "p2" })).toBe("Ravi took a card from Meera.");
    expect(say({ type: "moved", problemKind: "server-down", fromId: "p2", toId: ME })).toBe("Ravi passed Server Down to you.");
    expect(say({ type: "fixed", playerId: "p2", by: "quick-fix" })).toBe("Ravi fixed the Problem.");
    expect(say({ type: "fixed", playerId: "p2", by: "report" })).toBe("The report worked. Ravi fixed the Problem.");
    expect(say({ type: "warned", playerId: ME, amount: 0, shielded: true })).toBe("Your Intern took the warning.");
    expect(say({ type: "warned", playerId: "p2", amount: 1, shielded: true })).toBe("Ravi's Intern took 1 warning. Ravi got 1 warning.");
    expect(say({ type: "warned", playerId: "p2", amount: 2, shielded: false })).toBe("Ravi got 2 warnings.");
    expect(say({ type: "fired", playerId: ME, order: 1 })).toBe("You are fired.");
    expect(say({ type: "fired", playerId: "p3", order: 1 })).toBe("Meera is fired.");
    expect(say({ type: "report", playerId: "p2" })).toBe("Ravi played a Fake Report. They say the face-down card is a Quick Fix.");
    expect(say({ type: "challenged", challengerId: ME, ownerId: "p2", card: card("spy"), lied: true })).toBe(
      "You challenged Ravi. The card was Spy, not a Quick Fix.",
    );
    expect(say({ type: "challenged", challengerId: "p2", ownerId: ME, card: card("quick-fix"), lied: false })).toBe(
      "Ravi challenged you. It was a real Quick Fix.",
    );
    expect(say({ type: "passed", playerId: "p3" })).toBe("Meera passed.");
    expect(say({ type: "removed", playerId: "p3" })).toBe("Meera left the game.");
    expect(say({ type: "game-over", winnerIds: [ME] })).toBe("You win!");
    expect(say({ type: "game-over", winnerIds: [ME, "p2"] })).toBe("You win, with Ravi.");
    expect(say({ type: "game-over", winnerIds: ["p2", "p3"] })).toBe("Ravi and Meera win.");
    expect(say({ type: "game-over", winnerIds: [] })).toBe("The game is over.");
  });

  it("shows my own drawn card over the public draw", () => {
    const drew: NmpEvent = { type: "drew", playerId: ME, problem: null };
    expect(feedLine(drew, [drew, { type: "drew-card", card: card("spy") }], props)).toBe("You drew Spy.");
    expect(feedLine(drew, [drew], props)).toBe("You drew a card.");
  });

  it("says what a challenge cost, not only the last event", () => {
    const shown: NmpEvent = { type: "challenged", challengerId: "p3", ownerId: "p2", card: card("spy"), lied: true };
    const warned: NmpEvent = { type: "warned", playerId: "p2", amount: 2, shielded: false };
    expect(feedLine(warned, [shown, warned], props)).toBe("Meera challenged Ravi. The card was Spy, not a Quick Fix. Ravi got 2 warnings.");
  });

  it("keeps the private line on a later update without that event", () => {
    const drew: NmpEvent = { type: "drew", playerId: ME, problem: null };
    const first = nextFeed(drew, [drew, { type: "drew-card", card: card("spy") }], props, null);
    expect(first.text).toBe("You drew Spy.");
    expect(nextFeed(drew, [], props, first).text).toBe("You drew Spy.");
    expect(nextFeed(drew, [{ type: "passed", playerId: "p2" }], props, first).text).toBe("You drew Spy.");
    // The same event again (an Overtime draw) is new news.
    expect(nextFeed(drew, [drew], props, first).text).toBe("You drew a card.");
    const fixed: NmpEvent = { type: "fixed", playerId: "p2", by: "quick-fix" };
    expect(nextFeed(fixed, [], props, first).text).toBe("Ravi fixed the Problem.");
  });
});

group("cardMove", () => {
  it("maps each card to the action for this step", () => {
    expect(cardMove("action", "spy", 3, "spy-1", { targetId: "p2" })).toEqual({ type: "play", token: 3, cardId: "spy-1", targetId: "p2" });
    expect(cardMove("action", "intern", 3, "intern-1")).toEqual({ type: "play", token: 3, cardId: "intern-1" });
    expect(cardMove("problem", "quick-fix", 3, "quick-fix-1")).toEqual({ type: "fix", token: 3, cardId: "quick-fix-1" });
    expect(cardMove("problem", "blame-game", 3, "blame-game-1", { targetId: "p2" })).toEqual({
      type: "blame", token: 3, cardId: "blame-game-1", targetId: "p2",
    });
    expect(cardMove("problem", "blame-game", 3, "blame-game-1")).toBeNull();
    expect(cardMove("problem", "fake-report", 3, "fake-report-1", { faceDownId: "spy-1" })).toEqual({
      type: "fake-report", token: 3, cardId: "fake-report-1", faceDownId: "spy-1",
    });
    expect(cardMove("problem", "not-me", 3, "not-me-1")).toBeNull();
    expect(cardMove("target", "not-me", 3, "not-me-1")).toEqual({ type: "not-me", token: 3, cardId: "not-me-1" });
    expect(cardMove("target", "revenge", 3, "revenge-1", { targetId: "p3" })).toEqual({
      type: "revenge", token: 3, cardId: "revenge-1", targetId: "p3",
    });
    expect(cardMove("target", "revenge", 3, "revenge-1")).toBeNull();
    expect(cardMove("hr", "hr-complaint", 3, "hr-complaint-1")).toEqual({ type: "hr", token: 3, cardId: "hr-complaint-1" });
    expect(cardMove("hr", "not-me", 3, "not-me-1")).toBeNull();
    expect(cardMove("challenge", "quick-fix", 3, "quick-fix-1")).toBeNull();
  });
});

group("playWhen", () => {
  it("says when each kind of card can be played", () => {
    expect(playWhen("spy")).toBe("Play it on your turn.");
    expect(playWhen("quick-fix")).toBe("Play it when you hold a Problem.");
    expect(playWhen("not-me")).toBe("Play it when a Problem is passed to you.");
    expect(playWhen("hr-complaint")).toBe("Play it right after someone passes a Problem.");
  });
});

group("rules sheet groups", () => {
  it("lists every action card once", () => {
    const listed = RULE_GROUPS.flatMap((g) => g.kinds);
    expect([...listed].sort()).toEqual([...ACTION_KINDS].sort());
    expect(RULE_GROUPS.map((g) => g.title)).toEqual(["When you hold a Problem", "Reactions", "Your turn"]);
  });
});

// ---- window prompts ---------------------------------------------------------

const player = (id: string, over: Partial<NmpPublicPlayer> = {}): NmpPublicPlayer => ({
  id, warnings: 0, handCount: 5, shield: false, overtime: false, fired: false, firedOrder: null, removed: false, away: false, passed: false, ...over,
});

function game(over: Partial<NmpPublicState>): NmpPublicState {
  return {
    players: [player("p1"), player("p2"), player("p3")],
    step: "target", token: 7, round: 1, turnPlayerId: "p2", actionsLeft: 2, drawCount: 10, discardCount: 0,
    problem: { cardId: "data-leak-1", kind: "data-leak", ownerId: "p2", lastMovedFromId: null, attemptsLeft: 3 },
    moves: [], report: null, deadline: 1000, windowMs: 8000, lastEvent: null, winnerIds: [],
    ...over,
  };
}

function priv(hand: ActionCard[], over: Partial<NmpPrivateState> = {}): NmpPrivateState {
  return { hand, token: 7, playable: [], canDraw: false, canAccept: false, canPass: false, canChallenge: false, myReportCard: null, ...over };
}

group("movesText and landsOn", () => {
  it("tells the pass in order, and where it lands", () => {
    const blame = { kind: "blame", actorId: "p2", targetId: ME } as const;
    expect(movesText([blame], "Data Leak", names)).toBe("Ravi passed Data Leak to you.");
    expect(landsOn([blame])).toBe(ME);
    expect(movesText([blame, { kind: "not-me", actorId: ME }], "Data Leak", names)).toBe("Ravi passed Data Leak to you. You sent it back.");
    expect(landsOn([blame, { kind: "not-me", actorId: ME }])).toBe("p2");
    expect(movesText([blame, { kind: "revenge", actorId: ME, targetId: "p3" }], "Data Leak", names)).toBe("Ravi passed Data Leak to you. You sent it to Meera.");
    expect(landsOn([blame, { kind: "revenge", actorId: ME, targetId: "p3" }])).toBe("p3");
    expect(landsOn([])).toBeNull();
  });
});

group("promptModel", () => {
  const blameOnMe = { kind: "blame", actorId: "p2", targetId: ME } as const;

  it("target window, me: Not Me, Revenge (a pick) and Accept", () => {
    const hand = [card("not-me"), card("revenge")];
    const m = promptModel(
      game({ moves: [blameOnMe] }),
      priv(hand, { canAccept: true, playable: [{ cardId: "not-me-1", targets: null }, { cardId: "revenge-1", targets: ["p3"] }] }),
      ME,
      names,
    )!;
    expect(m.head).toBe("Ravi wants to pass Data Leak to you.");
    expect(m.notes).toEqual(["If time runs out, you take it."]);
    expect(m.buttons.map((b) => b.label)).toEqual(["Not Me", "Revenge", "Accept"]);
    expect(m.buttons[0]!.action).toEqual({ type: "not-me", token: 7, cardId: "not-me-1" });
    expect(m.buttons[1]!.action).toBeNull();
    expect(m.buttons[1]!.pickCardId).toBe("revenge-1");
    expect(m.buttons[2]!.action).toEqual({ type: "accept", token: 7 });
  });

  it("target window, me with no answer card: only Accept", () => {
    const m = promptModel(game({ moves: [blameOnMe] }), priv([card("spy")], { canAccept: true }), ME, names)!;
    expect(m.buttons.map((b) => b.label)).toEqual(["Accept"]);
    expect(m.buttons[0]!.primary).toBe(true);
  });

  it("target window, someone else: who is deciding, no buttons", () => {
    const m = promptModel(game({ moves: [{ kind: "blame", actorId: "p2", targetId: "p3" }] }), priv([]), ME, names)!;
    expect(m.head).toBe("Ravi wants to pass Data Leak to Meera.");
    expect(m.notes).toEqual(["Meera is deciding."]);
    expect(m.buttons).toEqual([]);
    // A watcher with no private state sees the same.
    expect(promptModel(game({ moves: [{ kind: "blame", actorId: "p2", targetId: "p3" }] }), null, "x", names)!.notes).toEqual(["Meera is deciding."]);
  });

  it("HR window: HR Complaint and Pass, then You passed. Waiting.", () => {
    const moves = [blameOnMe, { kind: "not-me", actorId: ME } as const];
    const g = game({ step: "hr", moves });
    const hand = [card("hr-complaint")];
    const m = promptModel(g, priv(hand, { canPass: true, playable: [{ cardId: "hr-complaint-1", targets: null }] }), "p3", namesOf("p3"))!;
    expect(m.head).toBe("Ravi passed Data Leak to Asha. Asha sent it back.");
    expect(m.notes).toEqual(["If nobody plays HR Complaint, Ravi gets it."]);
    expect(m.buttons.map((b) => [b.label, b.action])).toEqual([
      ["HR Complaint", { type: "hr", token: 7, cardId: "hr-complaint-1" }],
      ["Pass", { type: "pass", token: 7 }],
    ]);
    const passed = game({ step: "hr", moves, players: [player("p1"), player("p2"), player("p3", { passed: true })] });
    const after = promptModel(passed, priv(hand), "p3", namesOf("p3"))!;
    expect(after.buttons).toEqual([]);
    expect(after.notes.at(-1)).toBe("You passed. Waiting.");
  });

  it("HR window: a player without HR Complaint sees the same prompt, with only Pass", () => {
    const moves = [blameOnMe, { kind: "not-me", actorId: ME } as const];
    const g = game({ step: "hr", moves });
    const holder = promptModel(g, priv([card("hr-complaint")], { canPass: true, playable: [{ cardId: "hr-complaint-1", targets: null }] }), "p3", namesOf("p3"))!;
    const without = promptModel(g, priv([card("spy")], { canPass: true }), "p3", namesOf("p3"))!;
    expect(without.head).toBe(holder.head);
    expect(without.notes).toEqual(holder.notes);
    expect(without.buttons.map((b) => [b.label, b.primary, b.action])).toEqual([["Pass", true, { type: "pass", token: 7 }]]);
  });

  it("HR window: the one who made the last move waits", () => {
    const m = promptModel(game({ step: "hr", moves: [blameOnMe] }), priv([]), "p2", namesOf("p2"))!;
    expect(m.head).toBe("You passed Data Leak to Asha.");
    expect(m.notes).toEqual(["If nobody plays HR Complaint, Asha gets it.", "Other players can cancel it now."]);
  });

  it("challenge window: Challenge and Pass for others, the face-down card for the owner", () => {
    const g = game({ step: "challenge", moves: [], report: { ownerId: "p2" } });
    const m = promptModel(g, priv([], { canChallenge: true, canPass: true }), ME, names)!;
    expect(m.head).toBe("Ravi says this is a Quick Fix for Data Leak.");
    expect(m.notes).toEqual(["If you challenge and it is not a Quick Fix, Ravi gets 3 warnings. If it is a Quick Fix, you get 1 warning."]);
    expect(m.buttons.map((b) => [b.label, b.action])).toEqual([
      ["Challenge", { type: "challenge", token: 7 }],
      ["Pass", { type: "pass", token: 7 }],
    ]);
    expect(m.faceDown).toBeNull();
    const own = promptModel(g, priv([], { myReportCard: card("spy") }), "p2", namesOf("p2"))!;
    expect(own.head).toBe("You say this is a Quick Fix for Data Leak.");
    expect(own.notes).toEqual(["If someone challenges, everyone sees your card.", "It is not a Quick Fix, so you get 3 warnings."]);
    expect(own.faceDown).toEqual(card("spy"));
    const trap = promptModel(g, priv([], { myReportCard: card("quick-fix") }), "p2", namesOf("p2"))!;
    expect(trap.notes.at(-1)).toBe("It is a Quick Fix, so the player who challenges gets 1 warning.");
    expect(own.buttons).toEqual([]);
  });

  it("challenge window: a visible Intern takes one warning off each cost", () => {
    const players = [player("p1", { shield: true }), player("p2", { shield: true }), player("p3")];
    const g = game({ step: "challenge", report: { ownerId: "p2" }, players });
    const m = promptModel(g, priv([], { canChallenge: true, canPass: true }), ME, names)!;
    expect(m.notes).toEqual(["If you challenge and it is not a Quick Fix, Ravi gets 2 warnings. If it is a Quick Fix, your Intern takes the warning."]);
    const own = promptModel(g, priv([], { myReportCard: card("spy") }), "p2", namesOf("p2"))!;
    expect(own.notes.at(-1)).toBe("It is not a Quick Fix, so you get 2 warnings.");
  });

  it("no prompt outside a window", () => {
    expect(promptModel(game({ step: "action" }), priv([]), ME, names)).toBeNull();
    expect(promptModel(game({ step: "problem" }), priv([]), ME, names)).toBeNull();
  });
});
