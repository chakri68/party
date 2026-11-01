import { runClock } from "../role.ts";
import type { BlindRallyPublicState, NavigatorRun, NavigatorSession, PublicTeam } from "../../shared/types.ts";

// What host.ts hands Godot's initSession, built without a DOM so it's testable.

/** What this device is, beside the session: it drives (Rally), and the player's settings. */
export interface SessionDevice {
  selfDrive: boolean;
  muted: boolean;
  reducedMotion: boolean;
}

/**
 * What can change on the grid after Godot has booted: the car (an un-ready, a new pick,
 * the ballot's leader moving), the rivals, and the sky (the host changing Time in the
 * lobby). A new key sends the session again.
 */
export function sessionKey(session: NavigatorSession): string {
  return JSON.stringify([session.vehicle, session.rivals, session.sky]);
}

export function sessionInit(session: NavigatorSession, game: BlindRallyPublicState, team: PublicTeam | undefined, run: NavigatorRun | null, now: number, device: SessionDevice) {
  return {
    ...session,
    room: true,
    // The sky's clock right now. A Godot that boots mid-race (a reload) has no race_event
    // listener when tick() first sends the clock, so the session carries it too.
    clock: runClock(game, team, now),
    // A reloaded Navigator's car goes back to the anchor of what the server counted,
    // held for whatever's left of a reset's hold.
    checkpoints: run?.checkpoints ?? 0,
    holdMs: Math.max(0, (run?.holdUntil ?? 0) - now),
    // Their own guess pins, if Godot's been reloaded mid-race.
    pins: run?.pins ?? { pin: null, trail: [] },
    // Rally: this device drives. WASD in Godot when the course has focus; no pins; R asks for a reset.
    keyboard: device.selfDrive,
    selfDrive: device.selfDrive,
    autopilot: false,
    muted: device.muted,
    reducedMotion: device.reducedMotion,
  };
}
