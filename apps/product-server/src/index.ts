import { json } from "@games/server/policy";
import type { HostPolicy } from "@games/server/policy";
import { createFetch, RoomBase } from "@games/server/worker";

export class Room extends RoomBase {}

// Temporary: real policy arrives with accounts. Until then nobody creates rooms.
const denyAll: HostPolicy = {
  async canCreate() {
    return { ok: false, response: json({ error: "Could not create a room." }, 503) };
  },
};

export default {
  fetch: createFetch({ policy: denyAll, brand: "CouchParty" }),
} satisfies ExportedHandler<Env>;
