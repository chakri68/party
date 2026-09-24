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

export function getIdentity(): LocalIdentity {
  try {
    const parsed = JSON.parse(read("identity") ?? "null") as LocalIdentity | null;
    if (parsed?.clientId) return parsed;
  } catch {
    // fall through and mint a fresh one
  }
  const fresh: LocalIdentity = { clientId: randomId(), displayName: devAs ?? "", avatarSeed: randomId().slice(0, 8) };
  write("identity", JSON.stringify(fresh));
  return fresh;
}

export function setDisplayName(name: string): LocalIdentity {
  const next = { ...getIdentity(), displayName: name };
  write("identity", JSON.stringify(next));
  return next;
}

function tokens(): Record<string, string> {
  try {
    return JSON.parse(read("tokens") ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function getResumeToken(code: string): string | undefined {
  return tokens()[code];
}

export function setResumeToken(code: string, token: string | null) {
  const all = tokens();
  if (token === null) delete all[code];
  else all[code] = token;
  write("tokens", JSON.stringify(all));
}
