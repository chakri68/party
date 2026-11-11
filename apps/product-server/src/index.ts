import { json } from "@games/server/policy";
import type { HostPolicy } from "@games/server/policy";
import { createFetch, RoomBase } from "@games/server/worker";
import { handleAuth, realDeps } from "./auth.ts";

export class Room extends RoomBase {}

// Temporary: real policy arrives with accounts. Until then nobody creates rooms.
const denyAll: HostPolicy = {
  async canCreate() {
    return { ok: false, response: json({ error: "Could not create a room." }, 503) };
  },
};

const rooms = createFetch({ policy: denyAll, brand: "CouchParty" });

export default {
  async fetch(request, env) {
    return (await handleAuth(request, env, realDeps(env))) ?? rooms(request, env);
  },
} satisfies ExportedHandler<Env>;
