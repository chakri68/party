import type { TableLog } from "@games/game-core";

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

  setCounting(log: TableLog, id: string, on: boolean, now: number): void {
    if (on) {
      if (!log.counted.includes(id)) log.counted.push(id);
      const sessions = (log.sessions ??= {});
      if (sessions[id] === undefined) sessions[id] = now;
    } else {
      // Off means off: never named in a voice award. Leaving voice (drop) keeps it.
      this.drop(log, id, now);
      log.counted = log.counted.filter((x) => x !== id);
    }
  }

  counting(log: TableLog, id: string): boolean {
    return log.sessions?.[id] !== undefined;
  }

  talkOn(log: TableLog, id: string, now: number, ctx: TalkContext): void {
    if (!this.counting(log, id)) return;
    const mine = this.bursts.get(id);
    if (mine && now - mine.start <= TALK_BURST_CAP_MS) return;
    // Bursts past the cap, this seat's own too, are closed (at the cap) first.
    for (const [other, burst] of [...this.bursts]) {
      if (now - burst.start > TALK_BURST_CAP_MS) this.talkOff(log, other, now, null);
    }
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
    const start = log.sessions?.[id];
    if (start === undefined) return;
    delete log.sessions![id];
    const seat = (log.seats[id] ??= {});
    seat.voiceMs = (seat.voiceMs ?? 0) + Math.max(now - start, 0);
  }

  open(): string[] {
    return [...this.bursts.keys()];
  }

  bump(log: TableLog, id: string, key: "sounds" | "reactions" | "chats"): void {
    const seat = (log.seats[id] ??= {});
    seat[key] = (seat[key] ?? 0) + 1;
  }
}
