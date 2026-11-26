import type { TableKey, TableLog } from "@games/game-core";

export const TALK_BURST_CAP_MS = 120_000;
export const TABLE_PERSIST_MS = 30_000;
const PEAK_MIN_MS = 1000;

export interface TalkContext {
  gameId: string | null;
  offTurn: boolean;
  afterWin: boolean;
}

/** In memory: open bursts and open voice sessions. Counts land in the TableLog passed in. */
export class TableTally {
  private bursts = new Map<string, { start: number; ctx: TalkContext }>();
  private sessions = new Map<string, number>();

  setCounting(log: TableLog, id: string, on: boolean, now: number): void {
    if (on) {
      if (!log.counted.includes(id)) log.counted.push(id);
      if (!this.sessions.has(id)) this.sessions.set(id, now);
    } else {
      this.drop(log, id, now);
    }
  }

  counting(id: string): boolean {
    return this.sessions.has(id);
  }

  talkOn(log: TableLog, id: string, now: number, ctx: TalkContext): void {
    if (!this.counting(id) || this.bursts.has(id)) return;
    const seat = (log.seats[id] ??= {});
    const others = this.bursts.size;
    if (others > 0) seat.overTalks = (seat.overTalks ?? 0) + 1;
    this.bursts.set(id, { start: now, ctx });
    const count = others + 1;
    if (count >= 2 && count > (log.loudest?.count ?? 0)) log.loudest = { count, gameId: ctx.gameId };
  }

  /** Closes this seat's burst. `peak` is the phone's; null when the room closes it. Returns true if anything was counted. */
  talkOff(log: TableLog, id: string, now: number, peak: number | null): boolean {
    const burst = this.bursts.get(id);
    if (!burst) return false;
    this.bursts.delete(id);
    const ms = Math.min(Math.max(now - burst.start, 0), TALK_BURST_CAP_MS);
    const seat = (log.seats[id] ??= {});
    seat.talkMs = (seat.talkMs ?? 0) + ms;
    if (burst.ctx.offTurn) seat.offTurnMs = (seat.offTurnMs ?? 0) + ms;
    if (burst.ctx.afterWin) seat.winTalkMs = (seat.winTalkMs ?? 0) + ms;
    if (peak !== null && ms >= PEAK_MIN_MS && peak > (seat.peak ?? 0)) seat.peak = peak;
    return true;
  }

  /** Closes burst and voice session: left voice or disconnected. */
  drop(log: TableLog, id: string, now: number): void {
    this.talkOff(log, id, now, null);
    const start = this.sessions.get(id);
    if (start === undefined) return;
    this.sessions.delete(id);
    const seat = (log.seats[id] ??= {});
    seat.voiceMs = (seat.voiceMs ?? 0) + Math.max(now - start, 0);
  }

  open(): string[] {
    return [...this.bursts.keys()];
  }

  bump(log: TableLog, id: string, key: "sounds" | "reactions" | "chats"): void {
    const seat = (log.seats[id] ??= {});
    const k: TableKey = key;
    seat[k] = (seat[k] ?? 0) + 1;
  }
}
