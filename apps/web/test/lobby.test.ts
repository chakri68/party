import type { SettingField } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { lobbyAction, settingsSummary, settingsWarnings, type LobbyActionInput } from "../src/views/lobby.ts";

const base: LobbyActionInput = {
  isHost: false,
  ready: false,
  connected: 3,
  min: 2,
  canStart: true,
  setupProblem: null,
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
  });

  it("shows the game's setup problem under a held Start", () => {
    expect(lobbyAction({ ...base, isHost: true, setupProblem: "Needs at least one Wolf card" })).toMatchObject({
      label: "Start game",
      disabled: true,
      note: "Needs at least one Wolf card",
    });
  });

  it("tells the host to remove computers from a game without them", () => {
    expect(lobbyAction({ ...base, isHost: true, botBlocked: true })).toMatchObject({ disabled: true, note: "Remove computers to play this" });
    expect(lobbyAction({ ...base, isHost: true, botBlocked: true, setupProblem: "Too few" })).toMatchObject({ note: "Remove computers to play this" });
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

  it("lists only the warning hints, each with its setting's name", () => {
    const fields: SettingField[] = [
      { ...field("Map", ["4×4", "6×6"], 0), hint: "Too small for 5. Using 6×6", warn: true },
      { ...field("Victory", ["Conquest"], 0), hint: "About 20 min" },
      { ...field("Teams", ["Off", "2 teams"], 1), warn: true },
    ];
    expect(settingsWarnings(fields)).toEqual(["Map: Too small for 5. Using 6×6"]);
  });
});
