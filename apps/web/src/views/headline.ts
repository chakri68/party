import type { GameOutcome } from "@games/game-core";

/**
 * The results screen's headline. A game's own `headline` wins; otherwise a
 * game with a loser headlines them, a shared win names everyone in it (you
 * first if you're one), and a lone winner gets the usual line.
 */
export function resultHeadline(result: GameOutcome | null | undefined, me: string, nameOf: (id: string) => string): string {
  if (result?.headline) return result.headline;
  const loser = result?.loserIds?.[0];
  if (loser) return loser === me ? "You lose" : `${nameOf(loser)} loses`;
  const tied = [...(result?.winnerIds ?? [])].sort((a, b) => Number(b === me) - Number(a === me));
  const names = (ids: string[]) => ids.map((id) => (id === me ? "You" : nameOf(id))).join(ids.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1");
  if (tied.length > 1) return `${names(tied)} tie`;
  const winner = tied[0];
  return winner ? (winner === me ? "You win!" : `${nameOf(winner)} wins`) : "Game over";
}
