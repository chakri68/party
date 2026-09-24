// Local identity and per-room resume tokens (§11). No accounts: this is it.

export interface LocalIdentity {
  clientId: string;
  displayName: string;
  avatarSeed: string;
}

/**
 * Dev only: `?as=p2` gives a tab its own identity and tokens, so one browser can
 * be four players. Production builds ignore it (the branch is dead-code-eliminated).
 */
export const devAs: string | null = import.meta.env.DEV ? new URLSearchParams(location.search).get("as") : null;

const key = (k: string) => (devAs ? `pg:${devAs}:${k}` : `pg:${k}`);

// Storage can throw (private mode, blocked site data). Degrade to memory.
const memory = new Map<string, string>();
function read(k: string): string | null {
  try {
    return localStorage.getItem(key(k));
  } catch {
    return memory.get(k) ?? null;
  }
}
function write(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key(k));
    else localStorage.setItem(key(k), v);
  } catch {
    if (v === null) memory.delete(k);
    else memory.set(k, v);
  }
}

const randomId = () => crypto.randomUUID();
const newAvatarSeed = () => randomId().slice(0, 8);

export function getIdentity(): LocalIdentity {
  try {
    const parsed = JSON.parse(read("identity") ?? "null") as LocalIdentity | null;
    if (parsed?.clientId) return parsed;
  } catch {
    // fall through and mint a fresh one
  }
  const fresh: LocalIdentity = { clientId: randomId(), displayName: devAs ?? "", avatarSeed: newAvatarSeed() };
  write("identity", JSON.stringify(fresh));
  return fresh;
}

export function setDisplayName(name: string): LocalIdentity {
  const next = { ...getIdentity(), displayName: name };
  write("identity", JSON.stringify(next));
  return next;
}

/** A new face. The seed is all the avatar is; see `faceSvg`. */
export function rerollAvatar(): LocalIdentity {
  const next = { ...getIdentity(), avatarSeed: newAvatarSeed() };
  write("identity", JSON.stringify(next));
  return next;
}

interface StoredToken {
  token: string;
  /** Last time we were in this room; drives the "rejoin" list on the home screen. */
  at: number;
}

function tokens(): Record<string, StoredToken> {
  try {
    const raw = JSON.parse(read("tokens") ?? "{}") as Record<string, StoredToken | string>;
    // Phase 1 stored bare strings.
    return Object.fromEntries(
      Object.entries(raw).map(([code, v]) => [code, typeof v === "string" ? { token: v, at: 0 } : v]),
    );
  } catch {
    return {};
  }
}

export function getResumeToken(code: string): string | undefined {
  return tokens()[code]?.token;
}

export function setResumeToken(code: string, token: string | null) {
  const all = tokens();
  if (token === null) delete all[code];
  else all[code] = { token, at: Date.now() };
  write("tokens", JSON.stringify(all));
}

/**
 * Rooms we still hold a seat token for, newest first. A room frees its code after
 * 6 h idle, so older entries are almost certainly dead and not worth offering.
 */
export function recentRooms(maxAgeMs = 6 * 60 * 60 * 1000): string[] {
  const now = Date.now();
  return Object.entries(tokens())
    .filter(([, t]) => now - t.at < maxAgeMs)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([code]) => code)
    .slice(0, 3);
}

/** The owner's key (see OWNER_KEY on the server). Only the owner's devices have one. */
export function getOwnerKey(): string | null {
  return read("ownerKey");
}

export function setOwnerKey(key: string | null) {
  write("ownerKey", key);
}

/**
 * `/#owner=<key>` stores the key on this device; `/#owner=` forgets it. The
 * fragment never reaches the server, and it's wiped from the address bar (and
 * history entry) straight away. There's deliberately no UI for any of this.
 */
export function claimOwnerKeyFromUrl() {
  const match = /^#owner=(.*)$/.exec(location.hash);
  if (!match) return;
  const key = decodeURIComponent(match[1] ?? "").trim();
  setOwnerKey(key || null);
  history.replaceState(null, "", location.pathname + location.search);
}
