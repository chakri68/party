import { h, replaceChildren, seatName, type GameViewProps } from "@games/ui";
import { PROBLEM_TEXT } from "../shared/cards.ts";
import type { ActionCard, ActionKind, NmpAction, NmpPrivateState, NmpPublicState, PublicMove } from "../shared/types.ts";
import { cardFace } from "./cards.ts";
import { cardMove } from "./moves.ts";

// The window prompts: the target window, the HR window and the challenge
// window. `promptModel` says what the prompt shows (pure, so it is tested
// without a page); `renderPrompt` draws it into the slot above the hand.

/** Names as a sentence needs them: "You" / "you" for this player. */
export interface Names {
  who(id: string): string;
  whom(id: string): string;
}

export function namesFor(props: Pick<GameViewProps, "room" | "playerId">): Names {
  return {
    who: (id) => (id === props.playerId ? "You" : seatName(props.room, id)),
    whom: (id) => (id === props.playerId ? "you" : seatName(props.room, id)),
  };
}

/** A prompt button. It sends `action`, or (Revenge) starts a seat pick for `pickCardId`. */
export interface PromptButton {
  key: "not-me" | "revenge" | "accept" | "hr" | "challenge" | "pass";
  label: string;
  primary: boolean;
  action: NmpAction | null;
  pickCardId: string | null;
}

export interface PromptModel {
  step: "target" | "hr" | "challenge";
  /** Who played what. */
  head: string;
  /** What it will do, and where this player stands. */
  notes: string[];
  /** The owner's own face-down card, in a challenge window. */
  faceDown: ActionCard | null;
  buttons: PromptButton[];
}

/** "Asha passed it to Ravi. Ravi sent it back." The moves of one pass, in order. */
export function movesText(moves: PublicMove[], n: Names): string {
  return moves
    .map((m) => {
      if (m.kind === "blame") return `${n.who(m.actorId)} passed it to ${n.whom(m.targetId)}.`;
      if (m.kind === "not-me") return `${n.who(m.actorId)} sent it back.`;
      return `${n.who(m.actorId)} sent it to ${n.whom(m.targetId)}.`;
    })
    .join(" ");
}

/** Who gets the Problem if nobody cancels the last move. */
export function landsOn(moves: PublicMove[]): string | null {
  const blame = moves[0];
  if (blame?.kind !== "blame") return null;
  const last = moves.at(-1)!;
  if (last.kind === "not-me") return blame.actorId;
  return last.targetId;
}

const warnings = (n: number) => `${n} ${n === 1 ? "warning" : "warnings"}`;

/** The first playable card of a kind, if any. */
function playableOf(priv: NmpPrivateState, kind: ActionKind): { cardId: string; targets: string[] | null } | null {
  return priv.playable.find((p) => priv.hand.some((c) => c.id === p.cardId && c.kind === kind)) ?? null;
}

const button = (key: PromptButton["key"], label: string, action: NmpAction | null, primary = false, pickCardId: string | null = null): PromptButton =>
  ({ key, label, primary, action, pickCardId });

/** What the prompt shows for this player in a window, or null outside one. */
export function promptModel(game: NmpPublicState, priv: NmpPrivateState | null, me: string, n: Names): PromptModel | null {
  const problem = game.problem;
  if (!problem) return null;
  const myPassed = !!game.players.find((p) => p.id === me)?.passed;
  const token = priv?.token ?? game.token;

  if (game.step === "target") {
    const blame = game.moves[0];
    if (blame?.kind !== "blame") return null;
    const name = PROBLEM_TEXT[problem.kind].name;
    if (blame.targetId !== me) {
      return {
        step: "target",
        head: `${n.who(blame.actorId)} ${blame.actorId === me ? "want" : "wants"} to pass ${name} to ${n.whom(blame.targetId)}.`,
        notes: [`${n.who(blame.targetId)} is deciding.`],
        faceDown: null,
        buttons: [],
      };
    }
    const buttons: PromptButton[] = [];
    if (priv?.canAccept) {
      const notMe = playableOf(priv, "not-me");
      const revenge = playableOf(priv, "revenge");
      if (notMe) buttons.push(button("not-me", "Not Me", cardMove("target", "not-me", token, notMe.cardId), true));
      if (revenge?.targets?.length) buttons.push(button("revenge", "Revenge", null, !notMe, revenge.cardId));
      buttons.push(button("accept", "Accept", { type: "accept", token }, !notMe && !revenge));
    }
    return {
      step: "target",
      head: `${n.who(blame.actorId)} wants to pass ${name} to you.`,
      notes: ["If time runs out, you take it."],
      faceDown: null,
      buttons,
    };
  }

  if (game.step === "hr") {
    const last = game.moves.at(-1);
    const land = landsOn(game.moves);
    if (!last || !land) return null;
    const notes = [`If nobody plays HR Complaint, ${n.whom(land)} ${land === me ? "get" : "gets"} it.`];
    const buttons: PromptButton[] = [];
    if (priv?.canPass) {
      const hr = playableOf(priv, "hr-complaint");
      if (hr) buttons.push(button("hr", "HR Complaint", cardMove("hr", "hr-complaint", token, hr.cardId), true));
      buttons.push(button("pass", "Pass", { type: "pass", token }, !hr));
    } else if (myPassed) {
      notes.push("You passed. Waiting.");
    } else if (last.actorId === me) {
      notes.push("Other players can cancel it now.");
    }
    return { step: "hr", head: movesText(game.moves, n), notes, faceDown: null, buttons };
  }

  if (game.step === "challenge" && game.report) {
    const owner = game.report.ownerId;
    const mine = owner === me;
    const notes: string[] = [];
    const buttons: PromptButton[] = [];
    if (mine) {
      notes.push("If someone challenges, everyone sees your card.");
    } else if (priv?.canChallenge) {
      const cost = warnings(PROBLEM_TEXT[problem.kind].penalty + 1);
      notes.push(`If you challenge and it is not a Quick Fix, ${n.whom(owner)} gets ${cost}. If it is one, you get 1 warning.`);
      buttons.push(button("challenge", "Challenge", { type: "challenge", token }));
      if (priv.canPass) buttons.push(button("pass", "Pass", { type: "pass", token }));
    } else if (myPassed) {
      notes.push("You passed. Waiting.");
    } else {
      notes.push("Other players can challenge it now.");
    }
    return {
      step: "challenge",
      head: mine ? "You say this is a Quick Fix." : `${n.who(owner)} says this is a Quick Fix.`,
      notes,
      faceDown: mine ? (priv?.myReportCard ?? null) : null,
      buttons,
    };
  }
  return null;
}

export interface PromptOptions {
  /** A move was sent and not yet answered. */
  locked: boolean;
  /** A Revenge seat pick is open below: the pick bar has the buttons. */
  picking: boolean;
  /** The countdown pill and bar, kept by the view across redraws. */
  timer: HTMLElement;
  bar: HTMLElement;
  onButton(b: PromptButton): void;
}

/** Draws the prompt. Never covers the hand: it is a slot above it. */
export function renderPrompt(el: HTMLElement, model: PromptModel, opts: PromptOptions): void {
  el.className = `nmp-prompt k-${model.step}`;
  replaceChildren(
    el,
    h(
      "div",
      { class: "nmp-prompt-top" },
      h(
        "div",
        { class: "nmp-prompt-text", role: "status" },
        h("p", { class: "nmp-prompt-head" }, model.head),
        model.notes.map((t) => h("p", { class: "nmp-prompt-note" }, t)),
      ),
      opts.timer,
    ),
    opts.bar,
    model.faceDown
      ? h(
          "div",
          { class: "nmp-facedown" },
          h("span", { class: "nmp-label" }, "Your face-down card"),
          cardFace(model.faceDown.kind, "small"),
        )
      : null,
    model.buttons.length && !opts.picking
      ? h(
          "div",
          { class: "nmp-buttons wrap" },
          model.buttons.map((b) =>
            h(
              "button",
              {
                type: "button",
                class: b.primary ? "primary" : "",
                "data-focus": `act:${b.key}`,
                disabled: opts.locked,
                onclick: () => opts.onButton(b),
              },
              b.label,
            ),
          ),
        )
      : null,
  );
}
