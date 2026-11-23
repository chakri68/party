import type { SettingField } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { lobbyAction, settingsSummary, type LobbyActionInput } from "../src/views/lobby.ts";

const base: LobbyActionInput = {
  isHost: false,
  ready: false,
  connected: 3,
  min: 2,
  canStart: true,
  setupProblem: false,
  botBlocked: false,
  hostName: "Asha",
};

describe("the lobby's main action", () => {
  it("gives the host Start, never I'm ready", () => {
    expect(lobbyAction({ ...base, isHost: true })).toEqual({ kind: "start", label: "Start game", disabled: false, note: null });
  });

  it("does not care about the host's own ready flag", () => {
    expect(lobbyAction({ ...base, isHost: true, ready: true })).toEqual(lobbyAction({ ...base, isHost: true, ready: false }));
  });

  it("says how many more players the host needs", () => {
    expect(lobbyAction({ ...base, isHost: true, connected: 1, min: 3 })).toMatchObject({ label: "Need 2 more", disabled: true });
  });

  it("holds Start when the room can't start yet", () => {
    expect(lobbyAction({ ...base, isHost: true, canStart: false })).toMatchObject({ label: "Can't start yet", disabled: true });
    expect(lobbyAction({ ...base, isHost: true, setupProblem: true })).toMatchObject({ label: "Start game", disabled: true });
  });

  it("tells the host to remove computers from a game without them", () => {
    expect(lobbyAction({ ...base, isHost: true, botBlocked: true })).toMatchObject({ disabled: true, note: "Remove computers to play this" });
  });

  it("gives a guest a loud I'm ready, then a quiet Not ready", () => {
    expect(lobbyAction(base)).toEqual({ kind: "ready", label: "I'm ready", primary: true, pressed: false, note: "Waiting for Asha to start." });
    expect(lobbyAction({ ...base, ready: true })).toMatchObject({ label: "Not ready", primary: false, pressed: true });
  });
});

describe("the settings summary", () => {
  const field = (label: string, values: string[], selected: number): SettingField => ({
    key: label.toLowerCase(),
    label,
    selected,
    options: values.map((v) => ({ label: v, patch: {} })),
  });

  it("names each setting and its chosen value on one line", () => {
    expect(settingsSummary([field("Rounds", ["3", "5"], 0), field("Matching cards", ["Skip", "Keep"], 1)])).toBe("Rounds: 3 · Matching cards: Keep");
  });

  it("is empty with no settings, and skips a field with no valid choice", () => {
    expect(settingsSummary([])).toBe("");
    expect(settingsSummary([field("Rounds", ["3"], 4)])).toBe("");
  });
});
