import { MAX_TEAMS, TEAM_COLORS, type BlindRallyCarry, type BlindRallyState, type Role, type TeamColorKey, type TeamState } from "../shared/types.ts";

// Seats in cars. Helpers mutate the state they're given; game.ts hands them a
// clone. Invariant: a player is in at most one seat, in at most one team.
// Rally (state.variant) bends it on purpose: a car of one, the same player in
// both seats. seatOf calls that seat "driver"; anything that cares which job
// someone does asks holds() instead.

export interface Seat {
  team: TeamState;
  role: Role;
}

const slot = (role: Role) => (role === "driver" ? "driverId" : "navigatorId");
const other = (role: Role): Role => (role === "driver" ? "navigator" : "driver");

/** The first palette colour no other team has: four teams, four colours, so there's always one. */
function freeColor(teams: TeamState[]): TeamColorKey {
  return (TEAM_COLORS.find((c) => !teams.some((t) => t.color === c.key)) ?? TEAM_COLORS[0]!).key;
}

export const newTeam = (id: number, teams: TeamState[]): TeamState => ({
  id,
  driverId: null,
  navigatorId: null,
  captain: "navigator",
  color: freeColor(teams),
  run: null,
});

export function seatOf(state: BlindRallyState, playerId: string): Seat | null {
  for (const team of state.teams) {
    if (team.driverId === playerId) return { team, role: "driver" };
    if (team.navigatorId === playerId) return { team, role: "navigator" };
  }
  return null;
}

export const isFull = (t: TeamState) => t.driverId !== null && t.navigatorId !== null;
export const isEmpty = (t: TeamState) => t.driverId === null && t.navigatorId === null;
/** Rally's car of one: the same player drives and navigates. */
export const isSolo = (t: TeamState) => t.driverId !== null && t.driverId === t.navigatorId;
/** Whether this player does this job in this car. A solo player does both. */
export const holds = (t: TeamState, playerId: string, role: Role) => t[slot(role)] === playerId;
/** Everyone in the car, once each: a solo car has one member, not two. */
export const members = (t: TeamState) => [...new Set([t.driverId, t.navigatorId])].filter((id): id is string => id !== null);
/** The captain's seat, or whoever's in the car if that one's empty. */
export const captainOf = (t: TeamState) => t[slot(t.captain)] ?? t[slot(other(t.captain))];

/** Anyone whose car changed has to ready up again: they may not like the new arrangement. */
function unready(state: BlindRallyState, team: TeamState): void {
  for (const id of members(team)) {
    const p = state.players.find((q) => q.id === id);
    if (p) p.ready = false;
  }
}

export function unseat(state: BlindRallyState, playerId: string): void {
  const s = seatOf(state, playerId);
  if (!s) return;
  unready(state, s.team);
  if (isSolo(s.team)) s.team.navigatorId = null;
  s.team[slot(s.role)] = null;
  const p = state.players.find((q) => q.id === playerId);
  if (p) p.ready = false;
}

/**
 * Puts a player in a seat. Whoever was in it is unseated (the host's assign;
 * self-picks check the seat is free first).
 */
export function sit(state: BlindRallyState, playerId: string, team: TeamState, role: Role): void {
  unseat(state, playerId);
  const bumped = team[slot(role)];
  if (bumped) unseat(state, bumped);
  team[slot(role)] = playerId;
  unready(state, team);
}

/** Within their team: take `role`, swapping with the teammate if it's theirs. */
export function pickRole(state: BlindRallyState, seat: Seat, role: Role): void {
  if (seat.role === role) return;
  const { team } = seat;
  [team.driverId, team.navigatorId] = [team.navigatorId, team.driverId];
  unready(state, team);
}

/**
 * Enough cars for everyone, up to MAX_TEAMS (one in practice). Grows as people
 * join; only trailing empty cars are taken away, so nobody's team number moves.
 */
export function fitTeams(state: BlindRallyState): void {
  if (state.variant === "rally") return fitCars(state);
  const want = state.settings.mode === "practice" ? 1 : Math.min(MAX_TEAMS, Math.max(1, Math.ceil(state.players.length / 2)));
  while (state.teams.length < want) state.teams.push(newTeam(state.teams.length + 1, state.teams));
  while (state.teams.length > want && isEmpty(state.teams.at(-1)!)) state.teams.pop();
}

/**
 * Rally: everyone gets a car of their own, up to MAX_TEAMS; past that they
 * watch until one frees up. An emptied car is reused before a new one is
 * made, and trailing empties go, so nobody's number moves.
 */
function fitCars(state: BlindRallyState): void {
  for (const p of state.players) {
    if (seatOf(state, p.id)) continue;
    let car = state.teams.find(isEmpty);
    if (!car && state.teams.length < MAX_TEAMS) state.teams.push((car = newTeam(state.teams.length + 1, state.teams)));
    if (!car) break;
    car.driverId = car.navigatorId = p.id;
    p.ready = false;
  }
  while (state.teams.length > 1 && isEmpty(state.teams.at(-1)!)) state.teams.pop();
  if (!state.teams.length) state.teams.push(newTeam(1, state.teams));
}

/** Last game's cars and colours, minus anyone who's left the room. */
export function restoreTeams(state: BlindRallyState, carry: unknown): void {
  const c = carry as BlindRallyCarry | undefined;
  if (!c || !Array.isArray(c.teams)) return;
  const here = new Set(state.players.map((p) => p.id));
  const keep = (id: unknown) => (typeof id === "string" && here.has(id) ? id : null);
  const limit = state.settings.mode === "practice" ? 1 : MAX_TEAMS;
  state.teams = [];
  for (const [i, t] of c.teams.slice(0, limit).entries()) {
    const team = newTeam(i + 1, state.teams);
    const color = TEAM_COLORS.find((k) => k.key === t.color)?.key;
    // Keep the colour unless it's junk or (somehow) already taken.
    if (color && !state.teams.some((o) => o.color === color)) team.color = color;
    state.teams.push({ ...team, driverId: keep(t.driverId), navigatorId: keep(t.navigatorId), captain: t.captain === "driver" ? "driver" : "navigator" });
  }
}

export function carryOf(state: BlindRallyState): BlindRallyCarry {
  return {
    teams: state.teams.map((t) => ({ driverId: t.driverId, navigatorId: t.navigatorId, captain: t.captain, color: t.color })),
    trackId: state.trackId,
  };
}

/** Why the host can't start, in words for the screen; null when they can. */
export function startBlocker(state: BlindRallyState): string | null {
  const full = state.teams.filter(isFull);
  if (!full.length) return state.variant === "rally" ? "Nobody is in a car yet." : "A car needs a Driver and a Navigator.";
  const half = state.teams.find((t) => !isFull(t) && !isEmpty(t));
  if (half) return `Team ${half.id} needs a ${half.driverId ? "Navigator" : "Driver"}.`;
  const waiting = full.flatMap(members).filter((id) => !state.players.find((p) => p.id === id)?.ready).length;
  if (waiting) return waiting === 1 ? "Waiting for 1 player to get ready." : `Waiting for ${waiting} players to get ready.`;
  return null;
}
