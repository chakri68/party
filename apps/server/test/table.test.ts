import { describe, expect, it } from "vitest";
import { emptyTableLog } from "@games/game-core";
import { TALK_BURST_CAP_MS, TableTally } from "../src/table.ts";

const lobby = { gameId: null, offTurn: false, afterWin: false };
const inGame = { gameId: "overheat", offTurn: false, afterWin: false };

function setup(...ids: string[]) {
  const log = emptyTableLog();
  const t = new TableTally();
  for (const id of ids) t.setCounting(log, id, true, 0);
  return { log, t };
}

describe("TableTally", () => {
  it("counts talk time and caps one burst", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, lobby);
    expect(t.talkOff(log, "a", 5000, null)).toBe(true);
    expect(log.seats.a?.talkMs).toBe(5000);
    t.talkOn(log, "a", 10_000, lobby);
    t.talkOff(log, "a", 300_000, null);
    expect(log.seats.a?.talkMs).toBe(5000 + 120_000);
  });

  it("returns false when no burst was open", () => {
    const { log, t } = setup("a");
    expect(t.talkOff(log, "a", 100, null)).toBe(false);
  });

  it("counts talking over someone and the loudest moment", () => {
    const { log, t } = setup("a", "b", "c");
    t.talkOn(log, "a", 0, lobby);
    t.talkOn(log, "b", 100, inGame);
    expect(log.seats.b?.overTalks).toBe(1);
    expect(log.seats.a?.overTalks).toBeUndefined();
    expect(log.loudest).toEqual({ count: 2, gameId: "overheat" });
    t.talkOff(log, "b", 200, null);
    t.talkOn(log, "b", 300, lobby);
    expect(log.loudest).toEqual({ count: 2, gameId: "overheat" });
    t.talkOn(log, "c", 400, lobby);
    expect(log.loudest).toEqual({ count: 3, gameId: null });
  });

  it("counts off-turn and after-win talk", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, { gameId: "g", offTurn: true, afterWin: false });
    t.talkOff(log, "a", 2000, null);
    t.talkOn(log, "a", 5000, { gameId: "g", offTurn: false, afterWin: true });
    t.talkOff(log, "a", 8000, null);
    expect(log.seats.a).toMatchObject({ talkMs: 5000, offTurnMs: 2000, winTalkMs: 3000 });
  });

  it("keeps only the highest peak from bursts of 1 second or more", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, lobby);
    t.talkOff(log, "a", 500, 0.9);
    expect(log.seats.a?.peak).toBeUndefined();
    t.talkOn(log, "a", 1000, lobby);
    t.talkOff(log, "a", 3000, 0.4);
    expect(log.seats.a?.peak).toBe(0.4);
    t.talkOn(log, "a", 4000, lobby);
    t.talkOff(log, "a", 6000, 0.25);
    expect(log.seats.a?.peak).toBe(0.4);
    t.talkOn(log, "a", 7000, lobby);
    t.talkOff(log, "a", 9000, 0.7);
    expect(log.seats.a?.peak).toBe(0.7);
    t.talkOn(log, "a", 10_000, lobby);
    t.talkOff(log, "a", 15_000, null);
    expect(log.seats.a?.peak).toBe(0.7);
    expect(log.seats.a?.talkMs).toBe(500 + 2000 + 2000 + 2000 + 5000);
  });

  it("ignores talk when not counting or already open", () => {
    const log = emptyTableLog();
    const t = new TableTally();
    t.talkOn(log, "a", 0, lobby);
    expect(t.open()).toEqual([]);
    t.setCounting(log, "a", true, 0);
    t.talkOn(log, "a", 100, lobby);
    t.talkOn(log, "a", 5000, lobby);
    expect(t.open()).toEqual(["a"]);
    t.talkOff(log, "a", 6100, null);
    expect(log.seats.a?.talkMs).toBe(6000);
  });

  it("closes the burst when counting goes off", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, lobby);
    t.setCounting(log, "a", false, 4000);
    expect(log.seats.a?.talkMs).toBe(4000);
    expect(t.counting(log, "a")).toBe(false);
    expect(t.open()).toEqual([]);
    expect(log.counted).toEqual([]);
    t.setCounting(log, "a", true, 5000);
    expect(log.counted).toEqual(["a"]);
  });

  it("keeps a seat counted when it leaves voice", () => {
    const { log, t } = setup("a");
    t.drop(log, "a", 1000);
    expect(log.counted).toEqual(["a"]);
  });

  it("closes its own burst past the cap and opens a new one", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, lobby);
    t.talkOn(log, "a", TALK_BURST_CAP_MS + 1, lobby);
    expect(log.seats.a?.talkMs).toBe(TALK_BURST_CAP_MS);
    expect(t.open()).toEqual(["a"]);
    t.talkOff(log, "a", TALK_BURST_CAP_MS + 5001, 0.5);
    expect(log.seats.a?.talkMs).toBe(TALK_BURST_CAP_MS + 5000);
  });

  it("counts voice time over sessions", () => {
    const { log, t } = setup("a");
    t.drop(log, "a", 60_000);
    expect(log.seats.a?.voiceMs).toBe(60_000);
    expect(t.counting(log, "a")).toBe(false);
    t.setCounting(log, "a", true, 100_000);
    t.setCounting(log, "a", true, 110_000);
    t.setCounting(log, "a", false, 130_000);
    expect(log.seats.a?.voiceMs).toBe(90_000);
  });

  it("drop closes an open burst", () => {
    const { log, t } = setup("a");
    t.talkOn(log, "a", 0, lobby);
    t.drop(log, "a", 3000);
    expect(log.seats.a).toMatchObject({ talkMs: 3000, voiceMs: 3000 });
  });

  it("bumps counts without counting on", () => {
    const log = emptyTableLog();
    const t = new TableTally();
    t.bump(log, "a", "sounds");
    t.bump(log, "a", "sounds");
    t.bump(log, "a", "chats");
    expect(log.seats.a).toEqual({ sounds: 2, chats: 1 });
  });

  it("still counts after a wake when given the same log", () => {
    const { log } = setup("a");
    const woken = new TableTally();
    expect(woken.counting(log, "a")).toBe(true);
    woken.talkOn(log, "a", 1000, lobby);
    woken.talkOff(log, "a", 3000, null);
    expect(log.seats.a?.talkMs).toBe(2000);
    woken.drop(log, "a", 60_000);
    expect(log.seats.a?.voiceMs).toBe(60_000);
    expect(log.sessions).toEqual({});
  });

  it("closes a burst past the cap when the next one starts", () => {
    const { log, t } = setup("a", "b");
    t.talkOn(log, "a", 0, lobby);
    t.talkOn(log, "b", TALK_BURST_CAP_MS + 1, inGame);
    expect(log.seats.a?.talkMs).toBe(TALK_BURST_CAP_MS);
    expect(log.seats.b?.overTalks).toBeUndefined();
    expect(log.loudest).toBeNull();
    expect(t.open()).toEqual(["b"]);
  });
});
