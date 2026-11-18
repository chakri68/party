import type { Me } from "./api.ts";

export interface CreateDeps {
  me(): Promise<Me>;
  token(): Promise<string>;
  create(token: string | null): Promise<{ code: string; hostKey: string } | { error: string }>;
  save(code: string, hostKey: string): void;
}

type Created = { code: string } | { error: string };

const NOT_HUMAN = "Could not check you are human. Please try again.";

/**
 * "Create room". The first one uses the account check the page made on load
 * (the header needs it anyway), so the tap doesn't wait on another trip to
 * the server. Later ones ask again: a pass can start or end while the page is
 * open. If a pass seen on load has run out, the server says no to the room
 * without a Turnstile token; then it asks again and retries once with one.
 */
export function roomCreator(atLoad: Promise<Me>, deps: CreateDeps): () => Promise<Created> {
  let known: Promise<Me> | null = atLoad;
  /** `tokenless`: refused without a Turnstile token, which a run-out pass explains. */
  const attempt = async (account: Promise<Me>): Promise<Created & { tokenless?: boolean }> => {
    let token: string | null = null;
    if ((await account).tier === "free") {
      try {
        token = await deps.token();
      } catch {
        return { error: NOT_HUMAN };
      }
    }
    const r = await deps.create(token);
    if ("error" in r) return { error: r.error, tokenless: token === null };
    deps.save(r.code, r.hostKey);
    return { code: r.code };
  };
  const plain = ({ tokenless: _, ...r }: Created & { tokenless?: boolean }): Created => r;
  return async () => {
    const account = known ?? deps.me();
    known = null;
    const first = await attempt(account);
    return plain(first.tokenless ? await attempt(deps.me()) : first);
  };
}
