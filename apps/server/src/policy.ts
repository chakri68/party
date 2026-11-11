import { safeEqual } from "@games/protocol";
import type { GodotEnv } from "./godot.ts";
import type { RoomGrant } from "./runtime.ts";

/** What the shared Worker needs from its bindings. A product Worker's generated `Env` satisfies it. */
export interface ServerEnv extends GodotEnv {
  Room: DurableObjectNamespace;
  ASSETS: Fetcher;
  OWNER_KEY?: string;
  DEV_TOOLS?: string;
}

export type CreateDecision =
  | { ok: true; grant: RoomGrant; extra?: Record<string, unknown> }
  | { ok: false; response: Response };

/** Who may create a room, and on what terms. */
export interface HostPolicy {
  canCreate(request: Request, env: ServerEnv): Promise<CreateDecision>;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** No secret set means nobody is the owner: fail closed, never open. */
export function isOwnerKey(env: ServerEnv, key: string | null | undefined): boolean {
  return !!env.OWNER_KEY && !!key && safeEqual(key, env.OWNER_KEY);
}

/** Today's rule: the bearer token must be the OWNER_KEY secret. */
export const ownerKeyPolicy: HostPolicy = {
  async canCreate(request, env) {
    if (!env.OWNER_KEY) return { ok: false, response: json({ error: "Could not create a room." }, 503) }; // no OWNER_KEY secret set
    const key = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!isOwnerKey(env, key)) return { ok: false, response: json({ error: "Could not create a room." }, 403) };
    return { ok: true, grant: { tier: "pass", hostKey: null } };
  },
};
