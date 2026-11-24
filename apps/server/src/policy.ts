import { safeEqual } from "@games/protocol";
import type { GodotEnv } from "./godot.ts";
import type { SoundsEnv } from "./host-sounds.ts";
import type { PacksEnv } from "./packs.ts";
import type { RoomGrant } from "./runtime.ts";

export type { TierLimits } from "./runtime.ts";

/** What the shared Worker needs from its bindings. A product Worker's generated `Env` satisfies it. */
export interface ServerEnv extends GodotEnv, PacksEnv, SoundsEnv {
  Room: DurableObjectNamespace;
  ASSETS: Fetcher;
  OWNER_KEY?: string;
  DEV_TOOLS?: string;
  /** Cloudflare Realtime TURN key. Both unset: voice uses STUN only. */
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}

export type CreateDecision =
  | { ok: true; grant: RoomGrant; extra?: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Whose host sounds a request may change. `active` false: the list opens, rename
 * and remove work, PUT is refused, and new rooms do not get it.
 */
export interface SoundOwner {
  library: string;
  active: boolean;
}

/** Who may create a room, and on what terms. */
export interface HostPolicy {
  canCreate(request: Request, env: ServerEnv): Promise<CreateDecision>;
  /** The library this request may change, or null. Without it, nobody has host sounds. */
  soundOwner?(request: Request, env: ServerEnv): Promise<SoundOwner | null>;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** No secret set means nobody is the owner: fail closed, never open. */
export function isOwnerKey(env: ServerEnv, key: string | null | undefined): boolean {
  return !!env.OWNER_KEY && !!key && safeEqual(key, env.OWNER_KEY);
}

const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

/** The owner's one sound library. */
export const OWNER_LIBRARY = "owner";

/** Today's rule: the bearer token must be the OWNER_KEY secret. */
export const ownerKeyPolicy: HostPolicy = {
  async canCreate(request, env) {
    if (!env.OWNER_KEY) return { ok: false, response: json({ error: "Could not create a room." }, 503) }; // no OWNER_KEY secret set
    if (!isOwnerKey(env, bearer(request))) return { ok: false, response: json({ error: "Could not create a room." }, 403) };
    return { ok: true, grant: { tier: "pass", hostKey: null, library: OWNER_LIBRARY } };
  },
  async soundOwner(request, env) {
    return isOwnerKey(env, bearer(request)) ? { library: OWNER_LIBRARY, active: true } : null;
  },
};
