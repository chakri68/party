import type { ActionKind, NmpAction, Step } from "../shared/types.ts";

/** What the player picks after Play: a seat, a second card to put face down, or nothing. */
export type Needs = "seat" | "face-down" | null;

export function needsFor(kind: ActionKind, targets: string[] | null): Needs {
  if (kind === "fake-report") return "face-down";
  return targets ? "seat" : null;
}

/** Read before a seat's name while picking it. */
export const PICK_VERB: Partial<Record<ActionKind, string>> = {
  overtime: "Give Overtime to",
  spy: "Take a card from",
  "blame-game": "Pass the Problem to",
  revenge: "Send the Problem to",
};

/**
 * The action that plays this card in this step. One place, so the hand, the
 * Problem buttons and the window prompts all send the same thing.
 */
export function cardMove(
  step: Step,
  kind: ActionKind,
  token: number,
  cardId: string,
  pick: { targetId?: string; faceDownId?: string } = {},
): NmpAction | null {
  const { targetId, faceDownId } = pick;
  switch (step) {
    case "action":
      return { type: "play", token, cardId, ...(targetId && { targetId }) };
    case "problem":
      if (kind === "quick-fix") return { type: "fix", token, cardId };
      if (kind === "blame-game" && targetId) return { type: "blame", token, cardId, targetId };
      if (kind === "fake-report" && faceDownId) return { type: "fake-report", token, cardId, faceDownId };
      return null;
    case "target":
      if (kind === "not-me") return { type: "not-me", token, cardId };
      if (kind === "revenge" && targetId) return { type: "revenge", token, cardId, targetId };
      return null;
    case "hr":
      return kind === "hr-complaint" ? { type: "hr", token, cardId } : null;
    default:
      return null;
  }
}
