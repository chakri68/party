import { ownerKeyPolicy } from "./policy.ts";
import { createFetch, RoomBase } from "./worker.ts";

export class Room extends RoomBase {}

export default {
  fetch: createFetch({ policy: ownerKeyPolicy, brand: "Party Games" }),
} satisfies ExportedHandler<Env>;
