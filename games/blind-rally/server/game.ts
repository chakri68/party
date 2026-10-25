import type { GameContext, GameDefinition, GameResult } from "@games/game-core";
import { blindRallyManifest } from "../shared/manifest.ts";
import { parseSettings } from "../shared/rules-text.ts";
import { DEFAULT_TRACK } from "../shared/tracks-public.ts";
import {
  DEFAULT_SETTINGS,
  type BlindRallyAction,
  type BlindRallyEvent,
  type BlindRallyPrivateState,
  type BlindRallyPublicState,
  type BlindRallySettings,
  type BlindRallyState,
} from "../shared/types.ts";
import { parseAction } from "./parse.ts";
import { GO, TIME_UP } from "./phases.ts";
import { privateState, publicState } from "./projection.ts";
import { endRace, liveRun, onRaceStream, resetCar, startCountdown, type Out } from "./race.ts";
import { carryOf, fitTeams, members, pickRole, restoreTeams, seatOf, sit, startBlocker, unseat } from "./teams.ts";

type State = BlindRallyState;

const reject = (code: string, message: string): GameResult<State, BlindRallyEvent> => ({ ok: false, error: { code, message } });

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });
const unchanged = (state: State) => ({ state, events: [] });

/** The runtime passes the room host on ctx; without it (a bare test ctx) nobody is. */
const isHost = (ctx: GameContext, playerId: string) => ctx.hostId === playerId;

function handle(prev: State, playerId: string, action: BlindRallyAction, ctx: GameContext): GameResult<State, BlindRallyEvent> {
  const me = prev.players.find((p) => p.id === playerId);
  if (!me) return reject("not-in-game", "You're not in this game.");
  const inTeams = prev.phase === "teams";

  switch (action.type) {
    case "team.join": {
      if (!inTeams) return reject("wrong-phase", "Seats are picked before the race.");
      const team = prev.teams.find((t) => t.id === action.teamId);
      if (!team) return reject("no-such-team", "There's no such car.");
      const holder = action.role === "driver" ? team.driverId : team.navigatorId;
      if (holder === playerId) return reject("already-there", "You're already in that seat.");
      if (holder) return reject("seat-taken", "Someone's in that seat.");
      const state = clone(prev);
      sit(state, playerId, state.teams.find((t) => t.id === action.teamId)!, action.role);
      return { ok: true, transition: unchanged(state) };
    }

    case "team.leave": {
      if (!inTeams) return reject("wrong-phase", "Seats are picked before the race.");
      if (!seatOf(prev, playerId)) return reject("not-seated", "You're not in a car.");
      const state = clone(prev);
      unseat(state, playerId);
      return { ok: true, transition: unchanged(state) };
    }

    case "role.pick": {
      if (!inTeams) return reject("wrong-phase", "Swap seats before the race, or in the rematch.");
      const seat = seatOf(prev, playerId);
      if (!seat) return reject("not-seated", "Get in a car first.");
      if (seat.role === action.role) return reject("already-there", "You're already in that seat.");
      const state = clone(prev);
      pickRole(state, seatOf(state, playerId)!, action.role);
      return { ok: true, transition: unchanged(state) };
    }

    case "team.assign": {
      if (!isHost(ctx, playerId)) return reject("not-host", "Only the host can move people.");
      if (!inTeams) return reject("wrong-phase", "Seats are picked before the race.");
      if (!prev.players.some((p) => p.id === action.playerId)) return reject("not-in-game", "They're not in this game.");
      const state = clone(prev);
      if (action.teamId === null) {
        unseat(state, action.playerId);
        return { ok: true, transition: unchanged(state) };
      }
      const team = state.teams.find((t) => t.id === action.teamId);
      if (!team) return reject("no-such-team", "There's no such car.");
      // No role given: whichever seat's free, Navigator first (they're the captain).
      const role = action.role ?? (team.navigatorId === null ? "navigator" : team.driverId === null ? "driver" : null);
      if (!role) return reject("team-full", `Team ${team.id} is full.`);
      sit(state, action.playerId, team, role);
      return { ok: true, transition: unchanged(state) };
    }

    case "player.ready": {
      if (!inTeams) return reject("wrong-phase", "The race is already on.");
      if (action.ready && !seatOf(prev, playerId)) return reject("not-seated", "Get in a car first.");
      if (me.ready === action.ready) return { ok: true, transition: unchanged(prev) };
      const state = clone(prev);
      state.players.find((p) => p.id === playerId)!.ready = action.ready;
      return { ok: true, transition: unchanged(state) };
    }

    case "race.start": {
      if (!isHost(ctx, playerId)) return reject("not-host", "Only the host can start the race.");
      if (!inTeams) return reject("wrong-phase", "The race is already on.");
      const blocker = startBlocker(prev);
      if (blocker) return reject("cannot-start", blocker);
      const state = clone(prev);
      const out = newOut();
      startCountdown(state, ctx, out);
      return { ok: true, transition: done(state, out) };
    }

    case "race.end": {
      if (!isHost(ctx, playerId)) return reject("not-host", "Only the host can end the race.");
      if (prev.phase !== "countdown" && prev.phase !== "racing") return reject("wrong-phase", "No race to end.");
      const state = clone(prev);
      const out = newOut();
      endRace(state, ctx, "host", out);
      return { ok: true, transition: done(state, out) };
    }

    case "race.reset": {
      const seat = seatOf(prev, playerId);
      if (!seat || seat.role !== "driver") return reject("not-driver", "Only the Driver can reset the car.");
      if (!liveRun(prev, playerId, ctx.now)) return reject("wrong-phase", "Not while the car's parked.");
      const state = clone(prev);
      const out = newOut();
      resetCar(seatOf(state, playerId)!.team, out);
      return { ok: true, transition: done(state, out) };
    }
  }
}

export const blindRallyGame: GameDefinition<
  BlindRallyState,
  BlindRallyAction,
  BlindRallyPublicState,
  BlindRallyPrivateState,
  BlindRallySettings,
  BlindRallyEvent
> = {
  manifest: blindRallyManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx) {
    const { minPlayers, maxPlayers } = blindRallyManifest;
    if (players.length < minPlayers || players.length > maxPlayers) {
      throw new Error(`blind-rally: needs ${minPlayers}–${maxPlayers} players, got ${players.length}`);
    }
    const state: State = {
      phase: "teams",
      settings,
      trackId: DEFAULT_TRACK,
      seed: ctx.randomInt(2 ** 31),
      players: players.map((p) => ({ id: p.id, ready: false })),
      teams: [],
      startsAt: null,
      endsAt: null,
      endedAt: null,
    };
    // A rematch puts everyone back where they sat; swapping is one tap from there.
    restoreTeams(state, match.carry);
    fitTeams(state);
    return { state, events: [] };
  },

  handleAction: handle,

  onTimer(prev, timerId, ctx) {
    if (timerId === GO && prev.phase === "countdown") {
      const state = clone(prev);
      state.phase = "racing";
      return unchanged(state);
    }
    if (timerId === TIME_UP && (prev.phase === "countdown" || prev.phase === "racing")) {
      const state = clone(prev);
      const out = newOut();
      endRace(state, ctx, "time", out);
      return done(state, out);
    }
    return unchanged(prev);
  },

  onPlayerJoined(prev, playerId) {
    if (prev.players.some((p) => p.id === playerId)) return unchanged(prev);
    const state = clone(prev);
    state.players.push({ id: playerId, ready: false });
    // Mid-race they watch; before it, a fresh car may appear for them.
    if (state.phase === "teams") fitTeams(state);
    return unchanged(state);
  },

  onPlayerRemoved(prev, playerId) {
    if (!prev.players.some((p) => p.id === playerId)) return unchanged(prev);
    const state = clone(prev);
    // Mid-race the seat stays filled (step 12 turns a missing teammate into a DNF).
    if (state.phase === "teams") {
      unseat(state, playerId);
      state.players = state.players.filter((p) => p.id !== playerId);
      fitTeams(state);
    }
    return unchanged(state);
  },

  onStream(state, playerId, data, ctx) {
    return ctx ? onRaceStream(state, playerId, data, ctx.now) : null;
  },

  getPublicState: publicState,
  getPrivateState: privateState,

  // Nobody takes turns: the shell's nudge and skip controls stay out of it.
  getAwaitedPlayerIds: () => [],

  getResult(state) {
    if (state.phase !== "finished") return null;
    // M1 has no finish line yet (step 10), so every car is DNF and ties on
    // progress; step 10 ranks finishers by time + penalties ahead of them.
    const standings = state.teams
      .filter((t) => t.run)
      .flatMap((t) => {
        const run = t.run!;
        const penalty = run.penaltyMs ? ` (+${run.penaltyMs / 1000} s)` : "";
        const label = `Team ${t.id} · ${run.status === "dnf" ? "DNF" : run.status}${penalty}`;
        return members(t).map((playerId) => ({ playerId, value: 0, label }));
      });
    const seated = new Set(standings.map((s) => s.playerId));
    for (const p of state.players) if (!seated.has(p.id)) standings.push({ playerId: p.id, value: 0, label: "Watched" });
    return { winnerIds: [], standings };
  },

  carryOver: carryOf,
};
