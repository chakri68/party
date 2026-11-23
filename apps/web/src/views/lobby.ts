import type { SettingField } from "@games/game-core";

/** What the lobby's main bar holds: Start for the host, I'm ready for everyone else. */
export type LobbyAction =
  | { kind: "start"; label: string; disabled: boolean; note: string | null }
  | { kind: "ready"; label: string; primary: boolean; pressed: boolean; note: string };

export interface LobbyActionInput {
  isHost: boolean;
  ready: boolean;
  connected: number;
  min: number;
  canStart: boolean;
  setupProblem: boolean;
  /** Computers sit at a game that has none. */
  botBlocked: boolean;
  hostName: string;
}

/**
 * The host starts the game and never says ready: starting doesn't wait on
 * the host's own flag. A guest's ready button is the loud one until pressed.
 */
export function lobbyAction(a: LobbyActionInput): LobbyAction {
  if (a.isHost) {
    return {
      kind: "start",
      // canStart is vague on purpose (the owner gate), so the label is too, but
      // it mustn't claim players are missing when they aren't.
      label: a.connected < a.min ? `Need ${a.min - a.connected} more` : a.canStart ? "Start game" : "Can't start yet",
      disabled: a.connected < a.min || !a.canStart || a.setupProblem || a.botBlocked,
      note: a.botBlocked ? "Remove computers to play this" : null,
    };
  }
  return {
    kind: "ready",
    label: a.ready ? "Not ready" : "I'm ready",
    primary: !a.ready,
    pressed: a.ready,
    note: `Waiting for ${a.hostName} to start.`,
  };
}

/** The chosen settings in one plain line, like "Rounds: 3 · Matching cards: Skip". Empty with no settings. */
export function settingsSummary(fields: SettingField[]): string {
  return fields
    .map((f) => {
      const value = f.options[f.selected]?.label;
      return value ? `${f.label}: ${value}` : null;
    })
    .filter((s): s is string => !!s)
    .join(" · ");
}
