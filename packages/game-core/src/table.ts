// What the room counts around the games for the recap: talk time from voice,
// sounds, reactions and chat. Only counts, never what anyone said.

export const TABLE_KEYS = ["talkMs", "overTalks", "offTurnMs", "winTalkMs", "voiceMs", "peak", "sounds", "reactions", "chats"] as const;
export type TableKey = (typeof TABLE_KEYS)[number];
export type TableCounts = Partial<Record<TableKey, number>>;

export interface TableLog {
  seats: Record<string, TableCounts>;
  /** Most people talking at once, and the game on then (null: lobby or results). First time it was reached. */
  loudest: { count: number; gameId: string | null } | null;
  /** Seats that ever had counting on. Only these can win a voice award. */
  counted: string[];
  /** Open voice sessions: seat id to start time (ms). Kept so a woken room still knows who is counting. The recap ignores it. */
  sessions?: Record<string, number>;
}

export function emptyTableLog(): TableLog {
  return { seats: {}, loudest: null, counted: [] };
}
