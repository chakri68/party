import type { GameContext, GameDefinition, GameResult } from "@games/game-core";
import { blindRallyManifest } from "../shared/manifest.ts";
import { parseSettings } from "../shared/rules-text.ts";
import {
  DEFAULT_SETTINGS,
  effectiveTrackPick,
  type BlindRallyCarry,
  type BlindRallyAction,
  type BlindRallyEvent,
  type BlindRallyPrivateState,
  type BlindRallyPublicState,
  type BlindRallySettings,
  type BlindRallyState,
} from "../shared/types.ts";
import { fairBallot, settleTrack, setTrack } from "./ballot.ts";
import { defaultTrack, hasTrack } from "./geometry.ts";
import { parseAction } from "./parse.ts";
import { GO, TIME_UP } from "./phases.ts";
import { privateState, publicState } from "./projection.ts";
import {
  checkGate,
  endRace,
  GRACE_TIMER,
  liveRun,
  onRaceStream,
  passGate,
  playerAway,
  playerBack,
  resetCar,
  startCountdown,
  teamOut,
  type Out,
} from "./race.ts";
import { result } from "./scoring.ts";
import { captainOf, carryOf, fitTeams, pickRole, restoreTeams, seatOf, sit, startBlocker, unseat } from "./teams.ts";
import { upgrade } from "./upgrade.ts";

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
      settleTrack(state);
      return { ok: true, transition: unchanged(state) };
    }

    case "team.leave": {
      if (!inTeams) return reject("wrong-phase", "Seats are picked before the race.");
      if (!seatOf(prev, playerId)) return reject("not-seated", "You're not in a car.");
      const state = clone(prev);
      unseat(state, playerId);
      // An emptied car's vote goes with it.
      settleTrack(state);
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
        settleTrack(state);
        return { ok: true, transition: unchanged(state) };
      }
      const team = state.teams.find((t) => t.id === action.teamId);
      if (!team) return reject("no-such-team", "There's no such car.");
      // No role given: whichever seat's free, Navigator first (they're the captain).
      const role = action.role ?? (team.navigatorId === null ? "navigator" : team.driverId === null ? "driver" : null);
      if (!role) return reject("team-full", `Team ${team.id} is full.`);
      sit(state, action.playerId, team, role);
      settleTrack(state);
      return { ok: true, transition: unchanged(state) };
    }

    case "track.pick": {
      if (!isHost(ctx, playerId)) return reject("not-host", "Only the host picks the track.");
      if (!inTeams) return reject("wrong-phase", "The track's locked once the race starts.");
      if (effectiveTrackPick(prev.settings) !== "host") return reject("ballot-on", "The teams are voting on this one.");
      if (!hasTrack(action.trackId)) return reject("no-such-track", "There's no such track.");
      if (prev.trackId === action.trackId) return { ok: true, transition: unchanged(prev) };
      const state = clone(prev);
      setTrack(state, action.trackId);
      return { ok: true, transition: unchanged(state) };
    }

    case "track.vote": {
      if (!inTeams) return reject("wrong-phase", "Voting closed when the race started.");
      if (effectiveTrackPick(prev.settings) !== "ballot") return reject("host-picks", "The host picks the track this time.");
      const seat = seatOf(prev, playerId);
      if (!seat) return reject("not-seated", "Get in a car first: the vote's per team.");
      if (captainOf(seat.team) !== playerId) return reject("not-captain", "Your team's captain votes for the car.");
      if (action.trackId !== null && !hasTrack(action.trackId)) return reject("no-such-track", "There's no such track.");
      const state = clone(prev);
      const ballot = fairBallot(state);
      // One vote per team: a new one replaces the old.
      ballot.votes = ballot.votes.filter((v) => v.teamId !== seat.team.id);
      if (action.trackId !== null) ballot.votes.push({ teamId: seat.team.id, trackId: action.trackId });
      settleTrack(state);
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
      // The Driver's button, or the Navigator's Godot reporting the car fell out of the world
      // (it parks the car and waits for this, rather than teleporting on its own).
      const fell = action.reason === "fell" && seat?.role === "navigator";
      if (!seat || (seat.role !== "driver" && !fell)) return reject("not-driver", "Only the Driver can reset the car.");
      if (!liveRun(prev, playerId, ctx.now)) return reject("wrong-phase", "Not while the car's parked.");
      if (seat.team.run!.away.length) return reject("paused", "Your team's paused until everyone's back.");
      const state = clone(prev);
      const out = newOut();
      resetCar(seatOf(state, playerId)!.team, ctx.now, out);
      return { ok: true, transition: done(state, out) };
    }

    case "race.event": {
      const seat = seatOf(prev, playerId);
      if (!seat || seat.role !== "navigator") return reject("not-navigator", "Only the Navigator's course reports gates.");
      if (!liveRun(prev, playerId, ctx.now)) return reject("wrong-phase", "Not while the car's parked.");
      const run = seat.team.run!;
      if (run.away.length) return reject("paused", "Your team's paused until everyone's back.");
      const claim = action.kind === "cp" ? { kind: "cp" as const, checkpointId: action.checkpointId } : { kind: "finish" as const };
      const error = checkGate(prev, run, claim, ctx.now);
      if (error) return { ok: false, error };
      const state = clone(prev);
      const out = newOut();
      passGate(state, seatOf(state, playerId)!.team, claim, ctx, out);
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
    const carried = (match.carry as BlindRallyCarry | undefined)?.trackId;
    const state: State = {
      phase: "teams",
      settings,
      // A rematch stays on last race's track until someone picks or votes otherwise.
      trackId: hasTrack(carried) ? carried : defaultTrack(),
      ballots: [{ target: "all", votes: [], tied: [] }],
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

  // Every way in goes through upgrade(): a room saved by an older Worker gets its new fields first.
  handleAction: (prev, playerId, action, ctx) => handle(upgrade(prev), playerId, action, ctx),

  onTimer(old, timerId, ctx) {
    const prev = upgrade(old);
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
    if (timerId.startsWith(GRACE_TIMER)) {
      const state = clone(prev);
      const out = newOut();
      return teamOut(state, Number(timerId.slice(GRACE_TIMER.length)), "grace", ctx, out) ? done(state, out) : unchanged(prev);
    }
    return unchanged(prev);
  },

  // Spec §8.3. The runtime's own seat grace is 60 s and, mid-game, only marks
  // the seat "disconnected" when it runs out (no hook): ours is 30 s and
  // fires first, so the team is already DNF by then. A reconnect after our
  // grace finds the team out and changes nothing.
  onPlayerDisconnected(old, playerId, ctx) {
    const prev = upgrade(old);
    const state = clone(prev);
    const out = newOut();
    return playerAway(state, playerId, ctx.now, out) ? done(state, out) : unchanged(prev);
  },

  onPlayerReconnected(old, playerId, ctx) {
    const prev = upgrade(old);
    const state = clone(prev);
    const out = newOut();
    return playerBack(state, playerId, ctx.now, out) ? done(state, out) : unchanged(prev);
  },

  onPlayerJoined(old, playerId) {
    const prev = upgrade(old);
    if (prev.players.some((p) => p.id === playerId)) return unchanged(prev);
    const state = clone(prev);
    state.players.push({ id: playerId, ready: false });
    // Mid-race they watch; before it, a fresh car may appear for them.
    if (state.phase === "teams") fitTeams(state);
    return unchanged(state);
  },

  onPlayerRemoved(old, playerId, ctx) {
    const prev = upgrade(old);
    if (!prev.players.some((p) => p.id === playerId)) return unchanged(prev);
    const state = clone(prev);
    if (state.phase === "teams") {
      unseat(state, playerId);
      state.players = state.players.filter((p) => p.id !== playerId);
      fitTeams(state);
      settleTrack(state);
      return unchanged(state);
    }
    // Mid-race the seat stays filled, for the results, and the car's out.
    const seat = seatOf(state, playerId);
    const out = newOut();
    if (seat) teamOut(state, seat.team.id, "left", ctx, out);
    return done(state, out);
  },

  onStream(state, playerId, data, ctx) {
    return ctx ? onRaceStream(upgrade(state), playerId, data, ctx.now) : null;
  },

  getPublicState: (state) => publicState(upgrade(state)),
  getPrivateState: (state, playerId) => privateState(upgrade(state), playerId),

  // Nobody takes turns: the shell's nudge and skip controls stay out of it.
  getAwaitedPlayerIds: () => [],

  getResult(state) {
    return state.phase === "finished" ? result(upgrade(state)) : null;
  },

  carryOver: (state) => carryOf(upgrade(state)),
};
