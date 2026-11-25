import type { ActionCard, ActionKind, ProblemCard, ProblemKind } from "./types.ts";

export interface CardText { name: string; line: string; timing: "proactive" | "problem" | "reaction" }

export const ACTION_TEXT: Record<ActionKind, CardText> = {
  "quick-fix": { name: "Quick Fix", line: "Fix your Problem.", timing: "problem" },
  "blame-game": { name: "Blame Game", line: "Pass your Problem to another player.", timing: "problem" },
  "not-me": { name: "Not Me", line: "A Problem passed to you goes back.", timing: "reaction" },
  revenge: { name: "Revenge", line: "A Problem passed to you goes to someone else.", timing: "reaction" },
  "hr-complaint": { name: "HR Complaint", line: "Cancel the last pass.", timing: "reaction" },
  "fake-report": { name: "Fake Report", line: "Play a card face down and say it is a Quick Fix.", timing: "problem" },
  overtime: { name: "Overtime", line: "A player draws 2 cards on their next turn.", timing: "proactive" },
  intern: { name: "Intern", line: "Your next warning goes to the Intern.", timing: "proactive" },
  promotion: { name: "Promotion", line: "Remove 1 of your warnings.", timing: "proactive" },
  spy: { name: "Spy", line: "Take a random card from a player.", timing: "proactive" },
};

export const PROBLEM_TEXT: Record<ProblemKind, { name: string; line: string; penalty: 1 | 2 }> = {
  "server-down": { name: "Server Down", line: "1 warning if not fixed.", penalty: 1 },
  "data-leak": { name: "Data Leak", line: "2 warnings if not fixed. An Intern stops only 1.", penalty: 2 },
  "angry-client": { name: "Angry Client", line: "1 warning. Can't go back to the last player.", penalty: 1 },
};

/** Copies of each action card for a game that starts with n players. */
export function copiesFor(n: number): Record<ActionKind, number> {
  const half = Math.ceil(n / 2);
  return {
    "quick-fix": n + 2,
    "blame-game": n + 2,
    "not-me": n,
    revenge: Math.floor(n / 2) + 1,
    intern: Math.floor(n / 2),
    "hr-complaint": half + 1,
    overtime: half,
    promotion: half,
    spy: half,
    "fake-report": half,
  };
}

export function problemCount(n: number): number {
  return 3 * n;
}

export const PROBLEM_CYCLE: readonly ProblemKind[] =
  ["server-down", "server-down", "data-leak", "angry-client", "server-down", "angry-client"];

/** Every card instance, unshuffled. Problems follow PROBLEM_CYCLE in order. */
export function buildDeck(n: number): { actions: ActionCard[]; problems: ProblemCard[] } {
  const actions: ActionCard[] = [];
  for (const [kind, count] of Object.entries(copiesFor(n)) as [ActionKind, number][]) {
    for (let i = 1; i <= count; i++) actions.push({ id: `${kind}-${i}`, kind });
  }
  const seen: Partial<Record<ProblemKind, number>> = {};
  const problems: ProblemCard[] = [];
  for (let i = 0; i < problemCount(n); i++) {
    const kind = PROBLEM_CYCLE[i % PROBLEM_CYCLE.length]!;
    const k = (seen[kind] = (seen[kind] ?? 0) + 1);
    problems.push({ id: `${kind}-${k}`, kind });
  }
  return { actions, problems };
}
